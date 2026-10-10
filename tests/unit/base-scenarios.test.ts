import { describe, expect, it } from 'vitest';
import { baseScenarios, BASE_SCENARIO, levelsFrom, reversionWeight } from '../../src/lib/opportunity/base-scenarios';

describe('baseScenarios', () => {
  it('a short hold keeps most of today, a long one is mostly the level', () => {
    const levels = { d7: 12, d30: 10, d90: null };
    const short = baseScenarios(20, levels, 3);
    const long = baseScenarios(20, levels, 365);
    expect(short.likely).toBeGreaterThan(18);
    expect(long.likely).toBeLessThan(11);
    expect(long.likely).toBeGreaterThan(10);
  });

  it('low is the lowest of today, likely and every window', () => {
    const s = baseScenarios(11, { d7: 9, d30: 12, d90: 8 }, 90);
    expect(s.low).toBe(8);
  });

  it('a level above today never lifts the likely case — only the high one', () => {
    const s = baseScenarios(10.6, { d7: 7, d30: 28, d90: null }, 96);
    expect(s.likely).toBe(10.6);
    expect(s.high).toBeGreaterThan(20);
  });

  it('without history: likely is today, low a fixed share of it', () => {
    const s = baseScenarios(16, null, 60);
    expect(s).toMatchObject({ likely: 16, high: 16, level: null, measured: false });
    expect(s.low).toBeCloseTo(16 * BASE_SCENARIO.noHistoryLowShare, 9);
  });

  it('a cap keeps a published history under the measured base', () => {
    const s = baseScenarios(5, { d7: 25, d30: 25, d90: null }, 60, 5);
    expect(s.likely).toBe(5);
    expect(s.high).toBe(5);
  });

  it('weight is 1 at day 0 and falls with the hold', () => {
    expect(reversionWeight(0)).toBe(1);
    expect(reversionWeight(7)).toBeGreaterThan(reversionWeight(30));
  });
});

describe('levelsFrom', () => {
  const day = (i: number, basePct: number) => ({ t: new Date(2026, 8, i + 1).toISOString(), basePct });
  it('on-chain windows first; else medians of the history, which a spike does not move', () => {
    const h = Array.from({ length: 30 }, (_, i) => day(i, i === 20 ? 106 : i < 23 ? 10 : 17));
    expect(levelsFrom(h, { d7: 1, d30: 2, d90: 9, moved: true })).toEqual({ d7: 1, d30: 2, d90: 9 });
    const l = levelsFrom(h, null)!;
    expect(l.d7).toBe(17);
    expect(l.d30).toBe(10);
  });
  it('a chain rate that never moved is ignored; nothing known → null', () => {
    expect(levelsFrom(null, { d7: 5, d30: 5, d90: 5, moved: false })).toBeNull();
  });
});
