import { describe, expect, it } from 'vitest';
import { assessLiquidation } from '../../src/lib/risk/liquidation';
import { assessLiquidityRisk, calculateImpermanentLoss } from '../../src/lib/risk/impermanent-loss';
import { analyzeAPYTrend, assessTrendRisk } from '../../src/lib/risk/apy-trend';
import { impliedAPYFromPT } from '../../src/lib/calculators/implied-apy';
import { calculateCLMM } from '../../src/lib/calculators/clmm';

describe('liquidation', () => {
  it('computes health factor and liquidation PT price', () => {
    const r = assessLiquidation(70, 85, 0.9, 180);
    expect(r.healthFactor).toBeCloseTo(85 / 70);
    expect(r.liquidationPTPrice).toBeCloseTo(0.9 * (70 / 85));
    expect(r.priceDropToLiquidation).toBeCloseTo((1 - 70 / 85) * 100);
    expect(r.liquidationImpliedAPY).toBeCloseTo(impliedAPYFromPT(0.9 * (70 / 85), 180));
    expect(r.risk).toBe('medium');
  });

  it('grades risk by health factor', () => {
    expect(assessLiquidation(80, 85, 0.9, 180).risk).toBe('high'); // HF 1.06
    expect(assessLiquidation(50, 85, 0.9, 180).risk).toBe('low'); // HF 1.7
  });

  it('is risk-free without debt', () => {
    const r = assessLiquidation(0, 85, 0.9, 180);
    expect(r.healthFactor).toBe(Infinity);
    expect(r.risk).toBe('low');
  });
});

describe('impermanent loss', () => {
  it('matches the full-range (v2) formula for a very wide range', () => {
    // v2: IL = 1 − 2√r / (1 + r), r = 4 → 20%
    expect(calculateImpermanentLoss(1e-9, 1e9, 4, 1)).toBeCloseTo(20, 2);
  });

  it('is zero when price has not moved', () => {
    expect(calculateImpermanentLoss(0.8, 1.2, 1, 1)).toBeCloseTo(0, 10);
  });

  it('is larger for a concentrated range than for a wide one', () => {
    const narrow = calculateImpermanentLoss(0.9, 1.1, 1.05, 1);
    const wide = calculateImpermanentLoss(0.5, 2, 1.05, 1);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('does not report 100% loss when price leaves the range', () => {
    const out = calculateImpermanentLoss(0.9, 1.1, 0.5, 1);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(100);
    // Below the range the position is all token X; further moves don't add IL beyond HODL divergence
    const edge = calculateImpermanentLoss(0.9, 1.1, 0.9, 1);
    expect(out).toBeGreaterThanOrEqual(edge);
  });

  it('rejects invalid ranges', () => {
    expect(calculateImpermanentLoss(1.2, 0.8, 1, 1)).toBeNaN();
  });
});

describe('liquidity (range) risk', () => {
  it('is low in the middle of the range', () => {
    expect(assessLiquidityRisk(5, 15, 10)).toEqual({ risk: 'low', inRange: true, distanceToEdge: 0.5 });
  });

  it('is high near the edge', () => {
    expect(assessLiquidityRisk(5, 15, 5.5).risk).toBe('high');
    expect(assessLiquidityRisk(5, 15, 7).risk).toBe('medium');
  });

  it('is high out of range', () => {
    expect(assessLiquidityRisk(5, 15, 20)).toMatchObject({ risk: 'high', inRange: false });
  });

  it('escalates when volatility reaches the edge', () => {
    expect(assessLiquidityRisk(5, 15, 10, 1).risk).toBe('low');
    expect(assessLiquidityRisk(5, 15, 10, 3).risk).toBe('medium');
    expect(assessLiquidityRisk(5, 15, 10, 5).risk).toBe('high');
  });
});

describe('CLMM in implied-APY terms', () => {
  const base = {
    capital: 1000,
    underlyingPrice: 1,
    impliedAPY: 10,
    rangeLowerAPY: 5,
    rangeUpperAPY: 15,
    feeAPY: 12,
    daysToMaturity: 365,
    pointsPerDay: 1,
    pointsBasis: 'unit' as const,
    lpMultiplier: 2,
    apyVolatility: 0,
  };

  it('earns fees and points only while in range', () => {
    const inRange = calculateCLMM(base);
    expect(inRange.feeIncome).toBeCloseTo(120);
    expect(inRange.points).toBe(1000 * 2 * 365);
    const out = calculateCLMM({ ...base, impliedAPY: 20 });
    expect(out.inRange).toBe(false);
    expect(out.feeIncome).toBe(0);
    expect(out.points).toBe(0);
  });

  it('reports IL at both range edges', () => {
    const r = calculateCLMM(base);
    expect(r.ilAtLowerEdge).toBeGreaterThan(0);
    expect(r.ilAtUpperEdge).toBeGreaterThan(0);
  });
});

describe('APY trend', () => {
  it('needs at least two samples', () => {
    expect(analyzeAPYTrend([5], 5)).toBeNull();
  });

  it('detects a rising trend and extrapolates it', () => {
    const t = analyzeAPYTrend([1, 2, 3, 4, 5, 6, 7], 7)!;
    expect(t.trend7d).toBeCloseTo(1);
    expect(t.predictedNextWeek).toBeCloseTo(14);
    expect(t.samples).toBe(7);
  });

  it('flags a steep decline as high risk', () => {
    const series = Array.from({ length: 30 }, (_, i) => 20 - i * 0.6);
    const t = analyzeAPYTrend(series, series.at(-1)!)!;
    expect(t.trend7d).toBeCloseTo(-0.6);
    expect(t.risk).toBe('high');
    expect(t.predictedNextWeek).toBeGreaterThanOrEqual(0);
  });

  it('grades risk from slope and volatility', () => {
    expect(assessTrendRisk(0.1, 0.1, 0.5)).toBe('low');
    expect(assessTrendRisk(-0.1, 0.1, 0.5)).toBe('medium');
    expect(assessTrendRisk(0.1, 0.1, 3)).toBe('high');
  });

  it('ignores non-finite points', () => {
    const t = analyzeAPYTrend([5, NaN, 5, 5], 5)!;
    expect(t.samples).toBe(3);
    expect(t.volatility).toBe(0);
  });
});
