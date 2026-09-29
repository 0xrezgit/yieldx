/**
 * Persian (fa-IR) number, money and date formatting, plus the matching parser.
 *
 * Every formatter returns Persian digits and is for display only: never feed a
 * formatted string back into a calculation — keep the number, round on screen.
 * Render results inside <Num> (an LTR isolate) so signs and symbols stay in place.
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
/** Typographic minus: never mirrored or split from its number in RTL text. */
export const MINUS = '−';

/** Isolates the number (LRI…PDI) so a sign stays attached inside RTL text. */
const LRI = '⁦';
const PDI = '⁩';
export const DOLLAR = 'دلار';

/** True when `x` shows as zero with `digits` decimals. */
const roundsToZero = (x: number, digits: number) => Math.abs(x) < 0.5 * 10 ** -digits;

/** Sign for a value shown with `digits` decimals: none when it rounds to zero (no «−۰»). */
function signOf(x: number, digits: number, signed: boolean): string {
  if (roundsToZero(x, digits) || x === 0) return '';
  return x < 0 ? MINUS : signed ? '+' : '';
}

/** Magnitude with `digits` decimals, or — for a small non-zero value that would show as ۰ — `sig` significant digits. */
function magnitude(abs: number, digits: number, sig: number): string {
  if (abs !== 0 && roundsToZero(abs, digits)) {
    if (abs < 1e-12) return `<${nf({ maximumFractionDigits: 12 }).format(1e-12)}`;
    return nf({ maximumSignificantDigits: sig }).format(abs);
  }
  return nf({ maximumFractionDigits: digits }).format(abs);
}

/**
 * Plain number: 1234.5 → «۱٬۲۳۴٫۵», −0.0004 → «−۰٫۰۰۰۴» (never a misleading ۰ or «−۰»).
 * Small non-zero values keep 4 significant digits: 0.00003456 → «۰٫۰۰۰۰۳۴۵۶».
 */
export function formatNumber(x: number, digits = 2, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  const abs = Math.abs(x);
  const small = abs !== 0 && roundsToZero(abs, digits);
  const sign = x === 0 ? '' : small ? (x < 0 ? MINUS : signed ? '+' : '') : signOf(x, digits, signed);
  return `${sign}${magnitude(abs, digits, 4)}`;
}

/** Token amount with its official symbol (Latin, isolated): «۰٫۰۰۰۰۳۴۵۶ ETH». */
export function formatToken(x: number, symbol: string, digits = 6): string {
  if (!Number.isFinite(x)) return EMPTY;
  // Below 1, keep at least 4 significant digits (0.00003456 ETH, not 0.000035).
  const abs = Math.abs(x);
  const d = abs > 0 && abs < 1 ? Math.min(18, Math.max(digits, Math.ceil(-Math.log10(abs)) + 3)) : digits;
  return `${LRI}${formatNumber(x, d)}${PDI} ${LRI}${symbol}${PDI}`;
}

/** Full precision for details / tooltips (up to 12 decimals, no grouping loss). */
export function formatFull(x: number): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${x < 0 ? MINUS : ''}${nf({ maximumFractionDigits: 12 }).format(Math.abs(x))}`;
}

/**
 * 12.5M → «۱۲٫۵ میلیون». Only the numeric part is isolated (LRI…PDI); the scale word
 * stays in the RTL flow, so «۱۲٫۵ میلیون دلار» never turns into «میلیون ۱۲٫۵ دلار».
 */
function compactParts(abs: number, digits: number): string {
  const text = nf({ notation: 'compact', maximumFractionDigits: digits }).format(abs);
  const m = /^(\S+)\s(.+)$/.exec(text);
  return m ? `${m[1]}${PDI} ${m[2]}` : `${text}${PDI}`;
}

export function formatCompact(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return EMPTY;
  const sign = x < 0 && !roundsToZero(x, digits) ? MINUS : '';
  return `${LRI}${sign}${compactParts(Math.abs(x), digits)}`;
}

/**
 * Money in US dollars, written the Persian way: −1234.5 → «−۱٬۲۳۴٫۵ دلار» (never «$»).
 * Cent precision is the point of money display, so sub-cent amounts show as «۰ دلار».
 * «دلار» means USD only — stablecoins (USDC, USDT…) are tokens, shown with formatToken.
 */
export function formatUSD(x: number, digits = 2, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${LRI}${signOf(x, digits, signed)}${nf({ maximumFractionDigits: digits }).format(Math.abs(x))}${PDI} ${DOLLAR}`;
}

/** Money magnitude without the unit, cent-rounded, signed only when non-zero after rounding. */
export function formatMoneyNumber(x: number, digits = 2, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${signOf(x, digits, signed)}${nf({ maximumFractionDigits: digits }).format(Math.abs(x))}`;
}

export function formatUSDCompact(x: number, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${LRI}${signOf(x, 1, signed)}${compactParts(Math.abs(x), 1)} ${DOLLAR}`;
}

/** Percent value in percent units: 8.5 → «۸٫۵٪», signed 3.25 → «+۳٫۲۵٪». */
export function formatPercent(x: number, digits = 2, signed = false): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${signOf(x, digits, signed)}${nf({ maximumFractionDigits: digits }).format(Math.abs(x))}٪`;
}

/**
 * A trigger rate that can be astronomically high near maturity (e.g. the implied APY
 * that would liquidate a loop 14 days out). Above `cap` it reads «بیش از ۱٬۰۰۰٪».
 */
export function formatRateCapped(x: number, digits = 1, cap = 1000): string {
  if (x === Infinity) return 'دور از دسترس';
  if (!Number.isFinite(x)) return EMPTY;
  if (x > cap) return `بیش از ${formatPercent(cap, 0)}`;
  return formatPercent(x, digits);
}

/** Percentage points (for APY gaps): 2.1 → «+۲٫۱ واحد درصد». */
export function formatPP(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return EMPTY;
  return `${formatPercent(x, digits, true).replace('٪', '')} واحد درصد`;
}

export function formatMultiplier(x: number, digits = 2): string {
  return `${formatNumber(finite(x), digits)}×`;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/**
 * A date-only value (yyyy-mm-dd, or a timestamp at 00:00 UTC such as a maturity)
 * is formatted in UTC, so the displayed day never moves with the viewer's time zone.
 */
const isDateOnly = (iso: string, d: Date) => /^\d{4}-\d{2}-\d{2}$/.test(iso) || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);

const dtCache = new Map<string, Intl.DateTimeFormat>();
function df(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let f = dtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dtCache.set(key, f);
  }
  return f;
}

/** Solar Hijri (Jalali) date: «۲۱ مهر ۱۴۰۵». */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EMPTY;
  return df('fa-IR', { dateStyle: 'medium', ...(isDateOnly(iso, d) ? { timeZone: 'UTC' } : {}) }).format(d);
}

/** Gregorian date in Persian digits, for the detail / tooltip next to a Jalali date: «۱۳ اکتبر ۲۰۲۶». */
export function formatGregorian(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EMPTY;
  return df('fa-IR-u-ca-gregory', { dateStyle: 'medium', ...(isDateOnly(iso, d) ? { timeZone: 'UTC' } : {}) }).format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return EMPTY;
  return df('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** Clock time «۱۴:۰۵». */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY;
  return df('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** «۵ دقیقه پیش», «۳ ساعت پیش», «۲ روز پیش». */
export function formatAgo(ms: number, now = Date.now()): string {
  if (!Number.isFinite(ms)) return EMPTY;
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'لحظاتی پیش';
  if (s < 3600) return `${formatNumber(Math.floor(s / 60), 0)} دقیقه پیش`;
  if (s < 86_400) return `${formatNumber(Math.floor(s / 3600), 0)} ساعت پیش`;
  return `${formatNumber(Math.floor(s / 86_400), 0)} روز پیش`;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian/Arabic digits → Latin; direction marks and spaces removed; typographic minus → '-'. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[‎‏؜⁦-⁩‪-‮]/g, '')
    .replace(/[−–]/g, '-')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** Latin digits (and the decimal point) → Persian, 1:1 so a caret position stays valid. */
export const toPersianDigits = (s: string) => s.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]).replace(/\./g, '٫').replace(/-/g, MINUS);

/**
 * Normalises typed text to a plain `-123.45` string (or null when it is not a number).
 * Accepted: Persian, Arabic and Latin digits; decimal «٫», «.» or «/» between digits;
 * thousands «٬», «،» or spaces; a Latin «,» is a thousands separator when it groups
 * exactly three digits (1,234 · 1,234.5) and a decimal comma otherwise (12,5).
 */
function normalize(input: string): string | null {
  let s = toLatinDigits(input).replace(/[\s  ٬،']/g, '');
  s = s.replace(/(\d)\/(\d)/g, '$1.$2').replace(/٫/g, '.');
  if (s.includes(',')) {
    const grouped = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s);
    if (grouped || s.includes('.')) s = s.replace(/,/g, '');
    else if ((s.match(/,/g) ?? []).length === 1) s = s.replace(',', '.');
    else return null;
  }
  if (s.startsWith('+')) s = s.slice(1);
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? s : null;
}

/** Parses Persian/Arabic/Latin input. NaN for empty or invalid text. */
export function parseLocaleNumber(input: string): number {
  const s = normalize(input);
  return s === null ? NaN : Number(s);
}

/**
 * True for text that is not a number yet but may become one while typing
 * («−», «۰٫», «۱۲,»): the input keeps it instead of rejecting or reformatting it.
 */
export function isPartialNumber(input: string): boolean {
  const s = toLatinDigits(input).replace(/[\s  ٬']/g, '');
  return s === '' || /^[+-]$/.test(s) || /^[+-]?(\d+[.,٫/]?|[.,٫/])$/.test(s) || /^[+-]?\d{1,3}(,\d{3})*,\d{0,2}$/.test(s);
}

/** «۵٫۱، 6.2 ، ۷» → [5.1, 6.2, 7] — used by the APY history textarea. */
export function parseNumberList(input: string): number[] {
  return input
    .split(/[\s,،;|]+/)
    .map((s) => parseLocaleNumber(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** Search text: lower case, Arabic ي/ك/ى → Persian ی/ک, digits Latin, no ZWNJ/diacritics. Never used on ids. */
export function normalizeSearch(input: string): string {
  return toLatinDigits(input)
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[ً-ٰٟ‌‍]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
