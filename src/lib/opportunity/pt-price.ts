import type { ExecQuote } from '../../types/opportunity';

/**
 * What a PT or YT buy really pays, beside the published mid rate. Checked against live
 * Pendle quotes (2026-10-10): the mid rate overstated a $1,000 PT buy by 19–37 % in some
 * markets (USD3, sUSDD), one market's quote implied 993 % against 15 % published
 * (inconsistent price data), and four markets' SY had fallen under the PY index
 * (jrRoyAPYUSD: a PT redeems for 15 % less).
 */

/**
 * The rate a buy pays after Pendle's AMM fee, % a year. The fee is a log-rate per year
 * (`extendedInfo.feeRate`): buying PT pays ln(1 + implied) − fee, buying YT (selling PT
 * against it) ln(1 + implied) + fee.
 */
export function afterAmmFee(impliedPct: number, feeLn: number | null | undefined, side: 'pt' | 'yt'): number {
  if (!feeLn || !(feeLn > 0) || !(impliedPct > -100)) return impliedPct;
  const ln = Math.log(1 + impliedPct / 100) + (side === 'pt' ? -feeLn : feeLn);
  return (Math.exp(ln) - 1) * 100;
}

/** The PT rate (% a year) an executable quote pays: PT bought at its price, or the PT behind a YT's price. */
export function quoteImpliedPct(q: Pick<ExecQuote, 'side' | 'usd' | 'units' | 'unitUsd'>, days: number): number | null {
  if (!(q.units > 0 && q.unitUsd > 0 && q.usd > 0 && days > 0)) return null;
  const price = q.usd / q.units / q.unitUsd; // in units of what one PT redeems for
  const pt = q.side === 'pt' ? price : 1 - price;
  if (!(pt > 0)) return null;
  return (Math.pow(1 / pt, 365 / days) - 1) * 100;
}

/**
 * A quote far from the market's own rate is not a price but a data error (an asset's
 * dollar price that does not match the PT's): more than `maxGapPp` points and more than
 * `maxGapShare` of the rate apart, or beyond `maxPct`.
 */
export const QUOTE_SANITY = { maxGapPp: 5, maxGapShare: 0.5, maxPct: 200 } as const;

export function quoteCheck(q: Pick<ExecQuote, 'side' | 'usd' | 'units' | 'unitUsd'>, impliedPct: number, days: number): { ok: boolean; quotePct: number | null } {
  const quotePct = quoteImpliedPct(q, days);
  if (quotePct === null || !Number.isFinite(quotePct) || quotePct > QUOTE_SANITY.maxPct) return { ok: false, quotePct };
  return { ok: Math.abs(quotePct - impliedPct) <= Math.max(QUOTE_SANITY.maxGapPp, QUOTE_SANITY.maxGapShare * Math.abs(impliedPct)), quotePct };
}

/** A redemption factor worth stating: the PT pays back less than this share of one unit. */
export const REDEEM_IMPAIRED = 0.999;

/** Growth over the period when each unit redeems for `factor` of itself: (1 + g) × factor − 1. */
export const afterRedeem = (growth: number, factor: number | null | undefined) => (factor != null && factor < REDEEM_IMPAIRED ? (1 + growth) * factor - 1 : growth);
