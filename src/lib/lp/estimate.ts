import type { LpPool } from './pools';
import { concentration, type LpInput, type PoolShape } from './scenarios';

/**
 * An expected dollar figure for an LP pool, for ranking the pool list.
 *
 * - The position: in a concentrated pool, a range as wide as the pool's usual
 *   swing over the period (vfat's 95th-percentile 7-day move scaled by √(days ÷ 7)),
 *   so the price usually stays inside; in a plain pool, the full range.
 * - Fees: the pool's full-range fee rate of the last 7 days (per unit of
 *   liquidity), times the range's concentration.
 * - Cost of volatility: an LP keeps selling the asset that rises and buying the
 *   one that falls. Its expected cost against holding is σ²/8 of the position per
 *   year for a full-range position (loss-versus-rebalancing, Milionis et al. 2022),
 *   σ = the pair's realised volatility, and scales with concentration too.
 *
 * So the expected result is concentration × (fee rate − σ²/8) × capital × time.
 * Incentive rewards, gas and leaving the range are not counted. An expectation
 * on these assumptions, not a forecast; the analyzer shows single outcomes.
 */

/** The pool's usual swing over `days` as fractions (0.08 = 8%), both positive. */
export function typicalMove(p: Pick<LpPool, 'move7d'>, days: number): { down: number; up: number } {
  const k = Math.sqrt(Math.max(0, days) / 7);
  return { down: Math.min(0.9, (p.move7d.down / 100) * k), up: (p.move7d.up / 100) * k };
}

/** The position the estimate assumes; at least ±1% so a calm pair still has a range. */
export function suggestedShape(p: Pick<LpPool, 'move7d' | 'concentrated'>, days: number): PoolShape {
  if (!p.concentrated) return { kind: 'full' };
  const m = typicalMove(p, days);
  return { kind: 'range', low: 1 - Math.max(0.01, m.down), high: 1 + Math.max(0.01, m.up) };
}

export const poolInput = (p: Pick<LpPool, 'feeAprPct' | 'move7d' | 'concentrated'>, capital: number, days: number): LpInput => ({
  capital,
  days,
  shape: suggestedShape(p, days),
  feeAprPct: p.feeAprPct,
  feeBasis: 'full-range',
  rewardUsd: null,
  rewardAprPct: 0,
  costsUsd: 0,
});

/** Expected yearly cost of volatility for a full-range position, % of its value: σ²/8. */
export const volatilityCostPct = (volAnnualPct: number) => ((volAnnualPct / 100) ** 2 / 8) * 100;

export interface PoolEstimate {
  /** Expected fees over the period. */
  feesUsd: number;
  /** Expected cost of volatility against holding (≤ 0). */
  lossUsd: number;
  /** Fees + loss. */
  netUsd: number;
  /** The position assumed. */
  shape: PoolShape;
  /** Yearly fee rate of that position while in range, %. */
  positionAprPct: number;
}

type Estimable = Pick<LpPool, 'feeAprPct' | 'move7d' | 'concentrated' | 'volAnnualPct'>;

export function estimatePool(p: Estimable, capital: number, days: number): PoolEstimate | null {
  if (!(capital > 0) || !(days > 0)) return null;
  const shape = suggestedShape(p, days);
  const k = concentration(shape);
  if (!Number.isFinite(k)) return null;
  const t = days / 365;
  const feesUsd = capital * t * (p.feeAprPct / 100) * k;
  const lossUsd = -capital * t * (volatilityCostPct(p.volAnnualPct) / 100) * k;
  return { feesUsd, lossUsd, netUsd: feesUsd + lossUsd, shape, positionAprPct: p.feeAprPct * k };
}

/** Pools with their estimate, best dollar figure first. */
export function rankPools<P extends Estimable & Pick<LpPool, 'id'>>(pools: P[], capital: number, days: number): { pool: P; est: PoolEstimate }[] {
  const out: { pool: P; est: PoolEstimate }[] = [];
  for (const pool of pools) {
    const est = estimatePool(pool, capital, days);
    if (est) out.push({ pool, est });
  }
  return out.sort((a, b) => b.est.netUsd - a.est.netUsd || (a.pool.id < b.pool.id ? -1 : 1));
}
