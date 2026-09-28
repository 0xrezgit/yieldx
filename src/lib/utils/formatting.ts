/**
 * Persian (fa-IR) number formatting. Every formatter returns Persian digits;
 * render the result inside <Num> (dir="ltr") so signs and symbols stay in place.
 */
import { finite } from './math';

const cache = new Map<string, Intl.NumberFormat>();
function nf(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('fa-IR', options);
    cache.set(key, f);
  }
  return f;
}

export const EMPTY = '—';

export function formatNumber(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return EMPTY;
  return nf({ maximumFractionDigits: digits }).format(x);
}

/** 12.5M → «۱۲٫۵ میلیون» */
export function formatCompact(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return EMPTY;
  return nf({ notation: 'compact', maximumFractionDigits: digits }).format(x);
}

/** Isolates the number (LRI…PDI) so a sign stays attached inside RTL text. */
const LRI = '\u2066';
const PDI = '\u2069';
export const DOLLAR = 'دلار';

/** Sign for a value that is shown with `digits` decimals: none when it rounds to zero. */
function signOf(x: number, digits: number, signed: boolean): string {
  const zero = Math.abs(x) < 0.5 * 10 ** -digits;
  return zero ? '' : x < 0 ? '−' : signed ? '+' : '';
}

/**
 * Money in dollars, written the Persian way: −1234.5 → «−۱٬۲۳۴٫۵ دلار» (never «$»).
 * Inside <Num> the unit is split off automatically so it sits after the number in RTL.
 */
export function formatUSD(x: number, digits = 2, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${LRI}${signOf(x, digits, signed)}${nf({ maximumFractionDigits: digits }).format(Math.abs(x))}${PDI} ${DOLLAR}`;
}

export function formatUSDCompact(x: number, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${LRI}${signOf(x, 1, signed)}${formatCompact(Math.abs(x))}${PDI} ${DOLLAR}`;
}

/** Percent value in percent units: 8.5 → «۸٫۵٪». */
export function formatPercent(x: number, digits = 2, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  const sign = x < 0 ? '−' : signed && x > 0 ? '+' : '';
  return `${sign}${nf({ maximumFractionDigits: digits }).format(Math.abs(x))}٪`;
}

/** Percentage points (for APY gaps): 2.1 → «+۲٫۱ واحد درصد». */
export function formatPP(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${formatPercent(x, digits, true).replace('٪', '')} واحد درصد`;
}

export function formatMultiplier(x: number, digits = 2): string {
  return `${formatNumber(finite(x), digits)}×`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EMPTY;
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EMPTY;
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Accept Persian/Arabic digits and separators typed into inputs. */
export function parseLocaleNumber(input: string): number {
  const normalized = input
    // Invisible direction marks from formatted numbers, and the typographic minus.
    .replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, '')
    .replace(/−/g, '-')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[٬,\s]/g, '')
    .replace(/[٫]/g, '.');
  return normalized === '' ? NaN : Number(normalized);
}

/** «۵٫۱، 6.2 ، ۷» → [5.1, 6.2, 7] — used by the APY history textarea. */
export function parseNumberList(input: string): number[] {
  return input
    .split(/[\s,،;|]+/)
    .map((s) => parseLocaleNumber(s.trim()))
    .filter((n) => Number.isFinite(n));
}
