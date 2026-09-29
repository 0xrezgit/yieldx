import thresholds from '../../config/thresholds.json';

/**
 * Implied APY from a PT price (in accounting-asset units).
 * PT redeems 1:1 at maturity, so  PT = (1 + r)^(-t)  ⇒  r = (1/PT)^(365/days) − 1.
 */
export function impliedAPYFromPT(ptPrice: number, daysToMaturity: number): number {
  if (!(ptPrice > 0 && ptPrice < 1) || !(daysToMaturity > 0)) return NaN;
  return (Math.pow(1 / ptPrice, 365 / daysToMaturity) - 1) * 100;
}

/** YT = 1 − PT (accounting-asset units), so implied APY follows from the PT side. */
export function impliedAPYFromYT(ytPrice: number, daysToMaturity: number): number {
  return impliedAPYFromPT(1 - ytPrice, daysToMaturity);
}

/** Inverse of impliedAPYFromPT — the PT price at which the market implies `apy`. */
export function ptPriceFromAPY(apy: number, daysToMaturity: number): number {
  return Math.pow(1 + apy / 100, -daysToMaturity / 365);
}

/** 'unknown' when the base APY is missing — never treated as «cheap». */
export type GapStatus = 'safe' | 'warning' | 'danger' | 'unknown';

export interface ImpliedMetrics {
  impliedAPY: number;
  /** Implied − base, in percentage points. */
  gap: number;
  /** Gap relative to base APY, in %. */
  gapPercent: number;
  status: GapStatus;
  interpretation: string;
}

/**
 * Compares the yield the market charges YT buyers (implied APY) with the yield the
 * underlying currently pays (base APY). A positive gap is the "burn" a YT buyer
 * accepts in exchange for points; for PT buyers the same gap is a benefit.
 */
export function calculateImpliedMetrics(ptPrice: number, daysToMaturity: number, baseAPY: number): ImpliedMetrics {
  const impliedAPY = impliedAPYFromPT(ptPrice, daysToMaturity);
  const gap = impliedAPY - baseAPY;
  const gapPercent = baseAPY > 0 ? (gap / baseAPY) * 100 : gap > 0 ? Infinity : 0;

  let status: GapStatus;
  if (!Number.isFinite(gap)) status = 'unknown';
  else if (!(gap > 0)) status = 'safe';
  else if (gapPercent < thresholds.gap.warningPercent) status = 'warning';
  else status = 'danger';

  return { impliedAPY, gap, gapPercent, status, interpretation: interpretGap(gap, gapPercent) };
}

export function interpretGap(gap: number, gapPercent: number): string {
  if (!Number.isFinite(gap)) return 'داده‌ی ورودی نامعتبر است';
  if (gap <= 0) return 'قیمت منصفانه یا سودآور برای خریدار YT';
  if (gapPercent < thresholds.gap.warningPercent) return 'سوخت جزئی — قابل قبول برای پوینت';
  if (gapPercent < thresholds.gap.dangerPercent) return 'سوخت متوسط — نیاز به ارزش‌گذاری پوینت';
  return 'سوخت بالا — فقط در صورت اطمینان از ایردراپ';
}
