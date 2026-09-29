import { formatMoneyNumber, formatUSD, formatUSDCompact } from '../utils/formatting';

/**
 * Money in the positions section: Persian digits and the word «دلار» instead of «$».
 * String forms wrap the number in LRI…PDI so a minus sign stays attached inside
 * RTL sentences.
 */
/** Signed amount without the unit: −۴٫۰۶ (no sign on amounts that round to zero). */
export const dollarNumber = (x: number, digits = 2): string => formatMoneyNumber(x, digits);

/** «۴٫۰۶ دلار», «−۴٫۰۶ دلار» — for text; components use <Usd>. */
export const formatDollar = (x: number, digits = 2): string => formatUSD(x, digits);

export const formatDollarCompact = (x: number): string => formatUSDCompact(x);

/** Digits for small prices: enough significant figures for 0.0307 or 83 775. */
export const priceDigits = (x: number) => (Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 4 : 6);

export { toPersianDigits as toFaDigits } from '../utils/formatting';
