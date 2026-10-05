import type { LpPool } from './pools';
import { scenario, type LpInput, type LpScenario } from './scenarios';

/**
 * A dollar figure for an LP pool, for ranking the pool list. Deliberately cautious:
 *
 * - fees: last week's realised fee rate of the whole pool, carried forward, on a
 *   full-range position (a narrow range earns more but can fall out of range);
 * - loss: the worse of the pool's usual swing down or up over the period — vfat's
 *   95th-percentile 7-day move, scaled by √(days ÷ 7) — against simply holding;
 * - incentive rewards and gas are not counted.
 *
 * It is an estimate on stated assumptions, not a forecast; the analyzer shows the
 * same numbers per scenario.
 */

/** The pool's usual swing over `days` as fractions (0.08 = 8%), both positive. */
export function typicalMove(p: Pick<LpPool, 'move7d'>, days: number): { down: number; up: number } {
  const k = Math.sqrt(Math.max(0, days) / 7);
  return { down: Math.min(0.9, (p.move7d.down / 100) * k), up: (p.move7d.up / 100) * k };
}

export const poolInput = (p: Pick<LpPool, 'feeAprPct'>, capital: number, days: number): LpInput => ({
  capital,
  days,
  shape: { kind: 'full' },
  feeAprPct: p.feeAprPct,
  rewardUsd: null,
  rewardAprPct: 0,
  costsUsd: 0,
});

export interface PoolEstimate {
  /** Fees earned in the worse of the two usual swings. */
  feesUsd: number;
  /** Loss against holding in that swing (≤ 0). */
  lossUsd: number;
  /** Fees + loss: what being an LP adds over holding the same two assets. */
  netUsd: number;
  /** The swing used. */
  move: { down: number; up: number };
}

export function estimatePool(p: Pick<LpPool, 'feeAprPct' | 'move7d'>, capital: number, days: number): PoolEstimate | null {
  if (!(capital > 0) || !(days > 0)) return null;
  const move = typicalMove(p, days);
  const input = poolInput(p, capital, days);
  const down = scenario(input, -move.down);
  const up = scenario(input, move.up);
  const worse: LpScenario = (down.vsHodlUsd ?? -Infinity) <= (up.vsHodlUsd ?? -Infinity) ? down : up;
  if (worse.feesUsd === null || worse.vsHodlUsd === null || !Number.isFinite(worse.vsHodlUsd)) return null;
  return { feesUsd: worse.feesUsd, lossUsd: worse.ilUsd, netUsd: worse.vsHodlUsd, move };
}

/** Pools with their estimate, best dollar figure first. */
export function rankPools<P extends Pick<LpPool, 'id' | 'feeAprPct' | 'move7d'>>(pools: P[], capital: number, days: number): { pool: P; est: PoolEstimate }[] {
  const out: { pool: P; est: PoolEstimate }[] = [];
  for (const pool of pools) {
    const est = estimatePool(pool, capital, days);
    if (est) out.push({ pool, est });
  }
  return out.sort((a, b) => b.est.netUsd - a.est.netUsd || (a.pool.id < b.pool.id ? -1 : 1));
}
