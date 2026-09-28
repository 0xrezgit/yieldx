import thresholds from '../../config/thresholds.json';
import type { RiskLevel } from './liquidation';

/** Token amounts of a concentrated-liquidity position with liquidity `L` at price `p`. */
function amounts(L: number, p: number, a: number, b: number) {
  const sp = Math.sqrt(Math.min(Math.max(p, a), b));
  return { x: L * (1 / sp - 1 / Math.sqrt(b)), y: L * (sp - Math.sqrt(a)) };
}

/**
 * Impermanent loss of a concentrated-liquidity position in [priceLower, priceUpper]
 * opened at `initialPrice`, valued at `currentPrice`, versus simply holding the
 * initial tokens. Returned as a positive % loss.
 *
 * Leaving the range does not lose the whole position — it converts fully into one
 * token, and IL is capped at that point.
 */
export function calculateImpermanentLoss(
  priceLower: number,
  priceUpper: number,
  currentPrice: number,
  initialPrice: number,
): number {
  if (!(priceLower > 0 && priceUpper > priceLower && currentPrice > 0 && initialPrice > 0)) return NaN;
  const L = 1;
  const start = amounts(L, initialPrice, priceLower, priceUpper);
  const end = amounts(L, currentPrice, priceLower, priceUpper);
  const hodl = start.x * currentPrice + start.y;
  const lp = end.x * currentPrice + end.y;
  if (!(hodl > 0)) return NaN;
  return Math.max(0, (1 - lp / hodl) * 100);
}

export interface LiquidityRisk {
  risk: RiskLevel;
  inRange: boolean;
  /** Distance to the closer edge as a fraction of range width (0 at the edge, 0.5 at centre). */
  distanceToEdge: number;
}

/**
 * Range risk. Works with any monotonic coordinate (price or implied APY).
 * `volatility` is the daily standard deviation in the same units; if one standard
 * deviation already reaches the closer edge the risk is high regardless of position.
 */
export function assessLiquidityRisk(
  lower: number,
  upper: number,
  current: number,
  volatility = 0,
): LiquidityRisk {
  const width = upper - lower;
  if (!(width > 0)) return { risk: 'high', inRange: false, distanceToEdge: 0 };
  const inRange = current >= lower && current <= upper;
  if (!inRange) return { risk: 'high', inRange, distanceToEdge: 0 };

  const distance = Math.min(current - lower, upper - current);
  const distanceToEdge = distance / width;

  let risk: RiskLevel;
  if (distanceToEdge < thresholds.clmm.edgeHigh || (volatility > 0 && volatility >= distance)) risk = 'high';
  else if (distanceToEdge < thresholds.clmm.edgeMedium || (volatility > 0 && volatility * 2 >= distance)) risk = 'medium';
  else risk = 'low';

  return { risk, inRange, distanceToEdge };
}
