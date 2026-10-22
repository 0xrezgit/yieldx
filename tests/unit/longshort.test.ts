import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import boxes from '../fixtures/pendle-longshort.json';
import { longShortRow, parseRisk, perpCoinOf } from '../../src/lib/longshort/feed';
import { analyzeLongShort, healthOf, holdingPctOf, liqRatioOf, marketClock, maxLeverageOf, perpLiqMoveOf } from '../../src/lib/longshort/model';
import { reviewLongShort } from '../../src/lib/longshort/review';
import type { LongShortRow } from '../../src/lib/longshort/types';

type Box = Parameters<typeof longShortRow>[0];
const [shortWeth, longBase, longAapl] = (boxes as unknown as Box[]).map((b) => longShortRow(b)!);
const input = { capital: 1000, leverage: 2, days: 30, swapPct: 0.1, perpFeePct: 0.045 };

describe("PendleLoop's own numbers", () => {
  // From PendleLoop's screens: the figures it shows before a position is opened.
  it('long WETH 4× at LLTV 86%: liquidation at $2,144.62 from $2,459.16, «Health Factor 12.79%»', () => {
    expect(2459.16 * liqRatioOf('long', 4, 0.86)).toBeCloseTo(2144.62, 0);
    expect(1 - 1 / healthOf('long', 4, 0.86)).toBeCloseTo(0.1279, 4);
  });

  it('short WETH 2.6× at LLTV 78%: liquidation at $2,596.88 from $2,404.52, «Health Factor 7.41%»', () => {
    expect(2404.52 * liqRatioOf('short', 2.6, 0.78)).toBeCloseTo(2596.88, 0);
    expect(1 - 1 / healthOf('short', 2.6, 0.78)).toBeCloseTo(0.0741, 4);
  });

  it('AAPLc long 3× at LLTV 78%: liquidation at $291.01 from $340.48', () => {
    expect(340.48 * liqRatioOf('long', 3, 0.78)).toBeCloseTo(291.01, 0);
  });

  it('holding cost at 1.1×: short WETH earns 6.0% (USDC 3.9%, borrow 1.9%), long WETH earns 1.0% (1.3%, 4.6%)', () => {
    expect(holdingPctOf('short', 1.1, 3.9, 1.9)).toBeCloseTo(6.1, 1);
    expect(holdingPctOf('long', 1.1, 1.3, 4.6)).toBeCloseTo(0.97, 2);
  });
});

describe('Long/Short markets from the PendleLoop list', () => {
  it('reads the side, the base asset and the leverage as PendleLoop shows it (a short one lower)', () => {
    expect(shortWeth).toMatchObject({ side: 'short', category: 'crypto', base: { symbol: 'WETH' }, collateral: { symbol: 'USDC' }, debt: { symbol: 'WETH' } });
    expect(maxLeverageOf(shortWeth)).toBe(2.6);
    expect(maxLeverageOf(longBase)).toBe(6);
    expect(longAapl.category).toBe('stocks');
    expect(longAapl.marketHours.length).toBeGreaterThan(0);
  });

  it('adds the supply rate to what a short\'s dollar collateral earns', () => {
    expect(shortWeth.collateralYieldPct).toBeGreaterThan(3);
  });

  it('parses the oracle write-up into its rated parts', () => {
    const r = parseRisk((boxes[0] as unknown as Box).risks)!;
    expect(r.summary).toContain('Chainlink ETH/USD');
    expect(r.items.map((i) => i.name)).toEqual(['Asset Price', 'Stablecoin Price', 'Price Updates', 'Upgradability']);
    expect(r.items.find((i) => i.name === 'Upgradability')).toMatchObject({ level: 'medium', label: 'Medium Risk' });
  });

  it('skips Earn boxes (no side)', () => {
    expect(longShortRow({ ...(boxes[0] as unknown as Box), side: null })).toBeNull();
  });

  it('maps each base to its Hyperliquid perp', () => {
    expect(perpCoinOf('WETH', 'crypto')).toBe('ETH');
    expect(perpCoinOf('wstETH', 'crypto')).toBe('ETH');
    expect(perpCoinOf('WBTC', 'crypto')).toBe('BTC');
    expect(perpCoinOf('TSLAc', 'stocks')).toBe('xyz:TSLA');
  });
});

describe('the calculator', () => {
  it('caps leverage at PendleLoop\'s own limit', () => {
    const a = analyzeLongShort(shortWeth, { ...input, leverage: 5 });
    expect(a.leverage).toBe(2.6);
    expect(a.capped).toBe(true);
  });

  it('at an unchanged price over no time, loses only the swaps', () => {
    const a = analyzeLongShort(longBase, { ...input, days: 0 });
    const flat = a.outcomes.find((o) => o.move === 0)!;
    expect(flat.pnl).toBeCloseTo(-a.tradeCostUsd, 9);
    expect(a.holdingUsd).toBeCloseTo(0, 9);
  });

  it('a long gains on a rise, a short on a fall, and each is liquidated past its price', () => {
    const long = analyzeLongShort(longBase, { ...input, leverage: 5, days: 0 });
    expect(long.outcomes.find((o) => o.move === 0.1)!.pnl).toBeGreaterThan(0);
    expect(long.outcomes.find((o) => o.move === -0.2)!.liquidated).toBe(true);
    const short = analyzeLongShort(shortWeth, { ...input, leverage: 2.6, days: 0 });
    expect(short.outcomes.find((o) => o.move === -0.05)!.pnl).toBeGreaterThan(0);
    expect(short.outcomes.find((o) => o.move === 0.1)!.liquidated).toBe(true);
  });

  it('a perp at the same leverage is liquidated further away than the lending loop', () => {
    // Long 3×, LLTV 83% vs a 25× perp: −19.7% against about −32%.
    expect(liqRatioOf('long', 3, 0.83) - 1).toBeCloseTo(-0.197, 3);
    expect(perpLiqMoveOf('long', 3, 25)!).toBeCloseTo(-0.3197, 4);
    expect(perpLiqMoveOf('long', 30, 25)).toBeNull();
  });

  it('compares the period\'s cost with the perp at its 7-day funding', () => {
    const row: LongShortRow = { ...longBase, perp: { venue: 'Hyperliquid', coin: 'ETH', fundingNowPct: 11, funding7dPct: 8, maxLeverage: 25, markPx: 2400, url: 'https://app.hyperliquid.xyz/trade/ETH' } };
    const a = analyzeLongShort(row, input);
    expect(a.perp!.fundingPct).toBe(8);
    expect(a.perp!.holdingPct).toBeCloseTo(-16, 9);
    expect(a.outcomes.find((o) => o.move === 0.1)!.perpPnl).toBeGreaterThan(0);
  });
});

describe('the check beside each market', () => {
  it('warns on stock market hours and on liquidity short of the loan', () => {
    const a = analyzeLongShort(longAapl, input);
    const r = reviewLongShort(longAapl, a, input);
    expect(r.some((x) => x.tone === 'warn' && x.text.includes('بازار سهام'))).toBe(true);
    const thin = { ...longAapl, liquidityUsd: 100 };
    expect(reviewLongShort(thin, analyzeLongShort(thin, input), input)[0]).toMatchObject({ tone: 'bad' });
  });

  it('knows when the stock market is open', () => {
    expect(marketClock([{ open: 100, close: 200 }, { open: 300, close: 400 }], 150)).toEqual({ open: true, next: 200 });
    expect(marketClock([{ open: 100, close: 200 }, { open: 300, close: 400 }], 250)).toEqual({ open: false, next: 300 });
    expect(marketClock([], 250)).toBeNull();
  });
});
