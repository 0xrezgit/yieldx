import type { GasQuote } from '../merkl/types';
import { estimateAt, type Evaluated } from '../market/analysis';
import { MAX_SHARE, nearestPaths, type NearResult } from './goal-plan';
import { LEVERAGE_PROFILES, type HorizonDays, type LeverageProfileId } from './policy';
import type { LeverageInput } from './leverage';

/**
 * «پیشنهاد ما» — the least risky combination of choices that reaches the target:
 * path (safe / balanced / high-yield) × leverage profile × «تکرار» × the diversity rule.
 *
 * Risk is counted, not guessed: each step away from «locked, cautious, once, spread out»
 * adds points (RISK). Among the combinations that reach the target the fewest points
 * win, then the most dollars. When none does, the most dollars among the acceptable
 * ones (aggressive leverage is never recommended; it is reported apart when it would
 * reach the target).
 */

export type PathId = 'safe' | 'balanced' | 'max';

export interface Choice {
  path: PathId;
  leverage: LeverageProfileId;
  roll: boolean;
  diversify: boolean;
}

export interface Recommendation {
  choice: Choice;
  total: number;
  reached: boolean;
  risk: number;
  /** Aggressive leverage, when it reaches the target and the recommendation does not. */
  aggressive: { choice: Choice; total: number } | null;
}

/** Points per step away from the safest choice. */
export const RISK = {
  path: { safe: 0, balanced: 2, max: 3 } as Record<PathId, number>,
  leverage: { cautious: 0, balanced: 2, aggressive: 5 } as Record<LeverageProfileId, number>,
  roll: 1,
  concentrate: 1,
};

export const riskOf = (c: Choice) => RISK.path[c.path] + RISK.leverage[c.leverage] + (c.roll ? RISK.roll : 0) + (c.diversify ? 0 : RISK.concentrate);

export const levInput = (id: LeverageProfileId): LeverageInput => ({ ...LEVERAGE_PROFILES[id].lev, pt: LEVERAGE_PROFILES[id].pt });

/** Loops re-estimated under a leverage profile (the market analysis uses the cautious one). */
export function rowsUnder(rows: Evaluated[], id: LeverageProfileId, capital: number, days: HorizonDays, gas: GasQuote[], now: number): Evaluated[] {
  if (id === 'cautious') return rows;
  const lev = levInput(id);
  return rows.map((r) => (r.o.family === 'leverage' ? { ...r, byHorizon: { ...r.byHorizon, [days]: estimateAt(r.o, capital, days, gas, now, lev) } } : r));
}

export function totalOf(r: NearResult, path: PathId): number | null {
  if (path === 'safe') return r.realistic.locked.total;
  if (path === 'max') return r.realistic.variable.total;
  return r.blend ? r.blend.total : null;
}

export function recommend(rows: Evaluated[], gas: GasQuote[], days: HorizonDays, capital: number, target: number, now = Date.now()): Recommendation | null {
  const tried: { choice: Choice; total: number; risk: number }[] = [];
  const run = (leverage: LeverageProfileId, roll: boolean, diversify: boolean, under: Evaluated[]) => {
    const near = nearestPaths(under, gas, days, capital, target, { now, roll, maxShare: diversify ? MAX_SHARE : 1, leverage: levInput(leverage) });
    for (const path of ['safe', 'balanced', 'max'] as PathId[]) {
      const total = totalOf(near, path);
      if (total === null || !(total > 0)) continue;
      const choice = { path, leverage, roll, diversify };
      tried.push({ choice, total, risk: riskOf(choice) });
    }
  };
  for (const leverage of ['cautious', 'balanced', 'aggressive'] as LeverageProfileId[]) {
    const under = rowsUnder(rows, leverage, capital, days, gas, now);
    for (const roll of [false, true]) run(leverage, roll, true, under);
  }
  // Spreading out is the last thing given up: only when nothing reaches the target with it.
  if (!tried.some((t) => t.total >= target)) {
    for (const leverage of ['cautious', 'balanced'] as LeverageProfileId[]) run(leverage, true, false, rowsUnder(rows, leverage, capital, days, gas, now));
  }
  if (!tried.length) return null;
  const acceptable = tried.filter((t) => t.choice.leverage !== 'aggressive');
  const reach = acceptable.filter((t) => t.total >= target).sort((a, b) => a.risk - b.risk || b.total - a.total);
  const best = reach[0] ?? [...acceptable].sort((a, b) => b.total - a.total || a.risk - b.risk)[0] ?? tried[0];
  const agg = tried.filter((t) => t.choice.leverage === 'aggressive' && t.total >= target).sort((a, b) => a.risk - b.risk || b.total - a.total)[0];
  return {
    choice: best.choice,
    total: best.total,
    reached: best.total >= target,
    risk: best.risk,
    aggressive: !reach.length && agg ? { choice: agg.choice, total: agg.total } : null,
  };
}
