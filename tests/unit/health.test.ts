import { describe, expect, it } from 'vitest';
import { assessBase, assessImplied, type BaseHistoryPoint } from '../../src/lib/opportunity/health';

const days = (values: number[], implied?: number[]): BaseHistoryPoint[] =>
  values.map((v, i) => ({ t: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(), basePct: v, ...(implied ? { impliedPct: implied[i] } : {}) }));

describe('base yield health', () => {
  it('superWETH: 27% against a 2–13% range after a one-day jump from ~1% is broken', () => {
    const h = assessBase({ basePct: 27.3, interestPct: 23.86, rewardPct: 3.44, range: { min: 2, max: 13 }, history: days([...Array(25).fill(1.31), 25.17, 25.17, 27.3]), categories: ['eth'] });
    expect(h.status).toBe('broken');
    expect(h.reasons.join()).toContain('بازه');
    expect(h.reasons.join()).toContain('ناگهان');
  });

  it('a jump inside the range is suspect, ranked on the lower of today and the 30-day median', () => {
    const h = assessBase({ basePct: 11, range: { min: 2, max: 13 }, history: days([...Array(20).fill(4), 11]), categories: [] });
    expect(h.status).toBe('suspect');
    expect(h.conservativePct).toBe(4);
  });

  it('a reward-only figure unchanged for weeks is a configured rate, not a measured one', () => {
    const h = assessBase({ basePct: 3.5, interestPct: 0, rewardPct: 3.5, range: null, history: days(Array(30).fill(3.5)), categories: [] });
    expect(h.status).toBe('suspect');
    expect(h.reasons.join()).toContain('بدون تغییر');
  });

  it('0% on a points market is points-only (normal); 0% without points is missing data', () => {
    expect(assessBase({ basePct: 0, categories: ['stables', 'points'] })).toMatchObject({ status: 'ok', pointsOnly: true });
    expect(assessBase({ basePct: 0, categories: ['rwa'] }).status).toBe('suspect');
  });

  it('a normal, steady market inside its range is ok', () => {
    expect(assessBase({ basePct: 5, interestPct: 5, range: { min: 3, max: 8 }, history: days([4.8, 5.1, 4.9, 5]), categories: [] })).toMatchObject({ status: 'ok', reasons: [], conservativePct: 5 });
  });
});

describe('base yield against what the chain delivered (30 days)', () => {
  it('superWETH: 27% published, 4.5% realized — broken, whatever the other checks say', () => {
    const h = assessBase({ basePct: 27.16, range: { min: 2, max: 30 }, categories: [], realized: { d7: 19, d30: 4.49 } });
    expect(h.status).toBe('broken');
    expect(h.realizedPct).toBe(4.49);
    expect(h.reasons[0]).toContain('روی زنجیره');
  });

  it('sBOLD: 8.7% published, 5.0% realized — suspect, ranked on the realized yield', () => {
    expect(assessBase({ basePct: 8.66, categories: [], realized: { d7: 5, d30: 4.97 } })).toMatchObject({ status: 'suspect', conservativePct: 4.97 });
  });

  it('sUSDat: 44% published outside its range after a jump, but 49.6% realized — the chain confirms it', () => {
    const h = assessBase({ basePct: 44.11, range: { min: 8, max: 25 }, history: days([...Array(20).fill(2), 44, 44]), categories: [], realized: { d7: 40, d30: 49.62 } });
    expect(h).toMatchObject({ status: 'ok', reasons: [], conservativePct: 44.11 });
  });

  it('no measurement: the heuristics decide as before', () => {
    expect(assessBase({ basePct: 27.3, range: { min: 2, max: 13 }, categories: [], realized: { d7: null, d30: null } }).status).toBe('broken');
  });
});

describe('implied APY health', () => {
  it('jrRoyAPYUSD: published 19.32% while the PT price gives about 16.1% is suspect', () => {
    // 35 days left, PT price that implies ~16.08%.
    const pt = Math.pow(1.1608, -35 / 365);
    const h = assessImplied({ impliedPct: 19.32, ptPrice: pt, days: 35 });
    expect(h.status).toBe('suspect');
    expect(h.reasons.join()).toContain('قیمت PT');
    expect(assessImplied({ impliedPct: 16.08, ptPrice: pt, days: 35 }).status).toBe('ok');
  });

  it('an impossible rate (an empty pool at 10,000%) is broken', () => {
    expect(assessImplied({ impliedPct: 10_000, ptPrice: null, days: 14 }).status).toBe('broken');
  });

  it('weeks without a change (no trades) or a sudden recent jump are suspect', () => {
    expect(assessImplied({ impliedPct: 6, ptPrice: null, days: 90, history: days(Array(20).fill(1), Array(20).fill(6)) }).reasons.join()).toContain('تغییر نکرده');
    expect(assessImplied({ impliedPct: 12, ptPrice: null, days: 90, history: days([1, 1, 1, 1], [5, 5, 5.2, 12]) }).status).toBe('suspect');
  });
});
