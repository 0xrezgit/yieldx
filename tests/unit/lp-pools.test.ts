import { describe, expect, it } from 'vitest';
import { isStockToken, referencePrices, vetPool, vetPools, type RawItem } from '../../src/lib/lp/pools';
import { toPrefill } from '../../src/components/tools/LpPools';
import { estimatePool, rankPools, typicalMove } from '../../src/lib/lp/estimate';
import { lpLink, readLpPrefill } from '../../src/components/opportunities/LpAnalyzer';

// Controlled test data shaped like vfat's response; not market data.

const NOW = Date.parse('2026-10-05T00:00:00Z');
const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec';
const USDG = { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', price: 0.9998 };
const WETH = { address: '0x0bd7d3000000000000000000000000000000beef', symbol: 'WETH', price: 2700 };
const REF = { eth: 2700, btc: 100_000 };

function pool(over: { id?: string; chainId?: number; tokens?: { address: string; symbol: string; price: number | null }[]; tvl?: number; fees7d?: number | null; created?: string; killed?: boolean; rewards?: { type: string; amountUsd: number }[] } = {}): RawItem {
  return {
    id: over.id ?? 'p1',
    chainId: over.chainId ?? 4663,
    isWhitelisted: true,
    pool: {
      type: 'concentrated',
      underlying: over.tokens ?? [USDG, { address: NVDA, symbol: 'NVDA', price: 235 }],
      createdAt: over.created ?? '2026-08-01T00:00:00Z',
      currentFee: 3000,
      volumeUsd7d: 5_000_000,
      assetCorrelation: { relativePriceMovePercentiles: [{ horizonHours: 168, p95DownMovePercent: 5.5, p95UpMovePercent: 8 }] },
    },
    options: [{ kind: 'lp', isKilled: over.killed ?? false, totalLiquidity: over.tvl ?? 1_000_000, feesUsd7d: over.fees7d === undefined ? 7_000 : over.fees7d, weeklyRewards: over.rewards ?? [{ type: 'swap-fee', amountUsd: 7_000 }], protocol: { name: 'Uniswap' } }],
  };
}

describe('vfat LP pools: what is kept', () => {
  it('a verified stock against a dollar: fee rate from last week’s realised fees over the whole pool', () => {
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    expect(r.feeAprPct).toBeCloseTo((7_000 / 1_000_000) * (365 / 7) * 100, 9);
    expect(r.tokens.map((t) => t.cls)).toEqual(['usd', 'stock']);
    expect(r.feeTierPct).toBeCloseTo(0.3, 12);
    expect(r.move7d).toEqual({ down: 5.5, up: 8 });
    expect(r.stable).toBe(false);
    expect(r.incentives).toBe(false);
  });

  it('a stock is known by address only — the same symbol elsewhere is not one', () => {
    expect(isStockToken(4663, NVDA.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(isStockToken(4663, '0x3f5e950000000000000000000000000000000000')).toBe(false);
    expect(vetPool(pool({ tokens: [USDG, { address: '0x3f5e950000000000000000000000000000000000', symbol: 'NVDA', price: 235 }] }), REF, NOW)).toBe('asset');
    expect(isStockToken(1, NVDA)).toBe(false);
  });

  it('incentives beyond swap fees are flagged, never added to the fee rate', () => {
    const r = vetPool(pool({ rewards: [{ type: 'swap-fee', amountUsd: 7_000 }, { type: 'incentive', amountUsd: 50_000 }] }), REF, NOW);
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
  ])('%s', (_, item, reason) => {
    expect(vetPool(item, REF, NOW)).toBe(reason);
  });

  it('counts every dropped pool, keeps one row per id, highest fee rate first', () => {
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

describe('vfat LP pools: into the analyzer', () => {
  it('the steadier side is the price unit, the source is named, and the link round-trips', () => {
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    const p = toPrefill(r);
    expect([p.a, p.b]).toEqual(['NVDA', 'USDG']);
    expect(p.source).toBe('vfat');
    expect(readLpPrefill(new URL(`https://x${lpLink(p)}`).searchParams)).toMatchObject({ a: 'NVDA', b: 'USDG', feeApr: p.feeApr, source: 'vfat' });
  });
});

describe('vfat LP pools: logos and the dollar estimate', () => {
  it('every kept token has a logo: stocks by ticker, majors from the token list', () => {
    const r = vetPool(pool({ tokens: [WETH, { address: NVDA, symbol: 'NVDA', price: 235 }] }), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    expect(r.tokens.every((t) => typeof t.logo === 'string' && t.logo.startsWith('https://'))).toBe(true);
    expect(r.tokens[1].logo).toContain('NVDA');
  });

  it('a pool without a measured price swing has no loss estimate, so it is dropped', () => {
    const item = pool();
    item.pool!.assetCorrelation = null;
    expect(vetPool(item, REF, NOW)).toBe('volatility');
  });

  it('usual swing grows with √(days ÷ 7)', () => {
    const m = typicalMove({ move7d: { down: 5, up: 8 } }, 28);
    expect(m.down).toBeCloseTo(0.1, 12);
    expect(m.up).toBeCloseTo(0.16, 12);
  });

  it('estimate: fees minus the worse swing against holding; a calm pool beats a wild one with the same fees', () => {
    const calm = { id: 'calm', feeAprPct: 40, move7d: { down: 2, up: 2 } };
    const wild = { id: 'wild', feeAprPct: 40, move7d: { down: 30, up: 40 } };
    const e = estimatePool(calm, 1000, 30)!;
    expect(e.feesUsd).toBeGreaterThan(0);
    expect(e.lossUsd).toBeLessThanOrEqual(0);
    expect(e.netUsd).toBeCloseTo(e.feesUsd + e.lossUsd, 9);
    expect(rankPools([wild, calm], 1000, 30).map((r) => r.pool.id)).toEqual(['calm', 'wild']);
    expect(estimatePool(calm, 0, 30)).toBeNull();
  });

  it('the analyzer gets the pool’s logos, network, venue, swing, and the list’s amount and period', () => {
    const r = vetPool(pool(), REF, NOW);
    if (typeof r === 'string') throw new Error(r);
    const p = toPrefill(r, 2500, 90);
    expect(p).toMatchObject({ a: 'NVDA', b: 'USDG', chain: 'Robinhood Chain', protocol: 'Uniswap', move7d: { down: 5.5, up: 8 }, capital: 2500, days: 90 });
    expect(p.logoA).toContain('NVDA');
  });
});
