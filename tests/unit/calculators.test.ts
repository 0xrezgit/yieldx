import { describe, expect, it } from 'vitest';
import {
  calculateImpliedMetrics,
  impliedAPYFromPT,
  impliedAPYFromYT,
  ptPriceFromAPY,
} from '../../src/lib/calculators/implied-apy';
import { ytPnL, ytPosition, ytYield, ptFixedReturn } from '../../src/lib/calculators/pt-yt';
import { calculatePointsValuation } from '../../src/lib/calculators/points-valuation';
import { calculateAPYScenarios } from '../../src/lib/calculators/apy-scenarios';
import { calculateLooping } from '../../src/lib/calculators/looping';
import { airdropValue, pointsEarned, valuePerPoint } from '../../src/lib/calculators/airdrop';
import { sensitivityCube, APY_SHIFTS, FDV_FACTORS, MULTIPLIER_FACTORS } from '../../src/lib/calculators/sensitivity';

describe('implied APY', () => {
  it('annualises the PT discount over the time to maturity', () => {
    expect(impliedAPYFromPT(0.9, 365)).toBeCloseTo(11.111, 3);
    expect(impliedAPYFromPT(0.95, 182.5)).toBeCloseTo((1 / 0.95) ** 2 * 100 - 100, 6);
  });

  it('is the inverse of ptPriceFromAPY', () => {
    for (const [apy, days] of [[3, 30], [12, 120], [40, 400]]) {
      expect(impliedAPYFromPT(ptPriceFromAPY(apy, days), days)).toBeCloseTo(apy, 8);
    }
  });

  it('derives YT implied APY from 1 − YT', () => {
    expect(impliedAPYFromYT(0.1, 365)).toBeCloseTo(impliedAPYFromPT(0.9, 365), 10);
  });

  it('returns NaN for impossible prices instead of garbage', () => {
    expect(impliedAPYFromPT(0, 30)).toBeNaN();
    expect(impliedAPYFromPT(1.2, 30)).toBeNaN();
    expect(impliedAPYFromPT(0.9, 0)).toBeNaN();
  });

  it('classifies the gap between implied and base APY', () => {
    const pt = (apy: number) => ptPriceFromAPY(apy, 180);
    expect(calculateImpliedMetrics(pt(8), 180, 10).status).toBe('safe');
    expect(calculateImpliedMetrics(pt(10.5), 180, 10).status).toBe('warning');
    const danger = calculateImpliedMetrics(pt(13), 180, 10);
    expect(danger.status).toBe('danger');
    expect(danger.gap).toBeCloseTo(3, 6);
    expect(danger.gapPercent).toBeCloseTo(30, 4);
  });

  it('does not divide by zero when base APY is 0', () => {
    const m = calculateImpliedMetrics(0.95, 180, 0);
    expect(m.gapPercent).toBe(Infinity);
    expect(m.status).toBe('danger');
  });
});

describe('YT position', () => {
  const input = { capital: 1000, underlyingPrice: 1, ytPrice: 0.05, daysToMaturity: 365 };

  it('sizes the position and its leverage', () => {
    const pos = ytPosition(input);
    expect(pos.units).toBeCloseTo(20_000);
    expect(pos.notional).toBeCloseTo(20_000);
    expect(pos.leverage).toBeCloseTo(20);
  });

  it('breaks even exactly at the break-even APY', () => {
    const pos = ytPosition(input);
    expect(pos.breakEvenAPY).toBeCloseTo(5, 8);
    expect(ytPnL(input, pos.breakEvenAPY)).toBeCloseTo(0, 6);
    expect(ytPnL(input, 0)).toBe(-1000);
  });

  it('accounts for the USD price of the underlying', () => {
    const pos = ytPosition({ ...input, underlyingPrice: 2000 });
    expect(pos.units).toBeCloseTo(10);
    expect(pos.notional).toBeCloseTo(20_000);
  });

  it('compounds yield over partial years', () => {
    expect(ytYield(10_000, 10, 182.5)).toBeCloseTo(10_000 * (Math.sqrt(1.1) - 1), 6);
  });

  it('computes PT fixed return', () => {
    expect(ptFixedReturn(900, 0.9)).toBeCloseTo(100);
  });
});

describe('points and airdrop', () => {
  it('earns points linearly', () => {
    expect(pointsEarned(1000, 1, 5, 30)).toBe(150_000);
    expect(pointsEarned(-5, 1, 1, 1)).toBe(0);
  });

  it('values points from FDV × allocation / supply', () => {
    const input = { fdv: 1e9, allocation: 10, totalPointsSupply: 1e9 };
    expect(valuePerPoint(input)).toBeCloseTo(0.1);
    expect(airdropValue(1000, input)).toBeCloseTo(100);
    expect(valuePerPoint({ ...input, totalPointsSupply: 0 })).toBe(0);
  });

  it('computes cost per million and break-even FDV', () => {
    const v = calculatePointsValuation({
      capital: 1000,
      yieldReturn: 400,
      points: 6_000_000,
      fdv: 1e9,
      allocation: 10,
      totalPointsSupply: 1e9,
    });
    expect(v.burn).toBe(600);
    expect(v.costPerMillion).toBeCloseTo(100);
    expect(v.valuePerMillion).toBeCloseTo(100_000);
    // 600 × 1e9 / (6e6 × 0.1)
    expect(v.breakEvenFDV).toBeCloseTo(1e6);
    expect(v.recommendation).toBe('buy');
  });

  it('recommends wait / avoid around break-even FDV', () => {
    const base = { capital: 1000, yieldReturn: 400, points: 6_000_000, allocation: 10, totalPointsSupply: 1e9 };
    expect(calculatePointsValuation({ ...base, fdv: 1.1e6 }).recommendation).toBe('wait');
    expect(calculatePointsValuation({ ...base, fdv: 0.5e6 }).recommendation).toBe('avoid');
  });

  it('treats a position whose yield covers the capital as free points', () => {
    const v = calculatePointsValuation({
      capital: 1000,
      yieldReturn: 1200,
      points: 1,
      fdv: 0,
      allocation: 10,
      totalPointsSupply: 1,
    });
    expect(v.costPerMillion).toBe(0);
    expect(v.recommendation).toBe('buy');
  });

  it('avoids when a burning position earns no points', () => {
    const v = calculatePointsValuation({
      capital: 1000,
      yieldReturn: 100,
      points: 0,
      fdv: 1e9,
      allocation: 10,
      totalPointsSupply: 1e9,
    });
    expect(v.recommendation).toBe('avoid');
    expect(v.costPerMillion).toBe(Infinity);
  });
});

describe('APY scenarios', () => {
  const pos = { capital: 1000, underlyingPrice: 1, ytPrice: 0.05, daysToMaturity: 365 };

  it('uses historical min/max for bear and bull', () => {
    const r = calculateAPYScenarios(5, [3, 4, 6, 8], pos, 100);
    expect(r.fromHistory).toBe(true);
    expect(r.scenarios.bear.apy).toBe(3);
    expect(r.scenarios.bull.apy).toBe(8);
    expect(r.scenarios.base.pnl).toBeCloseTo(0, 6);
    expect(r.scenarios.base.pnlWithAirdrop).toBeCloseTo(100, 6);
  });

  it('falls back to ±30% without history', () => {
    const r = calculateAPYScenarios(10, [], pos);
    expect(r.fromHistory).toBe(false);
    expect(r.scenarios.bear.apy).toBeCloseTo(7);
    expect(r.scenarios.bull.apy).toBeCloseTo(13);
  });

  it('gives no case a probability and builds no expected value', () => {
    const r = calculateAPYScenarios(5, [3, 8], pos);
    for (const c of Object.values(r.scenarios)) expect(c).not.toHaveProperty('probability');
    expect(r).not.toHaveProperty('expectedPnL');
    expect(r).not.toHaveProperty('expectedPnLWithAirdrop');
  });
});

describe('PT looping', () => {
  it('sums the geometric series of deposits', () => {
    const r = calculateLooping({ capital: 1000, ptPrice: 0.9, ltv: 50, loops: 1, borrowAPY: 10, daysToMaturity: 365 });
    expect(r.collateral).toBeCloseTo(1500);
    expect(r.debt).toBeCloseTo(500);
    expect(r.aggregateLTV).toBeCloseTo(100 / 3);
    // PT gain 1500 × (1/0.9 − 1) = 166.67, borrow cost 50
    expect(r.profitToMaturity).toBeCloseTo(116.667, 2);
    expect(r.netAPY).toBeCloseTo(11.667, 2);
    expect(r.breakEvenBorrowAPY).toBeCloseTo(33.333, 2);
  });

  it('with zero loops is just holding PT', () => {
    const r = calculateLooping({ capital: 1000, ptPrice: 0.9, ltv: 75, loops: 0, borrowAPY: 10, daysToMaturity: 365 });
    expect(r.debt).toBe(0);
    expect(r.aggregateLTV).toBe(0);
    expect(r.profitToMaturity).toBeCloseTo(ptFixedReturn(1000, 0.9));
    expect(r.breakEvenBorrowAPY).toBe(Infinity);
  });

  it('turns negative when borrowing costs more than break-even', () => {
    const r = calculateLooping({ capital: 1000, ptPrice: 0.9, ltv: 50, loops: 1, borrowAPY: 40, daysToMaturity: 365 });
    // PT gain 166.67 − borrow cost 500 × 40% = 200
    expect(r.profitToMaturity).toBeCloseTo(-33.333, 2);
    expect(r.netAPY).toBeLessThan(0);
  });
});

describe('sensitivity cube', () => {
  const input = {
    capital: 1000,
    underlyingPrice: 1,
    ytPrice: 0.05,
    daysToMaturity: 365,
    baseAPY: 5,
    pointsPerDay: 1,
    ytMultiplier: 2,
    fdv: 1e8,
    allocation: 10,
    totalPointsSupply: 1e10,
  };

  it('has fdv × apy × multiplier dimensions', () => {
    const cube = sensitivityCube(input);
    expect(cube).toHaveLength(FDV_FACTORS.length);
    expect(cube[0]).toHaveLength(APY_SHIFTS.length);
    expect(cube[0][0]).toHaveLength(MULTIPLIER_FACTORS.length);
  });

  it('increases monotonically along every axis', () => {
    const cube = sensitivityCube(input);
    const f = FDV_FACTORS.indexOf(1);
    const a = APY_SHIFTS.indexOf(0);
    const m = MULTIPLIER_FACTORS.indexOf(1);
    expect(cube[f + 1][a][m].pnl).toBeGreaterThan(cube[f][a][m].pnl);
    expect(cube[f][a + 1][m].pnl).toBeGreaterThan(cube[f][a][m].pnl);
    expect(cube[f][a][m + 1].pnl).toBeGreaterThan(cube[f][a][m].pnl);
  });

  it('centre cell equals yield + airdrop − capital at the base inputs', () => {
    const cube = sensitivityCube(input);
    const cell = cube[FDV_FACTORS.indexOf(1)][APY_SHIFTS.indexOf(0)][MULTIPLIER_FACTORS.indexOf(1)];
    // 20k YT × 1 × 2 × 365 points = 14.6M; value/point = 1e7/1e10 = 0.001 → $14,600
    expect(cell.pnl).toBeCloseTo(0 + 14_600, 4);
  });
});
