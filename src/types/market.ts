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

export interface MarketData {
  protocol: string;
  marketId: string;
  name: string;
  /** USD price of one accounting-asset unit; null when the protocol API doesn't provide it. */
  underlyingPrice: number | null;
  /** Symbol of the accounting asset PT redeems into, when the API reports it. */
  assetSymbol?: string | null;
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
export interface MarketSummary {
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
}

/** A list row as served by GET /api/:protocol — lifecycle computed from the maturity date. */
export interface MarketListing extends MarketSummary {
  expired: boolean;
  daysToMaturity: number;
}
