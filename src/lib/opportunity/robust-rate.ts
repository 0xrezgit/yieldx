import { formatNumber, formatPercent } from '../utils/formatting';

/**
 * One rule for every variable rate with a daily history: what to rank on, so that a
 * bug or an artificial jump is not counted and a real rise is not ignored.
 *
 * Settled by backtests on live DefiLlama histories (2026-10-10):
 * - Mature markets: every window (median of 7, 14 or 30 days, mean of 30) predicted the
 *   next 30 days within ~2–3 %; the 90-day mean was slightly worse.
 * - Young pools (first 14 days → their latest week): the median of the latest week erred
 *   least (17 %, 13 % overstated by >30 %); a fixed-budget dilution model erred 120 %.
 * - Daily on-chain share prices: a jump is one or two days carrying the gain
 *   (ctDefiUSDT: 7 % for 33 days, then 515 % and 5086 %); a median ignores them.
 *
 * The rule, in order:
 * 1. Days above `jumpRatio`× the median (and `jumpMinPp` above it) are jump days: taken out,
 *    the market kept.
 * 2. The pattern decides the window:
 *    - stepwise (more than half the days ≈ 0; the price is updated in lumps): the long mean,
 *      only with `stepwiseMinDays` of history;
 *    - volatile (more than `volatileNegShare` of the days negative): the lower of the 30-day
 *      median and the long mean, only with a long mean;
 *    - smooth: the median of the last `recentDays` days.
 * 3. Fewer than `matureDays` days of history: young — the median of the last week, marked.
 */

export type RatePattern = 'smooth' | 'jump-removed' | 'stepwise' | 'volatile';

export interface RobustRate {
  /** The rate to rank on, % a year; null when the history cannot support one (see `reason`). */
  pct: number | null;
  pattern: RatePattern;
  /** Fewer than `matureDays` days of history. */
  young: boolean;
  /** Days of history used. */
  days: number;
  jumpDays: number;
  median7: number | null;
  median30: number | null;
  /** The long mean given by the caller (e.g. 90 days), %. */
  long: number | null;
  /** Last week against the month: up / down by more than `trendRatio`, else flat. */
  trend: 'up' | 'down' | 'flat' | null;
  /** Why `pct` is null. */
  reason: 'too-short' | 'stepwise-short' | 'volatile-short' | null;
}

export const ROBUST = {
  recentDays: 7,
  monthDays: 30,
  matureDays: 30,
  minDays: 3,
  jumpRatio: 10,
  jumpMinPp: 50,
  /** A day under this, % a year, counts as no accrual. */
  zeroPct: 0.01,
  stepwiseShare: 0.5,
  stepwiseMinDays: 60,
  volatileNegShare: 0.2,
  trendRatio: 0.15,
} as const;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param daily  daily rates, % a year, oldest first (null = no data that day)
 * @param long   the long-window mean, % a year (e.g. 90 days), when known
 * @param longDays how many days of history the long mean covers (for the stepwise rule)
 */
export function robustRate(daily: (number | null)[], long: number | null = null, longDays = 0): RobustRate {
  const R = ROBUST;
  const all = daily.filter((x): x is number => x !== null && Number.isFinite(x));
  const base: Omit<RobustRate, 'pct' | 'pattern' | 'reason'> = { young: all.length < R.matureDays, days: all.length, jumpDays: 0, median7: null, median30: null, long, trend: null };
  if (all.length < R.minDays) return { ...base, pct: null, pattern: 'smooth', reason: 'too-short' };

  const month = all.slice(-R.monthDays);
  const mid = median(month) as number;
  const isJump = (x: number) => x > Math.max(R.jumpRatio * Math.max(mid, 0), mid + R.jumpMinPp);
  const clean = month.filter((x) => !isJump(x));
  const jumpDays = month.length - clean.length;
  const recent = all.slice(-R.recentDays).filter((x) => !isJump(x));
  const median7 = median(recent);
  const median30 = median(clean);
  const trend = median7 === null || median30 === null || !(median30 > 0) ? null : median7 > median30 * (1 + R.trendRatio) ? 'up' : median7 < median30 * (1 - R.trendRatio) ? 'down' : 'flat';
  const out = { ...base, jumpDays, median7, median30, trend } as const;

  const zeros = clean.filter((x) => Math.abs(x) < R.zeroPct).length;
  if (zeros > R.stepwiseShare * clean.length) {
    const ok = long !== null && longDays >= R.stepwiseMinDays;
    return { ...out, pct: ok ? long : null, pattern: 'stepwise', reason: ok ? null : 'stepwise-short' };
  }
  const negatives = clean.filter((x) => x < 0).length;
  if (negatives > R.volatileNegShare * clean.length) {
    if (long === null || median30 === null) return { ...out, pct: null, pattern: 'volatile', reason: 'volatile-short' };
    return { ...out, pct: Math.min(median30, long), pattern: 'volatile', reason: null };
  }
  return { ...out, pct: median7, pattern: jumpDays > 0 ? 'jump-removed' : 'smooth', reason: null };
}

/** Persian label of a pattern, for the screen and the estimate's assumptions. */
export const PATTERN_LABEL: Record<RatePattern, string> = {
  smooth: 'یکنواخت',
  'jump-removed': 'جهش حذف شد',
  stepwise: 'پله‌ای',
  volatile: 'پرنوسان',
};

/** One sentence: which window the rate came from. */
export function robustNote(r: RobustRate): string {
  const pct = (x: number | null) => (x === null ? '—' : formatPercent(x, 2));
  if (r.pct === null) {
    if (r.reason === 'stepwise-short') return 'نرخ پله‌ای به‌روز می‌شود و سابقه‌ی کافی (۶۰ روز) برای میانگین بلندمدت ندارد؛ برآورد نمی‌شود.';
    if (r.reason === 'volatile-short') return 'نرخ پرنوسان است و میانگین بلندمدت ندارد؛ برآورد نمی‌شود.';
    return 'سابقه‌ی روزانه‌ی کافی نیست.';
  }
  const young = r.young ? ` سابقه‌ی کوتاه (${formatNumber(r.days, 0)} روز).` : '';
  switch (r.pattern) {
    case 'stepwise':
      return `نرخ پله‌ای به‌روز می‌شود؛ با میانگین بلندمدت (${pct(r.long)}) حساب شد.${young}`;
    case 'volatile':
      return `نرخ پرنوسان است؛ با کمترینِ میانه‌ی ۳۰ روزه (${pct(r.median30)}) و میانگین بلندمدت (${pct(r.long)}) حساب شد.${young}`;
    case 'jump-removed':
      return `${formatNumber(r.jumpDays, 0)} روز جهش غیرعادی کنار گذاشته شد؛ با میانه‌ی ۷ روز اخیر (${pct(r.median7)}) حساب شد.${young}`;
    default:
      return `با میانه‌ی روزانه‌ی ۷ روز اخیر (${pct(r.median7)}) حساب شد.${young}`;
  }
}

/** History length asked of sources: the month for the rule, plus the long window. */
export const HISTORY_DAYS = 95;
export const LONG_DAYS = 90;

/**
 * From a source's dated rate points (any frequency, any order): one value per UTC day
 * (the day's last), oldest first, then the rule. `toPct` turns a source value into % a year.
 */
export function robustFromPoints(points: { t: number; v: number | null }[] | null | undefined, toPct: (v: number) => number = (v) => v * 100): RobustRate | null {
  if (!points?.length) return null;
  const byDay = new Map<number, { t: number; v: number }>();
  for (const p of points) {
    if (p.v === null || !Number.isFinite(p.v) || !Number.isFinite(p.t)) continue;
    const day = Math.floor(p.t / 86_400_000);
    const prev = byDay.get(day);
    if (!prev || p.t >= prev.t) byDay.set(day, { t: p.t, v: toPct(p.v) });
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x.v);
  if (!days.length) return null;
  const longWindow = days.slice(-LONG_DAYS);
  const long = longWindow.reduce((s, x) => s + x, 0) / longWindow.length;
  return robustRate(days, long, longWindow.length);
}
