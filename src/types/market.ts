/**
 * Market data as returned by protocol adapters.
 *
 * Units used across YieldX:
 * - PT / YT prices are quoted in units of the accounting asset (PT → 1 at maturity, YT → 0).
 * - Every APY is a percentage (8 means 8%).
 * - USD values are plain dollars.
 */
/** Whether a points program exists: known from the API, known absent, or not reported. */
export type PointsStatus = 'active' | 'none' | 'unknown';

/** What one "pointsPerDay" is earned on: one unit of the asset, or one US dollar. */
export type PointsBasis = 'unit' | 'usd';

export interface MarketPointsProgram {
  name: string;
  pointsPerDay: number;
  basis: PointsBasis;
  ytMultiplier: number;
  lpMultiplier: number;
  season: number | null;
}

/** The token a market is built on, identified by network + address/mint (never by symbol alone). */
export interface TokenRef {
  symbol: string | null;
  /** EVM contract address or Solana mint, exactly as the API gives it; null when unknown. */
  address: string | null;
}

/** Identity and provenance fields shared by list rows and market data (all optional: older data lacks them). */
export interface MarketIdentityFields {
  /** Underlying token (what the icon shows). */
  asset?: TokenRef | null;
  /** Symbol of the unit PT redeems into / prices are quoted in. */
  accountingSymbol?: string | null;
  /** When the protocol itself last updated these numbers (not when we fetched them). */
  sourceUpdatedAt?: string | null;
  /** The PT token (address on the market's network), when the API names it. */
  ptToken?: TokenRef | null;
  /** Pendle's AMM fee, in log-rate per year (extendedInfo.feeRate): buying PT pays ln(1+implied) minus it. */
  ammFeeLn?: number | null;
  /**
   * What one PT redeems for at maturity, as a share of one unit: the SY's exchange rate over the
   * YT's PY index when the rate fell below it (on-chain), else 1. Null when not read.
   */
  ptRedeemFactor?: number | null;
}

export interface MarketData extends MarketIdentityFields {
  protocol: string;
  marketId: string;
  name: string;
  /** USD price of one accounting-asset unit; null when the protocol API doesn't provide it. */
  underlyingPrice: number | null;
  /** Symbol of the accounting asset PT redeems into, when the API reports it. */
  assetSymbol?: string | null;
  /** What one YT pays the yield of: one asset unit (default) or $1 (Exponent markets quoted in USD). */
  ytUnit?: 'asset' | 'usd';
  ptPrice: number;
  ytPrice: number;
  impliedAPY: number;
  baseAPY: number;
  /** ISO date of maturity. */
  maturity: string;
  daysToMaturity: number;
  liquidity: number | null;
  /** Total market size in asset units (Exponent), for sizing checks when USD liquidity is unknown. */
  marketSizeUnits: number | null;
  volume24h: number | null;
  pointsStatus: PointsStatus;
  /** Full program details, when the API reports them. */
  points: MarketPointsProgram | null;
  /** Project behind the underlying (e.g. "Hylo", "Superform"). */
  platform: string | null;
  /** Token logo URL, when known. */
  icon: string | null;
  /** Network name, e.g. "Solana", "Ethereum", "Arbitrum". */
  chain: string;
  fetchedAt: string;
}

/** One row of a protocol's market list — everything the market picker shows. */
export interface MarketSummary extends MarketIdentityFields {
  id: string;
  name: string;
  /** Project behind the underlying. */
  platform: string | null;
  icon: string | null;
  chain: string;
  maturity: string;
  impliedAPY: number;
  baseAPY: number | null;
  /** USD liquidity / market size, when known. */
  liquidity: number | null;
  hasPoints: boolean;
  /** YT points multiplier, when the protocol publishes it. */
  ytMultiplier: number | null;
  /** Full points program, when the protocol publishes it (Exponent). */
  points: MarketPointsProgram | null;
  /** Lower-case tags such as "stables", "eth", "sol", "rwa". */
  categories: string[];
  /** Listed recently. */
  isNew: boolean;
  /** Is the published base yield believable (see lib/opportunity/health)? Absent when not checked. */
  baseHealth?: BaseHealth | null;
  /** The base yield's own recent levels, for the scenarios (lib/opportunity/base-scenarios). */
  baseLevels?: BaseLevels | null;
  /** USD price of one unit of the market's asset, when the list gives it (unit-based points). */
  unitUsd?: number | null;
  /** The market's own pages for buying its PT and YT, when the adapter can build them (verified formats). */
  links?: { pt?: string | null; yt?: string | null } | null;
  /** Is the market's implied APY believable (consistent with the PT price, recently traded)? */
  impliedHealth?: ImpliedHealth | null;
}

export type BaseHealthStatus = 'ok' | 'suspect' | 'broken';

/** Mean base yield over the last 7, 30 and 90 days, %; null where not known. */
export interface BaseLevels {
  d7: number | null;
  d30: number | null;
  d90: number | null;
}

export interface BaseHealth {
  status: BaseHealthStatus;
  /** Why, in Persian; empty when ok. */
  reasons: string[];
  /** The base yield to rank a suspect market on, %; null when nothing better is known. */
  conservativePct: number | null;
  /** 0% base on a points market: the YT pays only in points. */
  pointsOnly: boolean;
  /** The base yield measured on-chain over the last 30 days (else the week), %; null when not measurable. */
  realizedPct?: number | null;
  /**
   * The base to rank on when it differs from the published one, %: the on-chain yield of a
   * suspect market, or of a points market published at 0 whose SY grows. Absent → published
   * (or `conservativePct` for a suspect market).
   */
  rankPct?: number | null;
}

export interface ImpliedHealth {
  status: BaseHealthStatus;
  reasons: string[];
}

/** A list row as served by GET /api/:protocol — lifecycle computed from the maturity date. */
export interface MarketListing extends MarketSummary {
  expired: boolean;
  daysToMaturity: number;
}
