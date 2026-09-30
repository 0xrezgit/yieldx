import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { morphoMarket, morphoVault, morphoVaultV2, normalizeMorpho, type MorphoData, type RawMorphoMarket, type RawMorphoVault, type RawMorphoVaultV2 } from '../../src/lib/lending/morpho';
import { aaveReserve, type RawAaveReserve } from '../../src/lib/lending/aave';
import { getLendingFeed, resetLendingCache } from '../../src/lib/lending/feed';
import { evaluate, selectHorizon } from '../../src/lib/market/analysis';
import { HORIZONS } from '../../src/lib/opportunity/policy';
import { FALLBACK_TX_USD } from '../../src/lib/opportunity/costs';
import { curveAt, kinkedSupplyCurve, rateAfterDeposit } from '../../src/lib/opportunity/curve';
import { estimate } from '../../src/lib/opportunity/estimate';
import { GET } from '../../src/app/api/lending/route';

// Fixtures follow the official schemas field by field (Morpho: @morpho-org/blue-api-sdk
// types; Aave V4: aave-v4-sdk schema.graphql). The numbers are controlled test data,
// not market data.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const AT = new Date(NOW).toISOString();
const unix = (ms: number) => String(Math.floor(ms / 1000));

const market = (over: Partial<RawMorphoMarket> = {}): RawMorphoMarket => ({
  marketId: '0xAAAA',
  lltv: '860000000000000000',
  loanAsset: { address: '0xUSDC', symbol: 'USDC', logoURI: null, chain: { id: 1 } },
  collateralAsset: { address: '0xWBTC', symbol: 'WBTC', logoURI: null, chain: { id: 1 } },
  warnings: [],
  // Supply APY 0 → 8% as utilization 0 → 100%.
  currentIrmCurve: [
    { utilization: 0, supplyApy: 0 },
    { utilization: 0.5, supplyApy: 0.02 },
    { utilization: 0.9, supplyApy: 0.05 },
    { utilization: 1, supplyApy: 0.08 },
  ],
  state: {
    supplyApy: 0.05,
    supplyAssetsUsd: 10_000_000,
    borrowAssetsUsd: 9_000_000,
    liquidityAssetsUsd: 1_000_000,
    fee: 0.1,
    timestamp: unix(NOW),
    rewards: [{ asset: { address: '0xMORPHO', symbol: 'MORPHO' }, supplyApr: 0.02 }],
  },
  ...over,
});

const vault = (over: Partial<RawMorphoVault> = {}): RawMorphoVault => ({
  address: '0xVAULT',
  name: 'Steakhouse USDC',
  asset: { address: '0xUSDC', symbol: 'USDC', logoURI: null },
  chain: { id: 8453 },
  warnings: [],
  liquidity: { usd: 5_000_000 },
  state: { netApyExcludingRewards: 0.06, fee: 0.1, totalAssetsUsd: 50_000_000, timestamp: unix(NOW), allRewards: [] },
  ...over,
});

const vaultV2 = (over: Partial<RawMorphoVaultV2> = {}): RawMorphoVaultV2 => ({
  address: '0xV2',
  name: 'Vault V2',
  asset: { address: '0xUSDC', symbol: 'USDC', logoURI: null },
  chain: { id: 1 },
  warnings: [],
  liquidityUsd: 2_000_000,
  totalAssetsUsd: 10_000_000,
  avgNetApy: 0.07,
  performanceFee: 0.1,
  managementFee: 0.01,
  rewards: [{ asset: { address: '0xMORPHO', symbol: 'MORPHO' }, supplyApr: 0.015 }],
  ...over,
});

const amount = (usd: number) => ({ amount: { value: String(usd) }, exchange: { value: String(usd) } });

const reserve = (over: Partial<RawAaveReserve> = {}): RawAaveReserve => ({
  id: 'reserve-1',
  chain: { chainId: 1, name: 'Ethereum' },
  spoke: { id: 'spoke-1', name: 'Main Spoke', address: '0xSPOKE' },
  status: { active: true, frozen: false, paused: false },
  canSupply: true,
  summary: {
    supplied: amount(4_000_000),
    supplyApy: { value: '0.04' },
    rewards: [
      { __typename: 'MerklSupplyReward', id: 'r-open', endDate: new Date(NOW + 10 * 86_400_000).toISOString(), extraApy: { value: '0.02' }, payoutToken: { address: '0xAAVE', info: { symbol: 'AAVE' } }, criteria: [] },
      { __typename: 'MerklSupplyReward', id: 'r-cond', endDate: new Date(NOW + 10 * 86_400_000).toISOString(), extraApy: { value: '0.5' }, payoutToken: { address: '0xX', info: { symbol: 'X' } }, criteria: [{ text: 'Hold GHO' }] },
      { __typename: 'SupplyPointsReward', id: 'p-1', name: 'Ethena sats', endDate: null },
    ],
  },
  settings: { supplyCap: amount(5_000_000) },
  asset: {
    underlying: { address: '0xUSDT', info: { symbol: 'USDT', icon: null } },
    hub: { id: 'hub-1', name: 'Core', address: '0xHUB' },
    summary: { supplied: amount(100_000_000), borrowed: amount(80_000_000), availableLiquidity: amount(20_000_000) },
    settings: {
      liquidityFee: { value: '0.1' },
      optimalUtilizationRate: { value: '0.9' },
      baseBorrowRate: { value: '0' },
      slopeBelowOptimal: { value: '0.06' },
      slopeAboveOptimal: { value: '0.6' },
    },
  },
  ...over,
});

const input = { capital: 1000, days: 30, now: NOW };

describe('rate after the user’s deposit', () => {
  it('interpolates the curve and clamps outside it', () => {
    const pts = [{ u: 0, rate: 0 }, { u: 1, rate: 10 }];
    expect(curveAt(pts, 0.25)).toBeCloseTo(2.5);
    expect(curveAt(pts, 2)).toBe(10);
  });

  it('lowers the rate as a deposit lowers utilization', () => {
    const curve = { suppliedUsd: 10_000_000, borrowedUsd: 9_000_000, points: [{ u: 0.5, rate: 2 }, { u: 0.9, rate: 5 }], source: 't' };
    const small = rateAfterDeposit(curve, 1000, 5)!;
    const big = rateAfterDeposit(curve, 5_000_000, 5)!;
    expect(small).toBeLessThan(5);
    expect(small).toBeGreaterThan(4.99);
    // u' = 9 / 15 = 0.6 → curve 2.75 of 5 → 5 × 2.75 / 5
    expect(big).toBeCloseTo(2.75, 6);
  });

  it('builds the two-slope model: borrow × u × (1 − fee)', () => {
    const pts = kinkedSupplyCurve({ base: 0, slope1: 0.06, slope2: 0.6, optimal: 0.9, fee: 0.1 });
    expect(pts).toHaveLength(201);
    expect(curveAt(pts, 0.8)).toBeCloseTo(((0.06 * 0.8) / 0.9) * 0.8 * 0.9, 9);
    expect(curveAt(pts, 0.95)).toBeCloseTo((0.06 + (0.6 * 0.05) / 0.1) * 0.95 * 0.9, 9);
    expect(kinkedSupplyCurve({ base: 0, slope1: 0.06, slope2: 0.6, optimal: 1, fee: 0 })).toEqual([]);
  });
});

describe('Morpho', () => {
  it('reads a Blue market: fractions to %, fee already out, no cap, curve for the rate after entry', () => {
    const o = morphoMarket(market(), AT)!;
    expect(o.key).toBe('morpho:eip155:1:0xaaaa:supply');
    expect(o.rate).toMatchObject({ value: 5, kind: 'apy', feesIncluded: true, rewardsIncluded: false });
    expect(o.capacity).toMatchObject({ uncapped: true, withdrawableNowUsd: 1_000_000 });
    expect(o.market.name).toContain('LLTV ۸۶٪');
    const e = estimate(o, input);
    expect(e.rateAfterEntry!).toBeLessThan(5);
    expect(e.unknown.some((u) => u.includes('ظرفیت'))).toBe(false);
  });

  it('lists Morpho rewards but does not count them without an end date', () => {
    const e = estimate(morphoMarket(market(), AT)!, input);
    expect(e.rewards).toBe(0);
    expect(e.unknown.some((u) => u.includes('تاریخ پایان'))).toBe(true);
  });

  it('keeps a market with a red warning out of the list', () => {
    const o = morphoMarket(market({ warnings: [{ type: 'bad_debt_unrealized', level: 'RED' }] }), AT)!;
    expect(o.quality).toBe('insufficient');
    expect(estimate(o, input).placement).toBe('insufficient');
  });

  it('reads a V1 vault from netApyExcludingRewards and never deducts its performance fee again', () => {
    const o = morphoVault(vault(), AT)!;
    expect(o.family).toBe('vault');
    expect(o.chain).toBe('eip155:8453');
    expect(o.rate).toMatchObject({ value: 6, feesIncluded: true });
    const e = estimate(o, input);
    expect(e.costs.some((c) => c.key === 'performance-fee')).toBe(false);
    expect(e.baseIncome).toBeCloseTo(1000 * (Math.pow(1.06, 30 / 365) - 1), 9);
  });

  it('takes a V2 vault’s rewards out of avgNetApy so none is counted twice', () => {
    const o = morphoVaultV2(vaultV2(), AT)!;
    expect(o.rate.value).toBeCloseTo(5.5, 9);
    expect(o.quality).toBe('partial');
  });

  it('skips rows the API returns without state', () => {
    const d: MorphoData = { markets: { items: [market({ state: null })] }, vaults: { items: null }, vaultV2s: { items: [] } };
    expect(normalizeMorpho(d, AT)).toEqual([]);
  });
});

describe('Aave V4', () => {
  it('reads strings, 1.0 = 100%, the room left under the cap and Hub liquidity', () => {
    const o = aaveReserve(reserve(), AT)!;
    expect(o.key).toBe('aave:eip155:1:0xspoke:0xusdt:supply');
    expect(o.rate).toMatchObject({ value: 4, feesIncluded: true });
    expect(o.capacity).toMatchObject({ depositRemainingUsd: 1_000_000, withdrawableNowUsd: 20_000_000 });
    expect(o.supplyCurve?.points).toHaveLength(201);
  });

  it('counts a reward only until it ends; conditional rewards and points never', () => {
    const e = estimate(aaveReserve(reserve(), AT)!, input);
    expect(e.rewardLines.map((r) => r.key)).toEqual(['aave:r-open']);
    expect(e.rewards).toBeCloseTo((e.allocatable * 2 * 10) / (100 * 365), 9);
  });

  it('treats a paused or frozen reserve as unavailable', () => {
    const e = estimate(aaveReserve(reserve({ status: { active: true, frozen: true, paused: false } }), AT)!, input);
    expect(e.placement).toBe('inactive');
  });

  it('reads a zero cap as unknown room, not as zero', () => {
    const o = aaveReserve(reserve({ settings: { supplyCap: amount(0) } }), AT)!;
    expect(o.capacity.depositRemainingUsd).toBeNull();
  });
});

describe('ranking for the user’s amount and period', () => {
  const opps = () => [morphoMarket(market(), AT)!, morphoVault(vault(), AT)!, aaveReserve(reserve(), AT)!];

  it('charges gas per network (a stated default without a measured gas price) and filters by family', () => {
    const a = evaluate({ opportunities: opps(), merkl: null, gas: [] }, 1000, NOW);
    const r = selectHorizon(a, 30);
    const eth = r.ranking.top.find((e) => e.key.startsWith('aave:'))!;
    const base = r.ranking.top.find((e) => e.key.includes(':vault'))!;
    expect(eth.costs.reduce((a, c) => a + c.usd, 0)).toBeCloseTo(3 * FALLBACK_TX_USD.ethereum, 9);
    expect(eth.costs.every((c) => c.basis === 'assumed')).toBe(true);
    expect(base.costs.reduce((a, c) => a + c.usd, 0)).toBeCloseTo(3 * FALLBACK_TX_USD.evm, 9);
    expect(selectHorizon(a, 30, 'vault').total).toBe(1);
  });

  it('prices gas from a measured gas price when there is one', () => {
    const a = evaluate({ opportunities: opps(), merkl: null, gas: [{ chainId: 1, gwei: 2, nativeUsd: 3000, at: NOW }] }, 1000, NOW);
    const eth = selectHorizon(a, 30).ranking.top.find((e) => e.key.startsWith('aave:'))!;
    // approve + deposit in, withdraw out: 50k + 200k + 180k gas at 2 gwei and 3000 $/ETH.
    expect(eth.costs.reduce((x, c) => x + c.usd, 0)).toBeCloseTo(430_000 * 2e-9 * 3000, 9);
  });

  it('compares exactly four horizons', () => {
    expect([...HORIZONS]).toEqual([30, 60, 90, 125]);
  });
});

describe('sources fail independently', () => {
  const morphoBody = { data: { markets: { items: [market()] }, vaults: { items: [vault()] }, vaultV2s: { items: [] } } };
  const aaveChains = { data: { chains: [{ chainId: 1 }] } };
  const aaveReserves = { data: { reserves: [reserve()] } };

  function mock(aaveUp: boolean, morphoUp = true) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
      if (url.includes('morpho')) return morphoUp ? json(morphoBody) : json({}, 500);
      if (url.includes('aave')) {
        if (!aaveUp) return json({}, 500);
        return json(body.includes('YieldXChains') ? aaveChains : aaveReserves);
      }
      return json({}, 404);
    }));
  }

  beforeEach(() => resetLendingCache());
  afterEach(() => vi.unstubAllGlobals());

  it('shows Morpho when Aave is down, and says which one failed', async () => {
    mock(false);
    const feed = await getLendingFeed(NOW);
    expect(feed.opportunities.map((o) => o.protocol.id)).toEqual(['morpho', 'morpho']);
    expect(feed.sources.map((s) => [s.id, s.state])).toEqual([
      ['morpho', 'ok'],
      ['aave', 'error'],
      // Not mocked here: their own failure hides nothing else.
      ['midnight', 'error'],
      ['kamino', 'error'],
      ['loopscale', 'error'],
    ]);
  });

  it('keeps a minutes-old copy usable after one failed refresh, and marks it stale later', async () => {
    mock(true);
    await getLendingFeed(NOW);
    mock(false);
    const soon = await getLendingFeed(NOW + 5 * 60_000);
    expect(soon.sources.find((s) => s.id === 'aave')!.state).toBe('ok');
    expect(soon.sources.find((s) => s.id === 'aave')!.fetchedAt).toBe(new Date(NOW).toISOString());
    expect(soon.opportunities.filter((o) => o.protocol.id === 'aave').every((o) => o.quality !== 'stale')).toBe(true);
    const later = await getLendingFeed(NOW + 20 * 60_000);
    expect(later.sources.find((s) => s.id === 'aave')!.state).toBe('stale');
    expect(later.opportunities.filter((o) => o.protocol.id === 'aave').every((o) => o.quality === 'stale')).toBe(true);
  });

  it('GET /api/lending answers 200 with one source up and 502 with none', async () => {
    mock(false);
    expect((await GET()).status).toBe(200);
    resetLendingCache();
    mock(false, false);
    expect((await GET()).status).toBe(502);
  });
});

describe('lending list render', () => {
  it('shows a row and its details in Persian, symbols isolated, no raw keys', async () => {
    const { renderToString } = await import('react-dom/server');
    const { RankingRow } = await import('../../src/components/market/MarketAnalysis');
    const { OpportunityDetails } = await import('../../src/components/market/OpportunityDetails');
    const { Coverage } = await import('../../src/components/market/Coverage');
    const { assertPersianMoney } = await import('../helpers/text');
    const o = aaveReserve(reserve(), AT)!;
    const m = morphoMarket(market(), AT)!;
    const a = evaluate({ opportunities: [o, m], merkl: null, gas: [] }, 1000, NOW);
    const v = selectHorizon(a, 30);
    const html = [
      ...a.rows.map((row, i) => renderToString(<RankingRow row={row} rank={i + 1} days={30} open={false} onToggle={() => {}} modelVersion={a.modelVersion} />)),
      ...a.rows.map((row) => renderToString(<OpportunityDetails row={row} days={30} modelVersion={a.modelVersion} />)),
      renderToString(<Coverage sources={[{ id: 'aave', name: 'Aave V4', state: 'error', fetchedAt: null, count: 0, error: 'x' }]} counts={v.counts} total={v.total} />),
    ].join('');
    expect(html).toContain('سود خالص');
    expect(html).toContain('نرخ پس از ورود');
    expect(html).toContain('پاداش AAVE');
    expect(html).toContain('در دسترس نیست');
    expect(html).not.toContain('aave:r-open');
    expect(html).not.toContain('NaN');
    const visible = html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, '');
    assertPersianMoney(visible);
  });
});
