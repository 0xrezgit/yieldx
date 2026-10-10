import { describe, expect, it } from 'vitest';
import { robustFromPoints, robustRate } from '../../src/lib/opportunity/robust-rate';

/**
 * Daily on-chain yields (% a year) of real vaults, 35 days to 2026-10-10, from
 * convertToAssets at 00:00 UTC each day.
 */
const REAL = {
  ctDefiUSDT: [9.2, 5.6, 9.7, 8.0, 7.6, 6.9, 4.5, 9.4, 5.4, 8.8, 8.5, 3.3, 14.0, 5.0, 4.8, 7.2, 10.9, 4.0, 6.7, 9.4, 10.3, 3.5, 7.8, 11.1, 4.9, 11.6, 3.2, -13.5, 34.0, 4.2, 7.0, 1.7, 0, 515.4, 5085.6],
  upshift: [0, 0, 0, 0, 0, 3594571.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3779.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -97.7],
  saturn: [33.8, 14.0, 14.1, 192.3, -12.5, 29.2, 729.9, 22.8, 15.0, 454.7, -99.9, -4.9, 3294.1, 546.6, 13.2, 13.2, 224.9, 124.3, -27.1, -84.1, 83.0, 15.5, 45.7, 910.5, 276.2, -52.9, 108.8, -28.0, 0.0, 0, 18.2, 4.1, -3.3, 16.4, 158.7],
  apyUSD: [12.8, 12.8, 12.8, 12.8, 12.8, 11.5, 13.2, 13.3, 13.3, 13.3, 13.2, 13.4, 13.5, 13.5, 13.6, 13.6, 13.6, 13.9, 14.0, 14.1, 14.1, 14.1, 14.1, 14.1, 14.2, 14.2, 14.2, 14.2, 14.2, 14.2, 14.2, 14.2, 14.3, 14.5, 14.5],
  sUSDe: [4.5, 4.5, 4.6, 4.7, 4.7, 4.8, 5.0, 5.0, 5.1, 5.1, 5.0, 5.0, 5.0, 4.7, 4.7, 4.7, 4.7, 4.6, 4.7, 4.7, 5.0, 5.1, 5.1, 5.1, 5.1, 5.2, 5.3, 5.0, 4.9, 4.9, 5.0, 5.0, 5.0, 5.0, 4.9],
  harvest: [20.3, 20.4, 20.3, 20.3, 20.1, 128.6, 119.4, 123.7, 127.9, 132.3, 131.7, 131.2, 21.0, 21.0, 21.1, 20.9, 21.0, 21.0, 21.0, 22.8, 23.7, 24.0, 23.6, 23.4, 24.1, 24.2, 32.8, 32.7, 32.7, 33.0, 33.0, 33.1, 33.0, 24.9, 24.9],
  brix: [39.7, 39.7, 26.9, 43.3, 38.5, 37.8, 46.0, 38.6, 38.5, 27.4, 34.2, 34.1, 34.0, 48.7, 34.1, 34.1, 16.5, 40.0, 33.7, 33.6, 44.9, 33.7, 33.7, 18.9, 38.1, 33.6, 34.4, 47.3, 33.9, 33.8, 17.2, 38.0, 35.9, 33.7, 33.7],
};

describe('robust rate on real daily yields', () => {
  it('keeps steady vaults at their level', () => {
    expect(robustRate(REAL.apyUSD).pct).toBeCloseTo(14.2, 1);
    expect(robustRate(REAL.sUSDe).pct).toBeCloseTo(5.0, 1);
    expect(robustRate(REAL.brix).pct).toBeCloseTo(33.8, 1);
    expect(robustRate(REAL.apyUSD).pattern).toBe('smooth');
  });

  it('takes the jump days out and keeps the vault (ctDefiUSDT: 515 % and 5086 %)', () => {
    const r = robustRate(REAL.ctDefiUSDT);
    expect(r.pattern).toBe('jump-removed');
    expect(r.jumpDays).toBe(2);
    expect(r.pct).toBeGreaterThan(1);
    expect(r.pct).toBeLessThan(10);
  });

  it('follows a real rise and drops a boost that ended (Harvest: 130 % for a week, then 21–33 %)', () => {
    const r = robustRate(REAL.harvest);
    expect(r.pattern).toBe('smooth');
    expect(r.pct).toBeCloseTo(33, 0);
    expect(r.trend).toBe('up');
  });

  it('prices a stepwise vault on the long mean, only with enough history (Upshift)', () => {
    expect(robustRate(REAL.upshift, 1.4, 90)).toMatchObject({ pattern: 'stepwise', pct: 1.4 });
    expect(robustRate(REAL.upshift, 1.4, 40)).toMatchObject({ pattern: 'stepwise', pct: null, reason: 'stepwise-short' });
  });

  it('takes the lower of the month median and the long mean for a volatile vault (Saturn)', () => {
    const r = robustRate(REAL.saturn, 88, 90);
    expect(r.pattern).toBe('volatile');
    expect(r.pct).toBeLessThan(35);
    expect(robustRate(REAL.saturn).pct).toBeNull();
  });

  it('marks a young history and needs at least three days', () => {
    expect(robustRate([5, 5.1, 5.2, 5.1]).young).toBe(true);
    expect(robustRate([5, 5.1]).pct).toBeNull();
  });

  it('builds one value per UTC day from dated points', () => {
    const day = 86_400_000;
    const pts = Array.from({ length: 40 }, (_, i) => ({ t: i * day + 3_600_000, v: 0.05 }));
    pts.push({ t: 39 * day + 7_200_000, v: 0.06 }); // a later point the same day wins
    const r = robustFromPoints(pts);
    expect(r?.days).toBe(40);
    expect(r?.median7).toBeCloseTo(5, 6);
    expect(r?.long).toBeCloseTo((39 * 5 + 6) / 40, 6);
  });
});
