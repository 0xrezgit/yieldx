import type { BaseLevels } from '../../types/market';
import type { BaseHistoryPoint } from './health';

/**
 * A variable base yield is never held at today's figure for the whole hold. Three
 * readings, the same for every market (YT dollar board, unified ranking, YT tool):
 *
 *   level L   the market's own longer level: 30-day, else 90, else 7 (on-chain growth
 *             first; else the median of the published daily figure — spikes do not move it)
 *   faded     today's figure fading into L:  L + (today − L) × w(h)
 *             w(h) = τ/h × (1 − e^(−h/τ)), the average weight of today's deviation over
 *             h days when it halves every τ·ln2 days. A short hold keeps most of today's
 *             figure; a long one is mostly the level.
 *   likely    the lower of today and faded — ranked on; a level above today is never
 *             counted as the expected case (sUSDat: 10.6% today, 4.6–106% over the month)
 *   low       the lowest of today, likely and every measured window (7, 30, 90 days)
 *   high      the higher of today and faded
 *
 * Without any history only today is known: likely = today and low = today ×
 * `noHistoryLowShare` (an assumption, said so on screen).
 */
export const BASE_SCENARIO = {
  /** Days for today's deviation from the level to fade by 1/e (half in ~10 days). */
  reversionDays: 14,
  /** Low reading when the market has no history: this share of today's figure. */
  noHistoryLowShare: 0.75,
} as const;

export interface BaseScenarios {
  low: number;
  likely: number;
  high: number;
  /** The longer level today's figure fades into; null without history. */
  level: number | null;
  /** History was available (else `low` is the fixed share of today). */
  measured: boolean;
}

const finite = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** Average weight of today's deviation over `days` (1 at day 0, → τ/h for long holds). */
export function reversionWeight(days: number, tau: number = BASE_SCENARIO.reversionDays): number {
  if (!(days > 0)) return 1;
  return (tau / days) * (1 - Math.exp(-days / tau));
}

/**
 * The three readings for `days` held. `todayPct` is the figure the market would otherwise
 * be ranked on (the conservative one for a suspect market); `cap` keeps every measured
 * window at or below it, so a published history the chain did not deliver cannot lift it.
 */
export function baseScenarios(todayPct: number, levels: BaseLevels | null | undefined, days: number, cap?: number | null): BaseScenarios {
  const clip = (x: number | null | undefined) => (finite(x) ? (finite(cap) ? Math.min(x, cap) : x) : null);
  const d7 = clip(levels?.d7);
  const d30 = clip(levels?.d30);
  const d90 = clip(levels?.d90);
  const level = d30 ?? d90 ?? d7;
  if (level === null) {
    const low = Math.max(0, todayPct * BASE_SCENARIO.noHistoryLowShare);
    return { low: Math.min(low, todayPct), likely: todayPct, high: todayPct, level: null, measured: false };
  }
  const faded = level + (todayPct - level) * reversionWeight(days);
  const likely = Math.min(todayPct, faded);
  const windows = [d7, d30, d90].filter(finite);
  return {
    low: Math.max(0, Math.min(todayPct, likely, ...windows)),
    likely,
    high: Math.max(todayPct, faded),
    level,
    measured: true,
  };
}

/** Median base yield over the last `days` of a daily history (oldest first); null when shorter. */
function windowMedian(h: BaseHistoryPoint[], days: number): number | null {
  if (h.length < Math.max(3, Math.ceil(days * 0.6))) return null;
  const xs = h.slice(-days).map((p) => p.basePct).filter(finite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** Levels from on-chain windows (what was delivered), else a daily history; null when neither has anything. */
export function levelsFrom(history: BaseHistoryPoint[] | null | undefined, onchain?: { d7?: number | null; d30?: number | null; d90?: number | null; moved?: boolean } | null): BaseLevels | null {
  const h = history ?? [];
  const chain = onchain && onchain.moved !== false ? onchain : null;
  const out: BaseLevels = {
    d7: finite(chain?.d7) ? chain.d7 : windowMedian(h, 7),
    d30: finite(chain?.d30) ? chain.d30 : windowMedian(h, 30),
    d90: finite(chain?.d90) ? chain.d90 : null,
  };
  return out.d7 === null && out.d30 === null && out.d90 === null ? null : out;
}

/** One Persian sentence for the assumptions list. */
export function scenarioNote(s: BaseScenarios, todayPct: number, fmt: (x: number) => string): string {
  if (!s.measured)
    return `بازده پایه متغیر است و تاریخچه‌ای از آن نداریم: حالت محتمل همان امروز (${fmt(todayPct)})، حالت بدبینانه ${fmt(s.low)}.`;
  return `بازده پایه ثابت فرض نشد: امروز ${fmt(todayPct)}، سطح ماه اخیر ${fmt(s.level as number)}؛ در دوره‌ی نگه‌داری به‌طور محتمل ${fmt(s.likely)}، در حالت بدبینانه ${fmt(s.low)}.`;
}
