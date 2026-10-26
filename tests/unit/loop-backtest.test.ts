import { describe, expect, it } from 'vitest';
import { backtestLoop, cleanPoints, historyLevels, summarize, type LoopPoint } from '../../src/lib/pendleloop/backtest';

// Controlled test data; not market data.

const H = 3600;
/** n hourly points; price and borrow APY from functions of the hour. */
const series = (n: number, price: (i: number) => number, borrow: (i: number) => number = () => 8, oracle = price): LoopPoint[] =>
  Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * H, borrowPct: borrow(i), oracle: oracle(i), market: price(i), fixedPct: 12, liquidityUsd: 1e6 }));

/** The same replay done the long way: every entry walked hour by hour. */
function naive(p: LoopPoint[], L: number, lltv: number, minHold: number) {
  let entries = 0;
  let liq = 0;
  let minH = Infinity;
  for (let i = 0; i < p.length; i++) {
    if (p[p.length - 1].t - p[i].t < minHold * H) break;
    const N = L / p[i].market;
    if (1 - (L - 1) / (N * p[i].oracle * lltv) < 0.03) continue;
    entries++;
    let D = L - 1;
    let lowest = Infinity;
    for (let j = i; j < p.length; j++) {
      if (j > i) D *= Math.pow(1 + p[j - 1].borrowPct / 100, (p[j].t - p[j - 1].t) / (365 * 86400));
      lowest = Math.min(lowest, (N * p[j].oracle * lltv) / D);
    }
    if (lowest < 1) liq++;
    minH = Math.min(minH, lowest);
  }
  return { entries, liq, minH };
}

describe('loop backtest', () => {
  it('matches an hour-by-hour replay of every entry', () => {
    // A PT drifting up to par with a dip of the oracle in the middle and a borrow spike.
    const p = series(
      24 * 40,
      (i) => 0.96 + 0.03 * (i / (24 * 40)) - (i > 400 && i < 430 ? 0.03 : 0),
      (i) => (i > 600 && i < 700 ? 60 : 8),
    );
    for (const L of [2, 4, 6, 8.8]) {
      const r = backtestLoop(p, L, 0.915)!;
      const ref = naive(p, L, 0.915, 24 * 7);
      expect(r.entries).toBe(ref.entries);
      expect(r.liquidated).toBe(ref.liq);
      expect(r.minHealth).toBeCloseTo(ref.minH, 9);
    }
  });

  it('a calm market liquidates nothing at 4×; the edge does when the oracle dips', () => {
    const calm = series(24 * 30, (i) => 0.97 + 0.0001 * i * 0.01);
    const r4 = backtestLoop(calm, 4, 0.915)!;
    expect(r4.liquidated).toBe(0);
    expect(r4.minBufferPct).toBeGreaterThan(10);
    const dip = series(24 * 30, (i) => (i === 24 * 20 ? 0.9 : 0.97));
    const edge = backtestLoop(dip, 8, 0.915)!;
    expect(edge.liquidated).toBeGreaterThan(0);
    expect(edge.firstLiquidatedEntryAt).not.toBeNull();
    expect(edge.worstAt).toBe(1_700_000_000 + 24 * 20 * H);
    // The same dip leaves 3× standing.
    expect(backtestLoop(dip, 3, 0.915)!.liquidated).toBe(0);
  });

  it('borrow interest alone liquidates a loop that sits too close to its limit', () => {
    const flat = series(24 * 60, () => 0.97, () => 200);
    expect(backtestLoop(flat, 8, 0.915)!.liquidated).toBeGreaterThan(0);
    expect(backtestLoop(series(24 * 60, () => 0.97, () => 5), 8, 0.915)!.liquidated).toBe(0);
  });

  it('an oracle under the market price: a leverage that is past the limit from the first hour is «cannot open», not a liquidation', () => {
    // Oracle 6% under the market (a fixed-curve oracle): 8× on LLTV 91.5% starts at health 0.98.
    const p = series(24 * 30, () => 0.97, () => 8, () => 0.97 * 0.94);
    const r8 = backtestLoop(p, 8, 0.915)!;
    expect(r8).toMatchObject({ entries: 0, liquidated: 0, unopenable: r8.candidates });
    expect(r8.minHealth).toBeNaN();
    const r4 = backtestLoop(p, 4, 0.915)!;
    expect(r4).toMatchObject({ unopenable: 0, liquidated: 0 });
    expect(r4.entries).toBe(r4.candidates);
  });

  it('drops broken points and says when the history is too short', () => {
    const p = series(24 * 20, () => 0.97);
    p[5] = { ...p[5], borrowPct: 18_298 };
    p[6] = { ...p[6], oracle: 0 };
    expect(cleanPoints(p)).toHaveLength(p.length - 2);
    expect(summarize(p).enough).toBe(true);
    expect(summarize(series(24 * 5, () => 0.97)).enough).toBe(false);
    expect(backtestLoop(series(24 * 5, () => 0.97), 4, 0.915)).toBeNull();
    expect(backtestLoop(p, 1, 0.915)).toBeNull();
  });

  it('table levels: 2× to 6× under the edge, the edge, and the chosen one', () => {
    expect(historyLevels(8.8, 6.9)).toEqual([2, 3, 4, 5, 6, 6.9, 8.8]);
    expect(historyLevels(3.4)).toEqual([2, 3, 3.4]);
  });
});
