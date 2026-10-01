import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { Opportunity, RewardStream } from '../../src/types/opportunity';
import { evaluate, selectHorizon } from '../../src/lib/market/analysis';
import { HORIZONS, LEVERAGE_POLICY, MAX_POOL_SHARE_WITHOUT_QUOTE, PT_LOOP_POLICY, TOP_LIMIT } from '../../src/lib/opportunity/policy';
import { buildPtLoops } from '../../src/lib/opportunity/leverage';
import { estimate } from '../../src/lib/opportunity/estimate';
import { ytOpportunity } from '../../src/lib/opportunity/from-market';
import type { MarketListing } from '../../src/types/market';
import { kaminoReserve, fetchKamino } from '../../src/lib/lending/kamino';
import { loopscaleVault, type LoopscaleVaultInfo } from '../../src/lib/lending/loopscale';
import { morphoMarket, fetchMorpho, type RawMorphoMarket } from '../../src/lib/lending/morpho';
import { ptRef } from '../../src/lib/protocols/pendle';
import { withRetry, UpstreamError } from '../../src/lib/protocols/base';
import { badgesOf, exitShort } from '../../src/lib/market/labels';
import { COVERAGE } from '../../src/lib/market/coverage';

// Controlled test data for the formulas and schema-shaped fixtures; not market data.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const AT = new Date(NOW).toISOString();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const run = (list: Opportunity[], capital = 1000) => evaluate({ opportunities: list, merkl: null, gas: [] }, capital, NOW);

const lend = (key: string, over: Partial<Opportunity> = {}): Opportunity => ({
  key,
  family: 'lend',
  protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
  chain: 'eip155:8453',
  market: { id: key, address: null, name: 'USDC' },
  assets: { deposit: [{ symbol: 'USDC', address: '0xusdc' }] },
  rate: { value: 6, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT },
  maturity: null,
  capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  quality: 'current',
  sources: [],
  ...over,
});

const pt = (key: string, maturityDays: number, over: Partial<Opportunity> = {}): Opportunity =>
  lend(key, {
    family: 'pt',
    protocol: { id: 'pendle', version: null, name: 'Pendle' },
    rate: { value: 12, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT },
    maturity: inDays(maturityDays),
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'secondary' },
    poolLiquidityUsd: 5e7,
    ...over,
  });

describe('non-dollar fiat deposits', () => {
  it('give no dollar figure: a peso or euro return is an exchange-rate bet, not dollars', async () => {
    const { nonUsdFiat } = await import('../../src/lib/opportunity/policy');
    for (const [sym, code] of [['ARSs', 'ARS'], ['wARS', 'ARS'], ['EURC', 'EUR'], ['tGBP', 'GBP'], ['MXNB', 'MXN'], ['COLt', 'COL']] as const) expect(nonUsdFiat(sym)).toBe(code);
    for (const sym of ['USDC', 'sUSDe', 'PENDLE', 'BOLD', 'PYUSD', 'AUSD', 'WETH', 'frxUSD']) expect(nonUsdFiat(sym)).toBeNull();
    const ars = run([lend('ars', { assets: { deposit: [{ symbol: 'ARSs', address: '0xars' }] }, rate: { value: 22, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT } })]).rows[0].byHorizon[90];
    expect(ars.placement).toBe('needs-model');
    expect(ars.net).toBeNull();
    expect(ars.reason).toContain('ARS');
  });
});

describe('volatile deposits', () => {
  it('give no dollar figure, except dollars, ETH/BTC, majors, PENDLE and established DeFi tokens', async () => {
    const { volatileDeposit } = await import('../../src/lib/opportunity/policy');
    for (const sym of ['USDC', 'sUSDe', 'wstETH', 'cbBTC', 'SOL', 'jitoSOL', 'fragSOL', 'kHYPE', 'PENDLE', 'AAVE', 'stkAAVE', 'CRV', 'MORPHO', 'ENA', 'PAXG']) expect(volatileDeposit(sym)).toBe(false);
    for (const sym of ['CARROT', 'mtwCARROT', 'PEPE', 'veMEZO', 'KAITO']) expect(volatileDeposit(sym)).toBe(true);
    const carrot = run([lend('c', { family: 'stake', assets: { deposit: [{ symbol: 'mtwCARROT', address: '0xc' }] } })]).rows[0].byHorizon[30];
    expect(carrot.placement).toBe('needs-model');
    expect(carrot.reason).toContain('پرنوسان');
    expect(run([lend('p', { assets: { deposit: [{ symbol: 'PENDLE', address: '0xp' }] } })]).rows[0].byHorizon[30].placement).toBe('ranked');
  });
});

describe('lending rate spikes', () => {
  it('ranks on the lower of today and the 7-day average; a clear spike is marked and shown as a range', () => {
    // 30% today at full utilization, 7.7% over the week (live USDC/USD3 on Morpho).
    const spike = run([lend('s', { rate: { value: 30, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT, avg7d: 7.7 } })], 10_000).rows[0].byHorizon[90];
    const calm = run([lend('c', { rate: { value: 7.7, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT } })], 10_000).rows[0].byHorizon[90];
    expect(spike.net).toBeCloseTo(calm.net!, 6);
    expect(spike.confidence).toBe('suspect');
    expect(spike.range!.high).toBeGreaterThan(spike.range!.low * 3);
    // Slightly above the average: still the lower rate, but not marked.
    const mild = run([lend('m', { rate: { value: 9, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT, avg7d: 7.7 } })], 10_000).rows[0].byHorizon[90];
    expect(mild.net).toBeCloseTo(calm.net!, 6);
    expect(mild.confidence).toBeUndefined();
    // Below its average: today's rate stands.
    const low = run([lend('l', { rate: { value: 5, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT, avg7d: 7.7 } })], 10_000).rows[0].byHorizon[90];
    expect(low.net!).toBeLessThan(calm.net!);
  });
});

describe('four horizons, each on its own', () => {
  const row = (d: number) => run([pt(`pt${d}`, d)]).rows[0].byHorizon;

  it('maturity at day 20: redeemed, then cash — the same dollars at every horizon, never reinvested', () => {
    const h = row(20);
    for (const d of HORIZONS) {
      expect(h[d].placement).toBe('ranked');
      expect(h[d].earningDays).toBe(20);
      expect(h[d].net).toBeCloseTo(h[30].net!, 9);
    }
  });

  it('maturity at day 45: no number at 30 days (exit before maturity has no model), the same number from 60 on', () => {
    const h = row(45);
    expect(h[30].placement).toBe('needs-model');
    expect(h[30].net).toBeNull();
    expect(h[60].placement).toBe('ranked');
    expect(h[125].net).toBeCloseTo(h[60].net!, 9);
    // A longer horizon is not automatically more profit.
    expect(h[125].net).toBeLessThanOrEqual(h[60].net! + 1e-9);
  });

  it('maturity at day 75: only 90 and 125 days rank it', () => {
    const h = row(75);
    expect([h[30].placement, h[60].placement, h[90].placement, h[125].placement]).toEqual(['needs-model', 'needs-model', 'ranked', 'ranked']);
  });

  it('maturity after 125 days: its profit to maturity is never shown as a horizon’s profit', () => {
    const h = row(300);
    for (const d of HORIZONS) {
      expect(h[d].placement).toBe('needs-model');
      expect(h[d].net).toBeNull();
    }
  });

  it('computes each horizon, never scales the 30-day number', () => {
    const h = run([lend('v')]).rows[0].byHorizon;
    const gross = (d: number) => 1000 * (Math.pow(1.06, d / 365) - 1);
    // Fixed gas makes the ratio non-linear; the base income follows the compounded rate of each horizon.
    for (const d of HORIZONS) expect(h[d].baseIncome).toBeCloseTo((1000 - h[d].costs.find((c) => c.key === 'gas-entry')!.usd) * (gross(d) / 1000), 9);
    expect(h[60].net! / h[30].net!).not.toBeCloseTo(2, 3);
  });

  it('a campaign that ends between horizons stops counting there; a vesting reward is not cash in the horizon', () => {
    const r: RewardStream = { key: '1:c', source: 'merkl', kind: 'token', token: null, aprUsd: 10, endsAt: inDays(45), conditional: false, vesting: false };
    const h = run([lend('r', { rewards: [r] })]).rows[0].byHorizon;
    expect(h[30].rewardLines[0].days).toBe(30);
    expect(h[60].rewardLines[0].days).toBeCloseTo(45, 9);
    expect(h[90].rewards).toBeCloseTo(h[60].rewards, 9);
    const v = run([lend('v', { rewards: [{ ...r, vesting: true }] })]).rows[0].byHorizon[60];
    expect(v.rewards).toBe(0);
    expect(v.assumptions.some((a) => a.includes('vesting'))).toBe(true);
  });
});

describe('capital, costs and capacity', () => {
  it('pays the entry cost out of the capital, never with extra money', () => {
    const e = run([lend('v')]).rows[0].byHorizon[30];
    const entry = e.costs.find((c) => c.key === 'gas-entry')!.usd;
    expect(e.allocatable).toBeCloseTo(1000 - entry, 9);
    expect(e.netPct).toBeCloseTo((e.net! / 1000) * 100, 12);
  });

  it('unused capital earns nothing and the yield is on the whole capital', () => {
    const e = run([lend('c', { capacity: { depositRemainingUsd: 400, withdrawableNowUsd: 1e9 } })]).rows[0].byHorizon[30];
    expect(e.allocatable).toBe(400);
    expect(e.baseIncome).toBeCloseTo(400 * (Math.pow(1.06, 30 / 365) - 1), 9);
    expect(e.netPct).toBeCloseTo((e.net! / 1000) * 100, 12);
    expect(badgesOf(e, lend('c'))).toContain('ظرفیت محدود');
  });

  it('a full market has no capacity, a loss is unprofitable — both kept out of the top list, not deleted', () => {
    const a = run([lend('full', { capacity: { depositRemainingUsd: 0, withdrawableNowUsd: 0 } }), lend('low', { rate: { ...lend('x').rate, value: 0.001 } })]);
    const v = selectHorizon(a, 30);
    expect(v.ranking.top).toHaveLength(0);
    expect(v.counts['no-capacity']).toBe(1);
    expect(v.counts.unprofitable).toBe(1);
    expect(a.rows).toHaveLength(2);
  });

  it('without a quote, a PT is only estimated for an amount small against its pool', () => {
    const small = run([pt('p', 20, { poolLiquidityUsd: 1000 / MAX_POOL_SHARE_WITHOUT_QUOTE })]).rows[0].byHorizon[30];
    expect(small.placement).toBe('ranked');
    expect(small.quality).toBe('partial');
    const big = run([pt('p', 20, { poolLiquidityUsd: 100_000 })]).rows[0].byHorizon[30];
    expect(big.placement).toBe('needs-model');
    expect(run([pt('p', 20, { poolLiquidityUsd: null })]).rows[0].byHorizon[30].placement).toBe('needs-model');
  });
});

describe('selecting at most sixty', () => {
  const many = (prefix: string, n: number, rate: (i: number) => number, over: Partial<Opportunity> = {}) => Array.from({ length: n }, (_, i) => lend(`${prefix}${i}`, { rate: { ...lend('x').rate, value: rate(i) }, ...over }));

  it('takes the best sixty from all families together, with no quota', () => {
    const vaults = many('v', 50, (i) => 20 + i * 0.1, { family: 'vault' });
    const loans = many('l', 50, (i) => 5 + i * 0.1);
    const v = selectHorizon(run([...vaults, ...loans]), 30);
    expect(v.ranking.top).toHaveLength(TOP_LIMIT);
    expect(v.ranking.top.filter((e) => e.key.startsWith('v'))).toHaveLength(50);
    expect(v.ranking.rest).toHaveLength(40);
    for (let i = 1; i < v.ranking.top.length; i++) expect(v.ranking.top[i - 1].net!).toBeGreaterThanOrEqual(v.ranking.top[i].net!);
  });

  it('removes duplicates before selecting, so one market never takes two places', () => {
    const list = [...many('a', 40, (i) => 10 + i), ...many('a', 40, (i) => 10 + i)];
    const v = selectHorizon(run(list), 30);
    expect(v.total).toBe(40);
    expect(new Set(v.ranking.top.map((e) => e.key)).size).toBe(v.ranking.top.length);
  });

  it('keeps assets with the same symbol on different networks apart', () => {
    const a = run([lend('m1', { chain: 'eip155:1' }), lend('m2', { chain: 'eip155:8453' })]);
    expect(selectHorizon(a, 30).ranking.top).toHaveLength(2);
  });

  it('breaks a real tie by data quality, then exit terms, then a stable key', () => {
    const a = run([lend('b'), lend('a'), lend('q', { quality: 'partial' }), lend('x', { exit: { type: 'queue' } })]);
    expect(selectHorizon(a, 30).ranking.top.map((e) => e.key)).toEqual(['a', 'b', 'x', 'q']);
  });

  it('the top set changes with the capital and with the horizon', () => {
    const list = [lend('capped', { rate: { ...lend('x').rate, value: 9 }, capacity: { depositRemainingUsd: 2000, withdrawableNowUsd: 1e9 } }), lend('open', { rate: { ...lend('x').rate, value: 7 } }), pt('pt45', 45)];
    expect(selectHorizon(run(list, 1000), 30).ranking.top[0].key).toBe('capped');
    expect(selectHorizon(run(list, 50_000), 30).ranking.top[0].key).toBe('open');
    const keys = (d: 30 | 60) => selectHorizon(run(list, 1000), d).ranking.top.map((e) => e.key);
    expect(keys(30)).not.toContain('pt45');
    expect(keys(60)).toContain('pt45');
  });

  it('a filter or search re-selects from the whole narrowed domain and says so', () => {
    const list = [...many('v', 70, (i) => 20 + i, { family: 'vault' }), lend('solo', { rate: { ...lend('x').rate, value: 1 } })];
    const a = run(list);
    expect(selectHorizon(a, 30).ranking.top.some((e) => e.key === 'solo')).toBe(false);
    const f = selectHorizon(a, 30, 'lend');
    expect(f.narrowed).toBe(true);
    expect(f.ranking.top.map((e) => e.key)).toEqual(['solo']);
    expect(selectHorizon(a, 30, 'all', 'base').total).toBe(71);
  });
});

describe('leverage and PT loops', () => {
  const debtMarket = (collateral: string, maxLtv = 0.915): Opportunity =>
    lend('morpho:eip155:8453:0xm:supply', {
      market: { id: '0xm', address: null, name: 'USDC · وثیقه PT' },
      borrow: { ratePct: 5, curve: null, availableUsd: 1e9, collateral: [{ token: { symbol: 'PT-sUSDe', address: collateral }, maxLtv, yield: null }], metric: 'ltv' },
    });
  const ptWith = (address: string, days: number) => pt(`pendle:eip155:8453:0xpool${days}:pt`, days, { assets: { deposit: [{ symbol: 'sUSDe', address: '0xsusde' }] }, ptToken: { symbol: 'PT-sUSDe', address } });

  it('matches the loan market to the PT by exact address, never by symbol', () => {
    expect(buildPtLoops([debtMarket('0xpt'), ptWith('0xpt', 45)])).toHaveLength(1);
    expect(buildPtLoops([debtMarket('0xother'), ptWith('0xpt', 45)])).toHaveLength(0);
  });

  it('closes the loop at maturity: debt paid only until then, no number before it', () => {
    const a = run([debtMarket('0xpt'), ptWith('0xpt', 45)]);
    const loop = a.rows.find((r) => r.o.family === 'leverage')!;
    expect(loop.byHorizon[30].placement).toBe('needs-model');
    const e = loop.byHorizon[60];
    expect(e.earningDays).toBe(45);
    const x = e.leverage!;
    expect(x.policy).toBe(PT_LOOP_POLICY.version);
    expect(x.leverage).toBeLessThanOrEqual(PT_LOOP_POLICY.maxLeverage);
    expect(e.debtCost).toBeCloseTo(x.debt * (Math.pow(1.05, 45 / 365) - 1), 9);
    expect(e.baseIncome).toBeCloseTo(x.gross * (Math.pow(1.12, 45 / 365) - 1), 9);
    expect(loop.byHorizon[125].net).toBeCloseTo(e.net!, 9);
    expect(exitShort(e, loop.o)).toBe('در سررسید');
  });

  it('never picks the protocol maximum leverage', () => {
    const e = run([debtMarket('0xpt', 0.965), ptWith('0xpt', 45)]).rows.find((r) => r.o.family === 'leverage')!.byHorizon[60];
    expect(e.leverage!.leverage).toBeLessThanOrEqual(LEVERAGE_POLICY.maxLeverage);
    expect(e.leverage!.leverage).toBeLessThan(1 / (1 - 0.965));
  });

  it('keeps a direct market and a managed vault of the same asset as two opportunities', () => {
    const a = run([lend('direct'), lend('vault', { family: 'vault' })]);
    expect(selectHorizon(a, 30).ranking.top).toHaveLength(2);
  });
});

describe('adapters', () => {
  it('Pendle: reads the PT address from an object or an id string', () => {
    expect(ptRef({ address: '0xABCDEF0000000000000000000000000000000001', symbol: 'PT-x' })).toEqual({ symbol: 'PT-x', address: '0xabcdef0000000000000000000000000000000001' });
    expect(ptRef('1-0xABCDEF0000000000000000000000000000000001')!.address).toBe('0xabcdef0000000000000000000000000000000001');
    expect(ptRef(undefined)).toBeNull();
    expect(ptRef('nope')).toBeNull();
  });

  it('Morpho: dates the rate by the fetch, keeps the on-chain update apart (a quiet market is not stale)', () => {
    const m: RawMorphoMarket = {
      marketId: '0xab',
      lltv: '860000000000000000',
      loanAsset: { address: '0xusdc', symbol: 'USDC', chain: { id: 1 } },
      collateralAsset: { address: '0xwbtc', symbol: 'WBTC', chain: { id: 1 } },
      warnings: [],
      currentIrmCurve: null,
      state: { supplyApy: 0.05, supplyAssetsUsd: 1e7, borrowAssetsUsd: 8e6, liquidityAssetsUsd: 2e6, fee: 0, timestamp: String((NOW - 5 * 86_400_000) / 1000), rewards: [] },
    };
    const o = morphoMarket(m, AT)!;
    expect(o.rate.at).toBe(AT);
    expect(o.sources[0].sourceUpdatedAt).toBe(inDays(-5));
    expect(estimate(o, { capital: 1000, days: 30, now: NOW }).quality).toBe('current');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Morpho: pages until every list is exhausted', async () => {
    const skips: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const { variables } = JSON.parse(String(init?.body));
      skips.push(variables.skip);
      const n = variables.skip === 0 ? variables.first : 3;
      const items = Array.from({ length: n }, (_, i) => ({ marketId: `0x${variables.skip + i}` }));
      return new Response(JSON.stringify({ data: { markets: { items }, vaults: { items: [] }, vaultV2s: { items: [] } } }), { status: 200 });
    }));
    const d = await fetchMorpho();
    expect(skips).toEqual([0, 100]);
    expect(d.markets.items).toHaveLength(103);
  });

  it('Kamino: APY fractions to %, the lending part only, deposit room from the limit in token units', () => {
    const o = kaminoReserve(
      {
        market: { lendingMarket: 'M', name: 'Main' },
        metric: { reserve: 'R', liquidityToken: 'USDC', liquidityTokenMint: 'EPjF', totalSupply: '1000000', totalSupplyUsd: '1000000' },
        stats: { status: 'Active', supplyApyBreakdown: { lending: '0.052', incentives: '0.02' }, supplyRewardApys: [{ rewardToken: 'KMNO', apy: '0.02' }], liquidityAvailableUsd: '300000', depositLimit: '1200000' },
      },
      AT,
    )!;
    expect(o.rate.value).toBeCloseTo(5.2, 12);
    expect(o.capacity.depositRemainingUsd).toBeCloseTo(200_000, 6);
    expect(o.capacity.withdrawableNowUsd).toBe(300_000);
    expect(o.unofficialSource).toBe(true);
    expect(o.quality).toBe('partial');
    // The farm reward has no end date: listed, never counted.
    const e = estimate(o, { capital: 1000, days: 30, now: NOW });
    expect(e.rewards).toBe(0);
    expect(e.unknown.some((u) => u.includes('تاریخ پایان'))).toBe(true);
    expect(kaminoReserve({ market: { lendingMarket: 'M' }, metric: { reserve: 'R', liquidityTokenMint: 'x', totalSupplyUsd: '1000000' }, stats: { supplyApyBreakdown: { lending: 'bad' } } }, AT)).toBeNull();
  });

  it('Kamino: a changed schema is an upstream error, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })));
    await expect(fetchKamino(AT)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('Loopscale: CBPS fees and native units — APR from interest per second, after the fee', () => {
    const v: LoopscaleVaultInfo = {
      vault: { address: 'V', principalMint: 'USDC', depositsEnabled: true },
      vaultMetadata: { name: 'USDC Prime' },
      vaultStrategy: { strategy: { tokenBalance: '200000000000', currentDeployedAmount: '800000000000', externalYieldAmount: '0', interestPerSecond: 2536.53, interestFee: '100000' }, externalYieldInfo: null },
      strategySummary: { totalSupplyUsd: 1_000_000 },
      pause: { depositsPaused: false, withdrawalsPaused: false },
    };
    const o = loopscaleVault(v, AT, 'USDC')!;
    const gross = (2536.53 * 365 * 86_400) / 1e12;
    expect(o.rate).toMatchObject({ kind: 'apr' });
    expect(o.rate.value!).toBeCloseTo(gross * 0.9 * 100, 9);
    expect(o.capacity.withdrawableNowUsd).toBeCloseTo(200_000, 6);
    expect(loopscaleVault({ ...v, pause: { depositsPaused: true } }, AT, 'USDC')!.risk!.paused).toBe(true);
  });

  it('Loopscale: deposit cap in native units, reward end times as strings, ended schedules dropped', () => {
    const v: LoopscaleVaultInfo = {
      vault: { address: 'V', principalMint: 'USDC', depositsEnabled: true },
      vaultMetadata: { name: 'USDC Prime', depositCap: '1500000000000' },
      vaultStrategy: { strategy: { tokenBalance: '200000000000', currentDeployedAmount: '800000000000', externalYieldAmount: '0', interestPerSecond: 2536.53, interestFee: '100000' }, externalYieldInfo: null },
      strategySummary: { totalSupplyUsd: 1_000_000 },
      vaultRewardsSchedules: [
        { rewardMint: 'ENDED', rewardEndTime: String(Date.parse(AT) / 1000 - 86_400) },
        { rewardMint: 'LIVE', rewardEndTime: String(Date.parse(AT) / 1000 + 86_400) },
      ],
    };
    const o = loopscaleVault(v, AT, 'USDC')!;
    expect(o.capacity.depositRemainingUsd).toBeCloseTo(500_000, 6);
    expect(o.rewards.map((r) => r.token.address)).toEqual(['LIVE']);
    expect(o.rewards[0].endsAt).toBe(new Date(Date.parse(AT) + 86_400_000).toISOString());
    expect(loopscaleVault({ ...v, vaultMetadata: { name: 'x', depositCap: null } }, AT, 'USDC')!.capacity.depositRemainingUsd).toBeNull();
  });

  it('retries a transient failure with backoff, never a client error', async () => {
    let n = 0;
    await expect(withRetry(async () => (++n < 3 ? Promise.reject(new UpstreamError('X', 503)) : 'ok'), 3, 1, async () => {})).resolves.toBe('ok');
    n = 0;
    await expect(withRetry(async () => { n++; throw new UpstreamError('X', 404); }, 3, 1, async () => {})).rejects.toMatchObject({ status: 404 });
    expect(n).toBe(1);
  });
});

describe('YT held to maturity', () => {
  const listing = (over: Partial<MarketListing> = {}): MarketListing => ({
    id: '1-0xpool',
    name: 'sUSDe',
    platform: 'Ethena',
    icon: null,
    chain: 'Ethereum',
    maturity: inDays(45),
    impliedAPY: 10,
    baseAPY: 14,
    liquidity: 5e8,
    hasPoints: true,
    ytMultiplier: null,
    points: null,
    categories: [],
    isNew: false,
    asset: { symbol: 'sUSDe', address: '0xsusde' },
    sourceUpdatedAt: AT,
    expired: false,
    daysToMaturity: 45,
    ...over,
  });
  const yt = (over: Partial<MarketListing> = {}, protocol: 'pendle' | 'spectra' = 'pendle') => ytOpportunity(protocol, listing(over), AT, NOW)!;

  it('pays the YT price for the yield until maturity; the YT itself ends at zero', () => {
    const h = run([yt()]).rows[0].byHorizon;
    expect(h[30].placement).toBe('needs-model');
    const e = h[60];
    const S = 1000 - e.costs.find((c) => c.key === 'gas-entry')!.usd;
    const p = 1 - Math.pow(1.1, -45 / 365);
    // Pendle keeps 5% of the YT's yield.
    const income = (S / p) * (Math.pow(1.14, 45 / 365) - 1) * 0.95;
    expect(e.baseIncome).toBeCloseTo(income, 6);
    expect(e.costs.find((c) => c.key === 'yt-principal')!.usd).toBeCloseTo(S, 9);
    expect(e.net).toBeCloseTo(income - 1000 - e.costs.find((c) => c.key === 'gas-exit')!.usd, 6);
    expect(e.placement).toBe('ranked');
    expect(e.quality).toBe('partial');
    expect(h[125].net).toBeCloseTo(e.net!, 9);
  });

  it('loses money when the base yield is below the implied rate — unprofitable, not in the top list', () => {
    const e = run([yt({ baseAPY: 6 })]).rows[0].byHorizon[60];
    expect(e.net!).toBeLessThan(0);
    expect(e.placement).toBe('unprofitable');
  });

  it('never prices points, and reads Spectra’s base yield as simple APR', () => {
    const e = run([yt()]).rows[0].byHorizon[60];
    expect(e.rewards).toBe(0);
    expect(e.assumptions.some((a) => a.includes('پوینت'))).toBe(true);
    expect(yt({}, 'spectra').rate.kind).toBe('apr');
    expect(ytOpportunity('pendle', listing({ baseAPY: null }), AT, NOW)).toBeNull();
  });

  it('gives a YT on a probably temporary base yield (far above the market rate) no dollar figure', () => {
    // 44% today against a 13.5% market rate: more than 5 points above and more than twice it.
    const e = run([yt({ impliedAPY: 13.5, baseAPY: 44 })]).rows[0].byHorizon[60];
    expect(e.placement).toBe('needs-model');
    expect(e.net).toBeNull();
    expect(e.reason).toContain('احتمالاً موقت');
  });

  it('uses an executable quote for this amount: the YT actually bought, price impact included', () => {
    const q = { side: 'yt' as const, usd: 1000, units: 30_000, unitUsd: 1, priceImpactPct: 2.5, at: AT, source: 'Pendle' as const };
    // Too big for the pool on the mid rate, but quoted.
    const o = { ...yt({ liquidity: 1e6 }), quote: q };
    const e = run([o]).rows[0].byHorizon[60];
    const S = 1000 - e.costs.find((c) => c.key === 'gas-entry')!.usd;
    const income = 30_000 * (S / 1000) * (Math.pow(1.14, 45 / 365) - 1) * 0.95;
    expect(e.baseIncome).toBeCloseTo(income, 6);
    expect(e.net).toBeCloseTo(income - 1000 - e.costs.find((c) => c.key === 'gas-exit')!.usd, 6);
    expect(e.assumptions.join()).toContain('quote');
    // A quote for another amount does not speak for this one.
    expect(run([{ ...o, quote: { ...q, usd: 5000 } }]).rows[0].byHorizon[60].placement).toBe('needs-model');
  });

  it('picks the Pendle markets that wait for a quote, the most promising first, capped per side', async () => {
    const { quoteCandidates, quoteId } = await import('../../src/lib/market/quotes');
    const { MAX_QUOTES_PER_SIDE } = await import('../../src/lib/opportunity/policy');
    const many = Array.from({ length: MAX_QUOTES_PER_SIDE + 3 }, (_, i) => ({ ...yt({ id: `1-0x${String(i).padStart(40, '0')}`, liquidity: 1e5, baseAPY: 11 + i / 10 }) }));
    const a = run(many);
    const want = quoteCandidates(a, 1000, {});
    expect(want.filter((w) => w.side === 'yt')).toHaveLength(MAX_QUOTES_PER_SIDE);
    // Highest base-over-implied spread first; anything already asked is not asked again.
    expect(want[0].market).toBe(many[many.length - 1].market.address);
    expect(quoteCandidates(a, 1000, { [quoteId(many[many.length - 1].key, 1000)]: null }).some((w) => w.market === many[many.length - 1].market.address)).toBe(false);
  });

  it('checks the pool against the notional bought, not the capital', () => {
    const p = 1 - Math.pow(1.1, -45 / 365);
    const needed = 1000 / p / MAX_POOL_SHARE_WITHOUT_QUOTE;
    expect(run([yt({ liquidity: needed * 0.9 })]).rows[0].byHorizon[60].placement).toBe('needs-model');
    expect(run([yt({ liquidity: needed * 1.1 })]).rows[0].byHorizon[60].placement).not.toBe('needs-model');
  });
});

describe('coverage matrix', () => {
  it('lists every requested protocol by product, and never ranks a product without a model', () => {
    for (const p of ['Pendle', 'Exponent', 'Spectra', 'Morpho', 'Kamino', 'Loopscale', 'Aave', 'Raydium', 'Orca', 'Jupiter', 'Merkl']) expect(COVERAGE.some((r) => r.protocol.includes(p))).toBe(true);
    for (const r of COVERAGE) if (r.status === 'unavailable' || r.status === 'insufficient') expect(r.ranked).toBe(false);
  });
});

describe('render', () => {
  it('table row and details agree and read in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { RankingRow } = await import('../../src/components/market/MarketAnalysis');
    const { OpportunityDetails } = await import('../../src/components/market/OpportunityDetails');
    const { formatMoneyNumber } = await import('../../src/lib/utils/formatting');
    const { assertPersianMoney } = await import('../helpers/text');
    const ytRow = lend('y', { family: 'yt', rate: { value: 14, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT }, maturity: inDays(45), exit: { type: 'maturity' }, poolLiquidityUsd: 5e8, yt: { impliedPct: 10, hasPoints: true, yieldFeePct: 5 } });
    const a = run([pt('p', 45), lend('l'), ytRow]);
    expect(a.rows.find((r) => r.o.family === 'yt')!.byHorizon[60].placement).toBe('ranked');
    for (const row of a.rows) {
      const e = row.byHorizon[60];
      const html = renderToString(<RankingRow row={row} rank={1} days={60} open onToggle={() => {}} modelVersion={a.modelVersion} />) + renderToString(<OpportunityDetails row={row} days={60} modelVersion={a.modelVersion} />);
      const digits = Math.abs(e.net!) >= 100 ? 0 : Math.abs(e.net!) >= 1 ? 2 : 4;
      const money = formatMoneyNumber(e.net!, digits);
      expect(html.split(`>${money}<`).length).toBeGreaterThan(2); // the row and the details show the same number
      for (const t of ['۳۰', '۶۰', '۹۰', '۱۲۵']) expect(html).toContain(t);
      expect(html).not.toContain('NaN');
      assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, ''));
    }
  });
});
