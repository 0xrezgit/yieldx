import type { LpPool } from './pools';
import { capFactor, positionRewardApr } from './rewards';
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
 *
 * An Aero pool also offers staking: AERO instead of the fees (rewards.ts). That
 * mode is estimated the same way, the AERO rate shared with what is already staked
 * and — cautiously — cut to Aero's cap target when the pool pays far more than it
 * earns; the better of the two modes is the pool's figure.
 *
 * Other incentive rewards, gas and leaving the range are not counted. An
 * expectation on these assumptions, not a forecast; the analyzer shows single outcomes.
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

/** How a position earns: swap fees (unstaked), or the gauge's AERO (staked, no fees). */
export type EarnMode = 'fees' | 'stake';

/** Expected yearly cost of volatility for a full-range position, % of its value: σ²/8. */
export const volatilityCostPct = (volAnnualPct: number) => ((volAnnualPct / 100) ** 2 / 8) * 100;

export interface PoolEstimate {
  /** The mode the figure is for: the better of the two when the pool offers both. */
  mode: EarnMode;
  /** Expected fees over the period (0 when staked). */
  feesUsd: number;
  /** Expected AERO over the period, at the cap target when the pool pays above it (0 unstaked). */
  rewardsUsd: number;
  /** The pool pays above Aero's cap target: `rewardsUsd` is already cut to it. */
  capped: boolean;
  /** Expected cost of volatility against holding (≤ 0). */
  lossUsd: number;
  /** Fees + rewards + loss. */
  netUsd: number;
  /** The other mode's net figure, when the pool offers both. */
  otherNetUsd: number | null;
  /** The position assumed. */
  shape: PoolShape;
  /** Yearly rate of that position while in range, %: fees, or AERO when staked. */
  positionAprPct: number;
}

type Estimable = Pick<LpPool, 'feeAprPct' | 'move7d' | 'concentrated' | 'volAnnualPct'> & Partial<Pick<LpPool, 'reward'>>;

export function estimatePool(p: Estimable, capital: number, days: number): PoolEstimate | null {
  if (!(capital > 0) || !(days > 0)) return null;
  const shape = suggestedShape(p, days);
  const k = concentration(shape);
  if (!Number.isFinite(k)) return null;
  const t = days / 365;
  const lossUsd = -capital * t * (volatilityCostPct(p.volAnnualPct) / 100) * k;
  const fees =
    p.feeAprPct === null ? null : { mode: 'fees' as const, feesUsd: capital * t * (p.feeAprPct / 100) * k, rewardsUsd: 0, capped: false, positionAprPct: p.feeAprPct * k };
  const r = p.reward;
  const apr = r ? positionRewardApr(r, shape, capital, true) : NaN;
  const stake = r && Number.isFinite(apr) ? { mode: 'stake' as const, feesUsd: 0, rewardsUsd: capital * t * (apr / 100), capped: capFactor(r) < 1, positionAprPct: apr } : null;
  const gross = (m: { feesUsd: number; rewardsUsd: number }) => m.feesUsd + m.rewardsUsd;
  const best = fees && stake ? (gross(stake) > gross(fees) ? stake : fees) : (fees ?? stake);
  if (!best) return null;
  const other = best === fees ? stake : fees;
  return { ...best, lossUsd, netUsd: gross(best) + lossUsd, otherNetUsd: other ? gross(other) + lossUsd : null, shape };
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
