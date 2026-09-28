import { EMPTY, formatNumber, formatUSD, formatUSDCompact } from '../utils/formatting';

/**
 * Money in the positions section: Persian digits and the word «دلار» instead of «$».
 * String forms wrap the number in LRI…PDI so a minus sign stays attached inside
 * RTL sentences.
 */
/** Signed amount without the unit: −۴٫۰۶ */
export function dollarNumber(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return EMPTY;
  // No sign on amounts that round to zero («۰ دلار», not «−۰ دلار»).
  const negative = x < 0 && Math.abs(x) >= 0.5 * 10 ** -digits;
  return `${negative ? '−' : ''}${formatNumber(Math.abs(x), digits)}`;
}

/** «۴٫۰۶ دلار», «−۴٫۰۶ دلار» — for text; components use <Usd>. */
export const formatDollar = (x: number, digits = 2): string => formatUSD(x, digits);

export const formatDollarCompact = (x: number): string => formatUSDCompact(x);

/** Digits for small prices: enough significant figures for 0.0307 or 83 775. */
export const priceDigits = (x: number) => (Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 4 : 6);

const FA = '۰۱۲۳۴۵۶۷۸۹';
/** Latin digits (and the decimal point) → Persian, for text the browser typed. */
export const toFaDigits = (s: string) => s.replace(/[0-9]/g, (d) => FA[Number(d)]).replace(/\./g, '٫');
