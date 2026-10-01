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

/**
 * Fiat stablecoins other than the dollar (pesos, euros, lira…): their interest is earned in
 * that currency, and its exchange rate against the dollar moves — high-yield currencies lose
 * value roughly in line with their rate. Holding the rate constant would turn a peso return
 * into a fake dollar profit, so such deposits get no dollar figure.
 */
const FIAT_ISO = /^(ARS|BRL|BRZ|MXN|TRY|EUR|GBP|JPY|CHF|ZAR|AUD|CAD|COP|CLP|PEN|BOB|NGN|KRW|IDR|PHP|SGD|HKD|CNH|CNY|INR|UYU)[A-Za-z0-9]{0,2}$/;
/** Tokenised Latin-American currencies published as «COLt», «PERt» …: matched whole, so BOLD or PENDLE never are. */
const FIAT_LATAM_T = /^(ARG|BRA|BOL|CHL|COL|MEX|PER)t$/;
export function nonUsdFiat(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const latam = FIAT_LATAM_T.exec(symbol);
  if (latam) return latam[1];
  // A wrapper or staking prefix (wARS, stEUR, tGBP) is dropped before the code is read.
  const m = FIAT_ISO.exec(symbol.replace(/^(w|s|st|t|x|c)(?=[A-Z]{3})/, ''));
  return m ? m[1] : null;
}

/**
 * Deposits whose dollar value is steady enough to rank in dollars at a constant price:
 * dollars (any symbol carrying USD, and the named dollar stables), ETH and BTC in all their
 * wrapped and staked forms, the majors, gold, and established DeFi tokens (PENDLE among
 * them). Anything else — a small governance token, a memecoin, a locked ve-token — is a
 * price bet: its dollar result is not estimated. Matching drops wrapper/staking prefixes.
 */
const STEADY = /(USD|ETH|BTC)/i;
const DOLLARS = new Set(['DAI', 'GHO', 'BOLD', 'LUSD', 'DOLA', 'FRAX', 'MIM', 'RLUSD', 'PYUSD', 'FDUSD', 'TUSD', 'USDS', 'AUSD']);
const MAJORS = new Set(['SOL', 'BNB', 'AVAX', 'HYPE', 'MON', 'POL', 'MATIC', 'SUI', 'XRP', 'FXRP', 'TRX', 'TON', 'ADA', 'DOT', 'NEAR', 'APT', 'SEI', 'S', 'XPL', 'BERA', 'MNT', 'ARB', 'OP', 'XAUT', 'PAXG', 'XAU']);
const DEFI = new Set([
  'PENDLE', 'AAVE', 'UNI', 'CRV', 'CVX', 'LDO', 'MKR', 'SKY', 'COMP', 'MORPHO', 'ENA', 'ETHFI', 'EIGEN', 'GMX', 'AERO', 'VELO', 'JUP', 'RAY', 'ORCA', 'KMNO',
  'FLUID', 'INST', 'BAL', 'SNX', 'LQTY', 'FXS', 'FXN', 'SYRUP', 'RSR', 'ONDO', 'YFI', 'SUSHI', '1INCH', 'DYDX', 'RPL', 'SSV', 'SPK', 'ZRO', 'LINK', 'EUL', 'SILO', 'KNC', 'CAKE', 'JTO', 'DRIFT', 'PYTH', 'W',
]);
export function volatileDeposit(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  if (/^ve[A-Z]/.test(symbol)) return true;
  if (STEADY.test(symbol)) return false;
  const upper = symbol.toUpperCase();
  // Liquid-staking forms of a major end in its ticker: fragSOL, stHYPE, sAVAX, slisBNB, shMON.
  if (/(SOL|HYPE|AVAX|BNB|MON|SUI|XRP|POL)$/.test(upper) && upper.length > 3) return false;
  const core = upper.replace(/^(STK|W|ST|S|X|K|M|B|JITO|JUP|LST|V|A)(?=[A-Z0-9]{2,})/, '');
  const names = [upper, core, core.replace(/(\.E|X)$/, '')];
  return !names.some((n) => DOLLARS.has(n) || MAJORS.has(n) || DEFI.has(n));
}

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
