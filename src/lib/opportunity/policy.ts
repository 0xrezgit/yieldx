/**
 * Versioned rules of the market analysis. Every estimate carries these versions so a
 * result can be traced to the model and the policy that produced it.
 */

/** Model of the numbers (formulas, cost lines). Bump on any change that moves a result. */
export const MODEL_VERSION = 'estimate-2026-09-30';
/** Ranking policy: eligibility, tie-breaks, the cap. */
export const RANKING_VERSION = 'rank-2026-09-30';

/** The only horizons the analysis compares, in days. */
export const HORIZONS = [30, 60, 90, 125] as const;
export type HorizonDays = (typeof HORIZONS)[number];
export const DEFAULT_HORIZON: HorizonDays = 30;
export const isHorizon = (d: unknown): d is HorizonDays => HORIZONS.includes(d as HorizonDays);

/** At most this many distinct opportunities per horizon, from all families together (no quota). */
export const TOP_LIMIT = 60;
/** Rows per page of the ranking; the rank is over the whole list, never per page. */
export const PAGE_SIZE = 20;

/**
 * A YT's base yield far above the market's implied rate (the market's own forecast of the
 * average until maturity) is almost always a temporary boost: more than this many points
 * above it and more than this multiple of it. Holding it constant would invent profit.
 */
export const TEMPORARY_BASE = { minGapPp: 5, minRatio: 2 } as const;
export const temporaryBase = (basePct: number | null, impliedPct: number) =>
  basePct !== null && basePct - impliedPct > TEMPORARY_BASE.minGapPp && basePct > TEMPORARY_BASE.minRatio * impliedPct;

/** Amounts asked of a router are rounded to two significant figures, so nearby capitals share one quote. */
export const quoteAmount = (usd: number) => {
  if (!(usd > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(usd)) - 1);
  return Math.round(usd / p) * p;
};

/** At most this many PT and this many YT markets are quoted per capital (the router's quota is small). */
export const MAX_QUOTES_PER_SIDE = 10;

/**
 * Leverage policy: the leverage that keeps health at `minHealth` (LLTV ÷ LTV, or HF),
 * capped at `maxLeverage`. Never the protocol maximum.
 */
export const LEVERAGE_POLICY = { version: 'lev-v1', minHealth: 1.25, maxLeverage: 4 } as const;

/**
 * PT loops: 3× the capital, or 2.5× where the loop is more fragile — a dollar peg known
 * only from the name, a thin spread between the PT's rate and the variable borrow rate
 * (each point the borrow rate rises costs L − 1 points), or a long maturity. Lower still
 * only where health 1.25 or surviving a `rateBufferPp` jump of the PT's implied rate
 * (its market price falls) requires. See `ptLoopLeverage`.
 */
export const PT_LOOP_POLICY = {
  version: 'lev-pt-v2',
  minHealth: 1.25,
  maxLeverage: 3,
  cautiousLeverage: 2.5,
  longDays: 90,
  minSpreadPp: 3,
  rateBufferPp: 10,
} as const;

/**
 * Without an executable quote, an AMM entry (PT) is only estimated while the amount
 * stays under this share of the pool's liquidity; price impact is then small but
 * still listed as not included.
 */
export const MAX_POOL_SHARE_WITHOUT_QUOTE = 0.005;

/** Rate data older than this (hours) is stale and leaves the active ranking. */
export const MAX_RATE_AGE_HOURS = 24;
