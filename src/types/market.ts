/**
 * Market data as returned by protocol adapters.
 *
 * Units used across YieldX:
 * - PT / YT prices are quoted in units of the accounting asset (PT → 1 at maturity, YT → 0).
 * - Every APY is a percentage (8 means 8%).
 * - USD values are plain dollars.
 */
export interface MarketPointsProgram {
  name: string;
  /** Points per day for one unit of underlying exposure. */
  pointsPerDay: number;
  ytMultiplier: number;
  lpMultiplier: number;
}

export interface MarketData {
  protocol: string;
  marketId: string;
  name: string;
  /** USD price of one accounting-asset unit; null when the protocol API doesn't provide it. */
  underlyingPrice: number | null;
  ptPrice: number;
  ytPrice: number;
  impliedAPY: number;
  baseAPY: number;
  /** ISO date of maturity. */
  maturity: string;
  daysToMaturity: number;
  liquidity: number | null;
  volume24h: number | null;
  points: MarketPointsProgram | null;
  fetchedAt: string;
}

export interface MarketSummary {
  id: string;
  name: string;
  maturity: string;
  impliedAPY: number;
  baseAPY: number | null;
  liquidity: number | null;
  hasPoints: boolean;
}
