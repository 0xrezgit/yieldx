import thresholds from '../../config/thresholds.json';
import { linearSlope, stdDev } from '../utils/math';
import type { RiskLevel } from './liquidation';

export interface APYTrend {
  /** Regression slope over the last 7 points, percentage points per day. */
  trend7d: number;
  /** Regression slope over the last 30 points, percentage points per day. */
  trend30d: number;
  /** Std-dev of the last 30 points, percentage points. */
  volatility: number;
  /** Linear extrapolation 7 days past the last 7-day window, %. */
  predictedNextWeek: number;
  risk: RiskLevel;
  /** Number of data points actually used. */
  samples: number;
}

export function analyzeAPYTrend(historicalAPYs: number[], currentAPY: number): APYTrend | null {
  const series = historicalAPYs.filter(Number.isFinite);
  if (series.length < 2) return null;

  const last7 = series.slice(-7);
  const last30 = series.slice(-30);
  const trend7d = linearSlope(last7);
  const trend30d = linearSlope(last30);
  const volatility = stdDev(last30);

  // Regression line through last7, evaluated 7 steps after its final point.
  const n = last7.length;
  const intercept = last7.reduce((a, b) => a + b, 0) / n - trend7d * ((n - 1) / 2);
  const predicted = intercept + trend7d * (n - 1 + 7);

  return {
    trend7d,
    trend30d,
    volatility,
    predictedNextWeek: Math.max(0, Number.isFinite(predicted) ? predicted : currentAPY),
    risk: assessTrendRisk(trend7d, trend30d, volatility),
    samples: series.length,
  };
}

export function assessTrendRisk(trend7d: number, trend30d: number, volatility: number): RiskLevel {
  const t = thresholds.trend;
  if (volatility > t.volatilityHigh) return 'high';
  if (trend7d < t.slope7dHigh && trend30d < t.slope30dHigh) return 'high';
  if (trend7d < 0 || trend30d < 0) return 'medium';
  return 'low';
}
