import { describe, expect, it } from 'vitest';
import type { BorrowSide, Opportunity, OrderBook } from '../../src/types/opportunity';
import { buildLoops, defaultLeverageInput } from '../../src/lib/opportunity/leverage';
import { estimate } from '../../src/lib/opportunity/estimate';
import { rateAfterBorrow, kinkedBorrowCurve } from '../../src/lib/opportunity/curve';
import { borrowQuotes } from '../../src/lib/opportunity/borrow';
import { maxLoopLeverage } from '../../src/lib/calculators/trade';
import { morphoMarket, type RawMorphoMarket } from '../../src/lib/lending/morpho';
import { normalizeAave, type RawAaveReserve } from '../../src/lib/lending/aave';
import { evaluate, selectHorizon } from '../../src/lib/market/analysis';

// Controlled test data for the formulas; adapter fixtures follow the official
// schemas field by field. Not market data.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const AT = new Date(NOW).toISOString();

const side = (over: Partial<BorrowSide> = {}): BorrowSide => ({
  ratePct: 5,
  curve: null,
  availableUsd: 1e9,
  collateral: [{ token: { symbol: 'sUSDe', address: '0xsusde' }, maxLtv: 0.86, yield: { pct: 8, kind: 'apy', source: 'آزمون' } }],
  metric: 'ltv',
  ...over,
});

const market = (over: Partial<Opportunity> = {}): Opportunity => ({
  key: 'morpho:eip155:1:0xm:supply',
  family: 'lend',
  protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
  chain: 'eip155:1',
  market: { id: '0xm', address: null, name: 'USDC · وثیقه sUSDe' },
  assets: { deposit: [{ symbol: 'USDC', address: '0xusdc' }] },
  rate: { value: 4, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT },
  maturity: null,
  capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  borrow: side(),
  quality: 'current',
  sources: [],
  ...over,
});

const pol = (minHealth: number, maxLeverage = 10) => ({ version: 'test', minHealth, maxLeverage });
const input = (lev = pol(1.3)) => ({ capital: 1000, days: 30, now: NOW, leverage: lev });

describe('loops from borrow sides', () => {
  it('builds only pairs that move together and whose collateral has its own yield', () => {
    const loops = buildLoops([
      market(),
      market({ key: 'k2', borrow: side({ collateral: [{ token: { symbol: 'WBTC', address: '0xwbtc' }, maxLtv: 0.86, yield: { pct: 1, kind: 'apr', source: 't' } }] }) }),
      market({ key: 'k3', borrow: side({ collateral: [{ token: { symbol: 'USDT', address: '0xusdt' }, maxLtv: 0.9, yield: null }] }) }),
    ]);
    expect(loops.map((l) => l.key)).toEqual(['morpho:eip155:1:0xm:supply:loop:0xsusde']);
    expect(loops[0]).toMatchObject({ family: 'leverage', loop: { pairClass: 'usd', maxLtv: 0.86 } });
  });

  it('is estimated only under a leverage policy, and never as complete data', () => {
    const [loop] = buildLoops([market()]);
    expect(estimate(loop, { capital: 1000, days: 30, now: NOW }).placement).toBe('needs-model');
    const e = estimate(loop, input({ ...defaultLeverageInput }));
    expect(e.leverage!.policy).toBe(defaultLeverageInput.version);
    expect(e.quality).toBe('partial');
  });
});

describe('loop maths (report tests 10 and 12)', () => {
  it('E 1000, 3×, collateral 8% APY, borrow 5% APY, 30 days, no costs → about 11.00 on own money', () => {
    const [loop] = buildLoops([market()]);
    const e = estimate(loop, input(pol(1.05, 3)));
    const x = e.leverage!;
    expect(x.leverage).toBe(3);
    expect(x.gross).toBeCloseTo(3000, 9);
    expect(x.debt).toBeCloseTo(2000, 9);
    expect(e.baseIncome!).toBeCloseTo(3000 * (Math.pow(1.08, 30 / 365) - 1), 9); // ≈ 19.04
    expect(e.debtCost).toBeCloseTo(2000 * (Math.pow(1.05, 30 / 365) - 1), 9); // ≈ 8.04
    expect(e.net!).toBeCloseTo(11.0, 1);
    // The portfolio counts own money, never the gross position.
    expect(x.equity).toBe(1000);
  });

  it('takes the highest leverage that keeps the policy’s health, not the protocol maximum', () => {
    const [loop] = buildLoops([market()]);
    const x = estimate(loop, input()).leverage!;
    expect(x.leverage).toBeCloseTo(maxLoopLeverage(86, 1.3), 12);
    expect(x.leverage).toBeLessThan(1 / (1 - 0.86));
    expect(x.health.value).toBeCloseTo(1.3, 9);
  });

  it('never goes above the policy’s leverage cap, whatever the health allows', () => {
    const [loop] = buildLoops([market()]);
    expect(estimate(loop, input(pol(1.3, 2))).leverage!.leverage).toBe(2);
    expect(estimate(loop, input(pol(1.3, 6))).leverage!.leverage).toBeCloseTo(maxLoopLeverage(86, 1.3), 12);
  });

  it('reports how far the collateral can fall before liquidation: 1 − B ÷ (G × LLTV)', () => {
    const [loop] = buildLoops([market()]);
    const x = estimate(loop, input(pol(1.05, 3))).leverage!;
    expect(x.liquidationDrop).toBeCloseTo(1 - 2000 / (3000 * 0.86), 12);
  });

  it('marks a loop whose borrow costs more than its yield as unprofitable', () => {
    const [loop] = buildLoops([market({ borrow: side({ ratePct: 14 }) })]);
    const e = estimate(loop, input());
    expect(e.leverage!.carryPct).toBeLessThan(0);
    expect(e.placement).toBe('unprofitable');
  });

  it('borrows at the rate after its own borrow, and within available liquidity', () => {
    const curve = { suppliedUsd: 10_000, borrowedUsd: 5_000, points: kinkedBorrowCurve({ base: 0, slope1: 0.05, slope2: 0.6, optimal: 0.9 }), source: 't' };
    expect(rateAfterBorrow(curve, 2_000, 5)!).toBeGreaterThan(5);
    expect(rateAfterBorrow(curve, 6_000, 5)).toBeNull();
    const [loop] = buildLoops([market({ borrow: side({ availableUsd: 500 }) })]);
    const e = estimate(loop, input(pol(1.05, 3)));
    expect(e.leverage!.debt).toBeCloseTo(500, 9);
    expect(e.unallocated).toBeGreaterThan(0);
  });
});

describe('cost of capital (report test 11)', () => {
  const book = (maturityDays: number): Opportunity =>
    market({
      key: 'midnight',
      family: 'fixed-lend',
      protocol: { id: 'morpho', version: 'midnight', name: 'Morpho Midnight' },
      maturity: new Date(NOW + maturityDays * 86_400_000).toISOString(),
      book: {
        asks: [],
        bids: [{ price: 0.98, units: 1e6 }],
        unitUsd: 1,
        loanSymbol: 'USDC',
        settlementFee: { breakpointsSec: [0, 86_400], values: [0, 0], basis: 'market' },
        continuousFeePerYear: { value: 0, basis: 'market' },
        gated: false,
      } satisfies OrderBook,
      borrow: side({ ratePct: null, collateral: [{ token: { symbol: 'WBTC', address: '0xw' }, maxLtv: 0.86 }] }),
    });

  it('prices a fixed loan from the bids: owe one per unit sold', () => {
    const r = borrowQuotes([book(60)], 1000, 30, 'usd', NOW).rows[0];
    expect(r.kind).toBe('fixed');
    expect(r.costUsd!).toBeCloseTo(1000 / 0.98 - 1000, 9);
  });

  it('never stretches a short fixed term over a longer period', () => {
    const r = borrowQuotes([book(7)], 1000, 30, 'usd', NOW).rows[0];
    expect(r.days).toBeCloseTo(7, 9);
    expect(r.notes.some((n) => n.includes('افق کوتاه‌تر'))).toBe(true);
  });

  it('ranks variable loans by cost after the borrow and blocks what cannot be served', () => {
    const cheap = market({ key: 'cheap', borrow: side({ ratePct: 3 }) });
    const dear = market({ key: 'dear', borrow: side({ ratePct: 7 }) });
    const thin = market({ key: 'thin', borrow: side({ ratePct: 1, availableUsd: 10 }) });
    const q = borrowQuotes([dear, thin, cheap], 1000, 30, 'usd', NOW);
    expect(q.rows.map((r) => r.o.key)).toEqual(['cheap', 'dear']);
    expect(q.blocked.map((r) => r.o.key)).toEqual(['thin']);
    expect(q.rows[0].costUsd!).toBeCloseTo(1000 * (Math.pow(1.03, 30 / 365) - 1), 9);
  });
});

describe('adapters feed loops', () => {
  it('Morpho: borrow side with its curve, and the collateral’s own yield', () => {
    const m: RawMorphoMarket = {
      uniqueKey: '0xAB',
      lltv: '915000000000000000',
      loanAsset: { address: '0xUSDC', symbol: 'USDC', chain: { id: 1 }, yield: null },
      collateralAsset: { address: '0xSUSDE', symbol: 'sUSDe', chain: { id: 1 }, yield: { apr: 0.07 } },
      warnings: [],
      currentIrmCurve: [
        { utilization: 0, supplyApy: 0, borrowApy: 0.01 },
        { utilization: 1, supplyApy: 0.08, borrowApy: 0.1 },
      ],
      state: { supplyApy: 0.04, borrowApy: 0.05, supplyAssetsUsd: 1e7, borrowAssetsUsd: 8e6, liquidityAssetsUsd: 2e6, fee: 0, timestamp: String(NOW / 1000), rewards: [] },
    };
    const o = morphoMarket(m, AT)!;
    expect(o.borrow).toMatchObject({ ratePct: 5, availableUsd: 2e6, metric: 'ltv' });
    expect(o.borrow!.collateral[0].maxLtv).toBeCloseTo(0.915, 12);
    expect(o.borrow!.collateral[0].yield).toMatchObject({ kind: 'apr' });
    expect(o.borrow!.collateral[0].yield!.pct).toBeCloseTo(7, 12);
    expect(buildLoops([o])).toHaveLength(1);
  });

  it('Aave V4: a borrowable reserve accepts the Spoke’s collateral reserves; the risk premium is flagged', () => {
    const amount = (v: number) => ({ amount: { value: String(v) }, exchange: { value: String(v) } });
    const reserve = (sym: string, addr: string, over: Partial<RawAaveReserve> = {}): RawAaveReserve => ({
      id: sym,
      chain: { chainId: 1, name: 'Ethereum' },
      spoke: { id: 's', name: 'Main', address: '0xSPOKE' },
      status: { active: true, frozen: false, paused: false },
      canSupply: true,
      canBorrow: true,
      canUseAsCollateral: true,
      summary: { supplied: amount(1e6), supplyApy: { value: '0.03' }, borrowApy: { value: '0.05' }, underlyingApy: { value: '0' }, borrowable: amount(5e5), rewards: [] },
      settings: { supplyCap: amount(1e9), collateralFactor: { value: '0.9' }, collateral: true },
      asset: {
        underlying: { address: addr, info: { symbol: sym } },
        hub: { id: 'h', name: 'Core', address: '0xHUB' },
        summary: { supplied: amount(1e7), borrowed: amount(5e6), availableLiquidity: amount(5e6) },
        settings: { liquidityFee: { value: '0.1' }, optimalUtilizationRate: { value: '0.9' }, baseBorrowRate: { value: '0' }, slopeBelowOptimal: { value: '0.05' }, slopeAboveOptimal: { value: '0.6' } },
      },
      ...over,
    });
    const list = normalizeAave(
      [
        reserve('USDC', '0xUSDC'),
        reserve('sUSDe', '0xSUSDE', { canBorrow: false, summary: { supplied: amount(1e6), supplyApy: { value: '0.01' }, underlyingApy: { value: '0.07' }, rewards: [] } }),
        reserve('GHO', '0xGHO', { canSupply: false }),
      ],
      AT,
    );
    const usdc = list.find((o) => o.assets.deposit[0].symbol === 'USDC')!;
    expect(usdc.borrow!.premiumUnknown).toBe(true);
    expect(usdc.borrow!.collateral.map((c) => c.token.symbol)).toEqual(['sUSDe', 'GHO']);
    expect(list.find((o) => o.assets.deposit[0].symbol === 'GHO')!.family).toBe('borrow');
    const loops = buildLoops(list);
    const loop = loops.find((l) => l.loop!.collateral.token.symbol === 'sUSDe' && l.loop!.debt.token.symbol === 'USDC')!;
    expect(loop.quality).toBe('partial');
    // Collateral earns its own yield and the supply rate on the Spoke.
    expect(loop.loop!.collateral.supplyPct).toBeCloseTo(1, 9);
  });

  it('puts loops in the same ranking under the policy, and keeps borrow-only reserves out', () => {
    const a = evaluate({ opportunities: [market()], merkl: null, gas: [] }, 1000, NOW);
    const v = selectHorizon(a, 30, 'leverage');
    expect(v.ranking.top).toHaveLength(1);
    expect(v.ranking.top[0].leverage!.policy).toBe(defaultLeverageInput.version);
    expect(selectHorizon(a, 30).ranking.top.map((e) => e.key)).toContain(v.ranking.top[0].key);
    const borrowOnly = evaluate({ opportunities: [market({ key: 'b', family: 'borrow' })], merkl: null, gas: [] }, 1000, NOW);
    expect(borrowOnly.byKey.has('b')).toBe(false);
  });
});

describe('render', () => {
  it('shows the loop in Persian: own money, debt, health and liquidation distance', async () => {
    const { renderToString } = await import('react-dom/server');
    const { OpportunityDetails } = await import('../../src/components/market/OpportunityDetails');
    const { BorrowBoard } = await import('../../src/components/tools/BorrowBoard');
    const { assertPersianMoney } = await import('../helpers/text');
    const a = evaluate({ opportunities: [market()], merkl: null, gas: [] }, 1000, NOW);
    const row = a.rows.find((r) => r.o.family === 'leverage')!;
    const q = borrowQuotes([market()], 1000, 30, 'usd', NOW);
    const html = renderToString(<OpportunityDetails row={row} days={30} modelVersion="t" />) + renderToString(<BorrowBoard rows={q.rows} blocked={q.blocked} amount={1000} days={30} />);
    for (const t of ['آورده در لوپ', 'وثیقه / بدهی', 'هزینه‌ی بدهی', 'افت تا لیکوییدشدن', 'هزینه‌ی بهره‌ی وام']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, ''));
  });
});
