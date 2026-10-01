import type { BaseHealth, BaseHealthStatus, ImpliedHealth } from '../../types/market';
import { formatDate, formatNumber, formatPercent } from '../utils/formatting';

export type { BaseHealth, BaseHealthStatus, ImpliedHealth };

/**
 * Is a market's published base yield (Pendle's Underlying APY) believable? A YT's
 * dollar result rests entirely on it, and live data showed it can be wrong: superWETH
 * read 27% while the vault grew about 1.8% a year on-chain. Four checks, all from the
 * protocol's own API:
 *
 *   range    — outside the yield range the protocol itself expects (`yieldRange`)
 *   jump     — a jump of several points from one day to the next, recently
 *   stale    — a reward-only figure unchanged for weeks (a configured rate, not measured)
 *   zero     — 0% without a points program (missing data rather than no yield)
 *
 * «suspect»: the estimate uses a conservative base (the lower of today's figure and the
 * last 30 days' median) and shows a range. «broken»: no dollar figure at all — only on
 * evidence: the chain delivered far less over both the last week and the last month, or
 * the figure is impossible. Guesses (range, jumps, stale figures) stop at «suspect»,
 * because a base yield rises and falls with its market for real.
 * A 0% base on a points market is normal: its YT pays in points, never in dollars.
 */

export interface BaseHistoryPoint {
  /** Day, ISO. */
  t: string;
  /** Base yield that day, %. */
  basePct: number;
  /** Implied APY that day, %; absent when not fetched. */
  impliedPct?: number;
}

export const HEALTH_RULES = {
  /** A day-to-day move at least this large in the last `jumpDays` days, points; a level held longer is accepted. */
  jumpPp: 5,
  jumpDays: 7,
  /** A published base above this, % a year, is impossible. */
  impossiblePct: 200,
  /** Above the protocol's range by this many points makes it suspect… */
  aboveRangePp: 1,
  /** A reward-only figure unchanged this many days is a configured rate. */
  staleDays: 14,
  medianDays: 30,
  /** Published more than this many points above the 30-day realized yield (and twice it): broken… */
  realizedGapPp: 5,
  /** …more than this many points above it: suspect, ranked on the realized yield. */
  realizedSuspectPp: 2,
} as const;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function assessBase(p: {
  basePct: number | null;
  interestPct?: number | null;
  rewardPct?: number | null;
  /** The yield range the protocol expects, %. */
  range?: { min: number; max: number } | null;
  /** Daily base yield, oldest first; null when the protocol gives no history. */
  history?: BaseHistoryPoint[] | null;
  categories: string[];
  /** Base yield realized on-chain (7 days without a one-step jump, and 30 days), %; overrides the heuristics. */
  realized?: { d7: number | null; d30: number | null; lumpy?: boolean } | null;
}): BaseHealth {
  const R = HEALTH_RULES;
  const reasons: string[] = [];
  let status: BaseHealthStatus = 'ok';
  const worse = (s: BaseHealthStatus) => {
    if (s === 'broken' || (s === 'suspect' && status === 'ok')) status = s;
  };
  const base = p.basePct;
  const points = p.categories.includes('points');
  if (base === null || !Number.isFinite(base)) return { status: 'ok', reasons, conservativePct: null, pointsOnly: false };
  if (base === 0) {
    if (points) return { status: 'ok', reasons, conservativePct: 0, pointsOnly: true };
    return { status: 'suspect', reasons: ['بازده پایه صفر گزارش شده و بازار پوینتی هم نیست؛ احتمالاً داده گم شده است.'], conservativePct: 0, pointsOnly: false };
  }

  if (base > R.impossiblePct) return { status: 'broken', reasons: [`بازده پایه‌ی ${formatPercent(base, 0)} ممکن نیست.`], conservativePct: null, pointsOnly: false };

  // Measured on-chain: the delivered yield is the evidence, ahead of every guess below.
  const real = p.realized;
  if (real && (real.d7 != null || real.d30 != null)) {
    const d7 = real.d7 ?? null;
    const d30 = real.d30 ?? null;
    const realizedPct = d30 ?? d7;
    // A steady (not one-step) week that delivers the published figure: a real rise, even if the month lags.
    if (d7 !== null && !real.lumpy && d7 >= base - R.realizedSuspectPp) return { status: 'ok', reasons: [], conservativePct: base, pointsOnly: false, realizedPct };
    const best = Math.max(...[d7, d30].filter((x): x is number => x !== null));
    const both = d7 !== null && d30 !== null;
    const msg = `بازده واقعی روی زنجیره ${formatPercent(best, 2)} است، نه ${formatPercent(base, 1)}${real.lumpy ? ' (رشد هفته یک‌جا آمده، نه پیوسته)' : ''}.`;
    if (both && base > 2 * Math.max(best, 0.5) && base - best > R.realizedGapPp) return { status: 'broken', reasons: [msg], conservativePct: best, pointsOnly: false, realizedPct };
    if (base - best > R.realizedSuspectPp) return { status: 'suspect', reasons: [msg], conservativePct: best, pointsOnly: false, realizedPct };
    return { status: 'ok', reasons: [], conservativePct: base, pointsOnly: false, realizedPct };
  }

  const above = p.range ? base - p.range.max : -Infinity;
  if (p.range && above > R.aboveRangePp) {
    worse('suspect');
    reasons.push(`بازده پایه‌ی ${formatPercent(base, 1)} بیرون از بازه‌ی مورد انتظار خود پروتکل (${formatPercent(p.range.min, 1)} تا ${formatPercent(p.range.max, 1)}) است.`);
  }

  const h = (p.history ?? []).filter((x) => Number.isFinite(x.basePct));
  if (h.length > 1) {
    const recent = h.slice(-(R.jumpDays + 1));
    let jump = 0;
    let at = '';
    for (let i = 1; i < recent.length; i++) {
      const d = Math.abs(recent[i].basePct - recent[i - 1].basePct);
      if (d > jump) {
        jump = d;
        at = recent[i].t;
      }
    }
    if (jump >= R.jumpPp) {
      worse('suspect');
      reasons.push(`بازده پایه در ${formatDate(at)} ناگهان ${formatNumber(jump, 1)} واحد درصد جابه‌جا شد.`);
    }
    let same = 0;
    for (let i = h.length - 1; i > 0 && Math.abs(h[i].basePct - h[i - 1].basePct) < 1e-9; i--) same++;
    if (same >= R.staleDays && (p.interestPct ?? 0) === 0 && (p.rewardPct ?? 0) > 0) {
      worse('suspect');
      reasons.push(`بازده پایه ${formatNumber(same, 0)} روز بدون تغییر مانده و فقط نرخ پاداش اعلامی است، نه بازده اندازه‌گیری‌شده.`);
    }
  }

  const med = median(h.slice(-R.medianDays).map((x) => x.basePct));
  const conservativePct = status === 'ok' ? base : Math.min(base, ...(med !== null ? [med] : []), ...(p.range ? [p.range.max] : []));
  return { status, reasons, conservativePct, pointsOnly: false };
}

export const IMPLIED_RULES = {
  /** Implied APY recomputed from the PT price may differ from the published one by this many points. */
  maxGapPp: 1,
  /** Above this, % a year, the pool is broken or empty rather than priced. */
  maxPlausiblePct: 200,
  /** Unchanged this many days: nobody traded, the price is old. */
  staleDays: 14,
  /** A move this large within the last `jumpDays` days. */
  jumpPp: 5,
  jumpDays: 3,
} as const;

/**
 * Is the market's implied APY believable? It is not an independent number: it follows
 * from the PT price and the days left, so it is recomputed from the PT price and compared;
 * an impossible value, weeks without a change (no trades) or a sudden jump are flagged.
 * Where it is doubtful, a mid-rate estimate is not trusted: an executable quote decides.
 */
export function assessImplied(p: { impliedPct: number; ptPrice: number | null; days: number; history?: BaseHistoryPoint[] | null }): ImpliedHealth {
  const R = IMPLIED_RULES;
  const reasons: string[] = [];
  let status: BaseHealthStatus = 'ok';
  const worse = (s: BaseHealthStatus) => {
    if (s === 'broken' || (s === 'suspect' && status === 'ok')) status = s;
  };
  if (!Number.isFinite(p.impliedPct) || p.impliedPct < 0 || p.impliedPct > R.maxPlausiblePct) {
    return { status: 'broken', reasons: [`نرخ بازار (${formatPercent(p.impliedPct, 1)}) غیرعادی است؛ استخر خالی یا قیمت‌گذاری‌نشده است.`] };
  }
  if (p.ptPrice !== null && p.ptPrice > 0 && p.ptPrice < 1 && p.days > 0) {
    const fromPrice = (Math.pow(1 / p.ptPrice, 365 / p.days) - 1) * 100;
    const gap = Math.abs(fromPrice - p.impliedPct);
    if (gap > R.maxGapPp) {
      worse('suspect');
      reasons.push(`نرخ اعلامی (${formatPercent(p.impliedPct, 2)}) با نرخی که از قیمت PT درمی‌آید (${formatPercent(fromPrice, 2)}) هم‌خوان نیست.`);
    }
  }
  const h = (p.history ?? []).filter((x) => typeof x.impliedPct === 'number' && Number.isFinite(x.impliedPct));
  if (h.length > 1) {
    let same = 0;
    for (let i = h.length - 1; i > 0 && Math.abs((h[i].impliedPct as number) - (h[i - 1].impliedPct as number)) < 1e-6; i--) same++;
    if (same >= R.staleDays) {
      worse('suspect');
      reasons.push(`نرخ بازار ${formatNumber(same, 0)} روز تغییر نکرده؛ معامله‌ای نشده و قیمت قدیمی است.`);
    }
    const recent = h.slice(-(R.jumpDays + 1));
    let jump = 0;
    for (let i = 1; i < recent.length; i++) jump = Math.max(jump, Math.abs((recent[i].impliedPct as number) - (recent[i - 1].impliedPct as number)));
    if (jump >= R.jumpPp) {
      worse('suspect');
      reasons.push(`نرخ بازار در چند روز اخیر ${formatNumber(jump, 1)} واحد درصد جهش کرده است.`);
    }
  }
  return { status, reasons };
}
