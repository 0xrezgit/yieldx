import { describe, expect, it } from 'vitest';
import { farmUrl, fullRangeAprFromHistory, isStockToken, orientMove, referencePrices, vetPool, vetPools, type RawHistory, type RawItem } from '../../src/lib/lp/pools';
import { toPrefill } from '../../src/components/tools/LpPools';
import { estimatePool, rankPools, suggestedShape, typicalMove, volatilityCostPct } from '../../src/lib/lp/estimate';
import { concentration, positionFeeApr } from '../../src/lib/lp/scenarios';
import { lpLink, readLpPrefill } from '../../src/components/opportunities/LpAnalyzer';

// Controlled test data shaped like vfat's responses; not market data (except the
// recorded Aerodrome history, marked as such).

const NOW = Date.parse('2026-10-05T00:00:00Z');
const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec';
const USDG = { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', price: 0.9998 };
const WETH = { address: '0x0bd7d3000000000000000000000000000000beef', symbol: 'WETH', price: 2700 };
const STOCK = { address: NVDA, symbol: 'NVDA', price: 235 };
const REF = { eth: 2700, btc: 100_000 };

type Tok = { address: string; symbol: string; price: number | null };
function pool(
  over: { id?: string; tokens?: Tok[]; base?: string; tvl?: number; fees7d?: number | null; created?: string; killed?: boolean; type?: string; rewards?: { type: string; amountUsd: number }[] } = {},
): RawItem {
  const tokens = over.tokens ?? [USDG, STOCK];
  return {
    id: over.id ?? 'p1',
    chainId: 4663,
    isWhitelisted: true,
    pool: {
      type: over.type ?? 'volatile',
      underlying: tokens,
      createdAt: over.created ?? '2026-08-01T00:00:00Z',
      currentFee: 3000,
      volumeUsd7d: 5_000_000,
      assetCorrelation: { baseTokenAddress: over.base ?? tokens[0].address, relativeRealizedVolatilityAnnualizedPercent: 40, relativePriceMovePercentiles: [{ horizonHours: 168, p95DownMovePercent: 5, p95UpMovePercent: 8 }] },
    },
    options: [{ id: `opt-${over.id ?? 'p1'}`, kind: 'lp', isKilled: over.killed ?? false, totalLiquidity: over.tvl ?? 1_000_000, feesUsd7d: over.fees7d === undefined ? 7_000 : over.fees7d, weeklyRewards: over.rewards ?? [{ type: 'swap-fee', amountUsd: 7_000 }], protocol: { name: 'Uniswap' } }],
  };
}

// Recorded 2026-09-05…10-04 from vfat /v4/pool-history: Aerodrome Slipstream WETH/USDC (CL100) on Base.
const AERO: RawHistory = {
  token0: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  token1: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
  points: [
    { volumeUsd: 13768890.99, feePercent: 0.0305, protocolFeesUsd: 0, averageLiquidity: '4147754879444844500', closePriceToken1PerToken0: 2480.57 },
    { volumeUsd: 24164942.95, feePercent: 0.0305, protocolFeesUsd: 0, averageLiquidity: '3230314289320283600', closePriceToken1PerToken0: 2514.32 },
    { volumeUsd: 26466005.94, feePercent: 0.0305, protocolFeesUsd: 0, averageLiquidity: '3330634424786913300', closePriceToken1PerToken0: 2490.69 },
    { volumeUsd: 32852718.00, feePercent: 0.0305, protocolFeesUsd: 0, averageLiquidity: '3351205592451574300', closePriceToken1PerToken0: 2484.78 },
    { volumeUsd: 40097016.20, feePercent: 0.0305, protocolFeesUsd: 0, averageLiquidity: '3309771264241555500', closePriceToken1PerToken0: 2467.16 },
    { volumeUsd: 21960173.06, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '3258111398965641000', closePriceToken1PerToken0: 2437.76 },
    { volumeUsd: 34172022.62, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '2643647715634301400', closePriceToken1PerToken0: 2514.93 },
    { volumeUsd: 7544071.82, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '3840205721565213700', closePriceToken1PerToken0: 2525.35 },
    { volumeUsd: 12774403.84, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '3511554125948252000', closePriceToken1PerToken0: 2476.42 },
    { volumeUsd: 28955568.86, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '2818897325719408000', closePriceToken1PerToken0: 2515.42 },
    { volumeUsd: 27217027.20, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '2520457036980198400', closePriceToken1PerToken0: 2397.96 },
    { volumeUsd: 29287984.88, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '2175852381454629000', closePriceToken1PerToken0: 2416.91 },
    { volumeUsd: 22798998.04, feePercent: 0.0594, protocolFeesUsd: 0, averageLiquidity: '2853330013468254700', closePriceToken1PerToken0: 2446.06 },
    { volumeUsd: 28427819.87, feePercent: 0.0549, protocolFeesUsd: 0, averageLiquidity: '2208155494795924200', closePriceToken1PerToken0: 2612.30 },
    { volumeUsd: 16289029.09, feePercent: 0.0564, protocolFeesUsd: 0, averageLiquidity: '3186122385720907300', closePriceToken1PerToken0: 2632.83 },
    { volumeUsd: 23501194.17, feePercent: 0.0579, protocolFeesUsd: 0, averageLiquidity: '2861428618899355000', closePriceToken1PerToken0: 2644.21 },
    { volumeUsd: 31574462.35, feePercent: 0.0698, protocolFeesUsd: 0, averageLiquidity: '1812487903882998500', closePriceToken1PerToken0: 2775.76 },
    { volumeUsd: 28797594.35, feePercent: 0.0654, protocolFeesUsd: 0, averageLiquidity: '2837647137532349400', closePriceToken1PerToken0: 2753.81 },
    { volumeUsd: 122212461.38, feePercent: 0.0609, protocolFeesUsd: 0, averageLiquidity: '4140567455413294000', closePriceToken1PerToken0: 2684.72 },
    { volumeUsd: 101256390.01, feePercent: 0.0549, protocolFeesUsd: 0, averageLiquidity: '3611015949801284600', closePriceToken1PerToken0: 2687.37 },
    { volumeUsd: 97624020.39, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '4147459168326163500', closePriceToken1PerToken0: 2691.14 },
    { volumeUsd: 38939286.42, feePercent: 0.0549, protocolFeesUsd: 0, averageLiquidity: '6279575084453733000', closePriceToken1PerToken0: 2696.28 },
    { volumeUsd: 58876344.44, feePercent: 0.0624, protocolFeesUsd: 0, averageLiquidity: '5489644818888834000', closePriceToken1PerToken0: 2687.71 },
    { volumeUsd: 119019908.84, feePercent: 0.0579, protocolFeesUsd: 0, averageLiquidity: '3732478090455487000', closePriceToken1PerToken0: 2687.97 },
    { volumeUsd: 109350959.26, feePercent: 0.0549, protocolFeesUsd: 0, averageLiquidity: '4003008066264680400', closePriceToken1PerToken0: 2676.75 },
    { volumeUsd: 84303181.12, feePercent: 0.0609, protocolFeesUsd: 0, averageLiquidity: '3551893020865727500', closePriceToken1PerToken0: 2684.53 },
    { volumeUsd: 80588278.57, feePercent: 0.0609, protocolFeesUsd: 0, averageLiquidity: '3381995612912622000', closePriceToken1PerToken0: 2705.82 },
    { volumeUsd: 77210029.06, feePercent: 0.0549, protocolFeesUsd: 0, averageLiquidity: '2816892267313072000', closePriceToken1PerToken0: 2668.42 },
    { volumeUsd: 18788803.27, feePercent: 0.0564, protocolFeesUsd: 0, averageLiquidity: '4054202527832747500', closePriceToken1PerToken0: 2687.22 },
    { volumeUsd: 29726108.36, feePercent: 0.0535, protocolFeesUsd: 0, averageLiquidity: '3908561770931094500', closePriceToken1PerToken0: 2726.69 },
  ],
};
const usdcPrice = (a: string) => (a.toLowerCase() === AERO.token1!.address ? 1 : null);

describe('fee rate of a concentrated pool: per unit of liquidity, not per pool dollar', () => {
  it('Aerodrome WETH/USDC (recorded): a full-range dollar earns ~2.6%/yr over the month, not the ~150% that fees ÷ TVL gave', () => {
    const r = fullRangeAprFromHistory(AERO, usdcPrice)!;
    expect(r.days).toBe(30);
    expect(r.aprPct).toBeGreaterThan(2);
    expect(r.aprPct).toBeLessThan(3.5);
    // The last week alone was busier: a trend hint, not the rate.
    expect(r.trendPct!).toBeGreaterThan(r.aprPct * 1.3);
    // fees ÷ TVL over the same week, as the old list computed it:
    const naive = (277_765 / 8_343_971) * (365 / 7) * 100;
    expect(naive / r.aprPct).toBeGreaterThan(25);
  });

  it('a ±10% range concentrates ~20× — while in range it earns ~20× the full-range rate', () => {
    expect(concentration({ kind: 'full' })).toBe(1);
    expect(concentration({ kind: 'range', low: 0.9, high: 1.1 })).toBeCloseTo(20.44, 1);
    expect(positionFeeApr({ feeAprPct: 4, feeBasis: 'full-range', shape: { kind: 'range', low: 0.9, high: 1.1 } })).toBeCloseTo(81.8, 0);
    // A typed or Merkl rate is the position's own: never scaled.
    expect(positionFeeApr({ feeAprPct: 4, shape: { kind: 'range', low: 0.9, high: 1.1 } })).toBe(4);
  });

  it('too little history (under two weeks), a missing price or a missing token price → no rate', () => {
    expect(fullRangeAprFromHistory({ ...AERO, points: AERO.points!.slice(0, 13) }, usdcPrice)).toBeNull();
    expect(fullRangeAprFromHistory({ ...AERO, points: AERO.points!.slice(0, 14) }, usdcPrice)?.days).toBe(14);
    expect(fullRangeAprFromHistory(AERO, () => null)).toBeNull();
  });

  it('a concentrated pool without its history is dropped, with it the rate comes from it', () => {
    const item = pool({ type: 'concentrated', tokens: [{ ...WETH, address: AERO.token0!.address! }, { address: AERO.token1!.address!, symbol: 'USDC', price: 1 }] });
    expect(vetPool(item, REF, NOW)).toBe('history');
    expect(vetPool(item, REF, NOW, null)).toBe('history');
    const r = vetPool(item, REF, NOW, { history: AERO });
    if (typeof r === 'string') throw new Error(r);
    expect(r.feeAprPct).toBeCloseTo(fullRangeAprFromHistory(AERO, usdcPrice)!.aprPct, 9);
    expect(r.concentrated).toBe(true);
    expect(r.unstakedFee).toBe(0);
  });

  it('Aerodrome: the pool’s share of an unstaked LP’s fees comes out; unknown share → not shown', () => {
    const tokens = [{ ...WETH, address: AERO.token0!.address! }, { address: AERO.token1!.address!, symbol: 'USDC', price: 1 }];
    const item = pool({ type: 'concentrated', tokens });
    item.options![0].protocol = { id: 'aerodrome', name: 'Aerodrome' };
    const full = fullRangeAprFromHistory(AERO, usdcPrice)!.aprPct;
    const r = vetPool(item, REF, NOW, { history: AERO, unstakedFee: 0.05 });
    if (typeof r === 'string') throw new Error(r);
    expect(r.feeAprPct).toBeCloseTo(full * 0.95, 9);
    expect(r.unstakedFee).toBe(0.05);
    expect(vetPool(item, REF, NOW, { history: AERO })).toBe('history');
    expect(vetPool(item, REF, NOW, { history: AERO, unstakedFee: null })).toBe('history');
  });
});

describe('vfat LP pools: what is kept', () => {
  it('a plain pool: fees ÷ TVL is the full-range rate; A is the moving side, B the unit', () => {
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    expect(r.feeAprPct).toBeCloseTo((7_000 / 1_000_000) * (365 / 7) * 100, 9);
    expect(r.tokens.map((t) => t.symbol)).toEqual(['NVDA', 'USDG']);
    expect(r.feeTierPct).toBeCloseTo(0.3, 12);
    expect(r.url).toBe(farmUrl('opt-p1'));
    expect(r.url).toMatch(/^https:\/\/vfat\.io\/farm\?farmId=/);
  });

  it('the swing is A’s: measured on USDG (base) it is inverted for NVDA', () => {
    // vfat measured USDG against NVDA: down 5%, up 8%. NVDA against USDG: down 8/108, up 5/95.
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    expect(r.move7d.down).toBeCloseTo((0.08 / 1.08) * 100, 9);
    expect(r.move7d.up).toBeCloseTo((0.05 / 0.95) * 100, 9);
    expect(orientMove({ down: 5, up: 8 }, true)).toEqual({ down: 5, up: 8 });
    const same = vetPool(pool({ base: NVDA }), REF, NOW);
    if (typeof same === 'string') throw new Error(same);
    expect(same.move7d).toEqual({ down: 5, up: 8 });
  });

  it('a stock is known by address only — the same symbol elsewhere is not one', () => {
    expect(isStockToken(4663, NVDA)).toBe(true);
    expect(vetPool(pool({ tokens: [USDG, { ...STOCK, address: '0x3f5e950000000000000000000000000000000000' }] }), REF, NOW)).toBe('asset');
    expect(isStockToken(1, NVDA)).toBe(false);
  });

  it('incentives beyond swap fees are flagged, never added to the fee rate', () => {
    const r = vetPool(pool({ rewards: [{ type: 'swap-fee', amountUsd: 7_000 }, { type: 'onchain', amountUsd: 50_000 }] }), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    expect(r.incentives).toBe(true);
    expect(r.feeAprPct).toBeCloseTo(36.5, 9);
  });
});

describe('vfat LP pools: what is dropped, and why', () => {
  it.each([
    ['memecoin side', pool({ tokens: [USDG, { address: '0x2e8c31162b855a2ffa90f6f8634643ad6f111e18', symbol: 'AI', price: 0.01 }] }), 'asset'],
    ['a “dollar” far from $1', pool({ tokens: [{ ...USDG, price: 0.4 }, WETH] }), 'price'],
    ['ETH far from the reference', pool({ tokens: [USDG, { ...WETH, price: 900 }] }), 'price'],
    ['a side without price', pool({ tokens: [{ ...USDG, price: null }, WETH] }), 'price'],
    ['thin pool', pool({ tvl: 100_000 }), 'tvl'],
    ['younger than a week', pool({ created: '2026-10-01T00:00:00Z' }), 'age'],
    ['no fees recorded', pool({ fees7d: 0 }), 'fees'],
    ['unknown fees', pool({ fees7d: null }), 'fees'],
    ['implausible rate', pool({ fees7d: 200_000 }), 'outlier'],
    ['killed farm', pool({ killed: true }), 'inactive'],
    ['swing measured on a token not in the pool', pool({ base: '0x0000000000000000000000000000000000000001' }), 'volatility'],
  ])('%s', (_, item, reason) => {
    expect(vetPool(item, REF, NOW)).toBe(reason);
  });

  it('a pool without a measured price swing or volatility has no loss estimate, so it is dropped', () => {
    const item = pool();
    item.pool!.assetCorrelation = null;
    // Not in the list: the pool's history decides — until it is in, it is waiting, not rejected.
    expect(vetPool(item, REF, NOW)).toBe('history');
    expect(vetPool(item, REF, NOW, null)).toBe('history');
    expect(vetPool(item, REF, NOW, { history: { points: [], currentRangeRisk: null } })).toBe('volatility');
    const noVol = pool();
    noVol.pool!.assetCorrelation!.relativeRealizedVolatilityAnnualizedPercent = null;
    expect(vetPool(noVol, REF, NOW)).toBe('volatility');
  });

  it('reads the price moves from the pool history when the list no longer carries them (vfat, 2026-10)', () => {
    const listed = pool();
    const risk = listed.pool!.assetCorrelation!;
    const item = pool();
    item.pool!.assetCorrelation = { baseTokenAddress: risk.baseTokenAddress };
    const r = vetPool(item, REF, NOW, { history: { points: [], currentRangeRisk: risk } });
    expect(typeof r).toBe('object');
    expect(r).toMatchObject({ volAnnualPct: 40 });
    expect(r).toEqual(vetPool(listed, REF, NOW));
  });

  it('counts every dropped pool, keeps one row per id', () => {
    const items = [pool({ id: 'a', fees7d: 1_000 }), pool({ id: 'b', fees7d: 9_000 }), pool({ id: 'a', fees7d: 1_000 }), pool({ id: 'c', tvl: 10 })];
    const { pools, rejected } = vetPools(items, NOW);
    expect(pools.map((p) => p.id)).toEqual(['b', 'a']);
    expect(rejected.tvl).toBe(1);
  });

  it('reference ETH price is the median across pools, so one odd quote cannot move it', () => {
    const items = [pool({ tokens: [USDG, WETH] }), pool({ tokens: [USDG, { ...WETH, price: 2710 }] }), pool({ tokens: [USDG, { ...WETH, symbol: 'ETH', price: 50 }] })];
    expect(referencePrices(items).eth).toBe(2700);
  });
});

describe('vfat LP pools: logos and the dollar estimate', () => {
  it('every kept token has a logo: stocks by ticker, majors from the token list', () => {
    const r = vetPool(pool({ tokens: [WETH, STOCK] }), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    expect(r.tokens.every((t) => typeof t.logo === 'string' && t.logo.startsWith('https://'))).toBe(true);
    expect(r.tokens[0].logo).toContain('NVDA');
  });

  it('usual swing grows with √(days ÷ 7)', () => {
    const m = typicalMove({ move7d: { down: 5, up: 8 } }, 28);
    expect(m.down).toBeCloseTo(0.1, 12);
    expect(m.up).toBeCloseTo(0.16, 12);
  });

  it('a concentrated pool is estimated on a range as wide as its usual swing; a plain one on the full range', () => {
    expect(suggestedShape({ concentrated: true, move7d: { down: 5, up: 8 } }, 28)).toEqual({ kind: 'range', low: 0.9, high: 1.16 });
    expect(suggestedShape({ concentrated: false, move7d: { down: 5, up: 8 } }, 28)).toEqual({ kind: 'full' });
  });

  it('Aerodrome WETH/USDC, $1000 for 30 days: tens of dollars at most, not $121', () => {
    const feeAprPct = fullRangeAprFromHistory(AERO, usdcPrice)!.aprPct;
    // vfat's measured swing for this pool, WETH against USDC: down 5.44%, up 15.63% per week.
    // vfat's measured swing (down 5.44%, up 15.63% a week) and volatility (38.92%/yr) for this pool.
    const pool = { feeAprPct, concentrated: true, move7d: { down: 5.44, up: 15.63 }, volAnnualPct: 38.92 };
    const e = estimatePool(pool, 1000, 30)!;
    expect(e.feesUsd).toBeGreaterThan(20);
    expect(e.feesUsd).toBeLessThan(60);
    expect(e.netUsd).toBeGreaterThan(5);
    expect(e.netUsd).toBeLessThan(40);
    const full = estimatePool({ ...pool, concentrated: false }, 1000, 30)!;
    expect(full.feesUsd).toBeLessThan(5);
  });

  it('expected result: concentration × (fee rate − σ²/8); a calm pool beats a wild one with the same fees', () => {
    expect(volatilityCostPct(40)).toBeCloseTo(2, 12);
    const calm = { id: 'calm', feeAprPct: 40, concentrated: false, move7d: { down: 2, up: 2 }, volAnnualPct: 10 };
    const wild = { id: 'wild', feeAprPct: 40, concentrated: false, move7d: { down: 30, up: 40 }, volAnnualPct: 150 };
    const e = estimatePool(calm, 1000, 365)!;
    expect(e.feesUsd).toBeCloseTo(400, 9);
    expect(e.lossUsd).toBeCloseTo(-1.25, 9);
    expect(e.netUsd).toBeCloseTo(e.feesUsd + e.lossUsd, 9);
    const r = estimatePool({ ...calm, concentrated: true }, 1000, 365)!;
    expect(r.netUsd / e.netUsd).toBeCloseTo(concentration(r.shape), 9);
    expect(rankPools([wild, calm], 1000, 30).map((r) => r.pool.id)).toEqual(['calm', 'wild']);
    expect(estimatePool(calm, 0, 30)).toBeNull();
  });
});

describe('vfat LP pools: into the analyzer', () => {
  it('carries logos, network, venue, swing, range type, link, and the list’s amount and period', () => {
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    const p = toPrefill(r, 2500, 90);
    expect(p).toMatchObject({ a: 'NVDA', b: 'USDG', chain: 'Robinhood Chain', protocol: 'Uniswap', capital: 2500, days: 90, source: 'vfat', concentrated: false, url: r.url });
    expect(p.logoA).toContain('NVDA');
  });

  it('a link round-trips, and only a vfat farm page is accepted as the entry link', () => {
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    const p = toPrefill(r);
    expect(readLpPrefill(new URL(`https://x${lpLink(p)}`).searchParams)).toMatchObject({ a: 'NVDA', b: 'USDG', feeApr: p.feeApr, source: 'vfat', url: r.url });
    const evil = new URLSearchParams({ tab: 'lp', go: 'https://evil.example/farm?farmId=1' });
    expect(readLpPrefill(evil).url).toBeUndefined();
  });
});
