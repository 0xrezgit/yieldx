import type { MultiplyPairInput } from './model';

/** One Kamino Multiply pair with a volatile collateral and a dollar debt (served by /api/multiply). */
export interface MultiplyRow extends MultiplyPairInput {
  key: string;
  market: { address: string; name: string };
  collateral: { symbol: string; mint: string; priceUsd: number; icon: string | null };
  debt: { symbol: string; mint: string; priceUsd: number; icon: string | null };
  /** Elevation group the pair auto-selects (0: the reserves' own limits). */
  elevationGroup: number;
  /** Today's borrow rate and its 7-day average, % (the model uses the higher). */
  borrowNowPct: number;
  borrow7dPct: number | null;
  /** The collateral's own yield (staking, fees) and its supply APY in the market, %. */
  ownYieldPct: number;
  supplyPct: number;
  /** What can be borrowed now, USD. */
  availableUsd: number | null;
  /** Collateral deposited in the reserve, USD. */
  depositUsd: number | null;
  /** Days of price history behind `volPct`. */
  volDays: number;
  /** Price-ratio history (collateral ÷ debt), daily, oldest first: for the chart. */
  history: number[];
  url: string;
}

export interface MultiplyFeed {
  rows: MultiplyRow[];
  /** Pairs left out and why, by reason. */
  skipped: Record<string, number>;
  fetchedAt: string;
  error: string | null;
}
