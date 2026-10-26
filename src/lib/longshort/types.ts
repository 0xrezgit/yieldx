/** One PendleLoop Long/Short market (served by /api/longshort). Rates and prices as Pendle reads them. */
export interface LongShortRow {
  key: string;
  boxId: string;
  chainId: number;
  /** Money market the position lives in (Aave, Morpho). */
  protocol: string;
  /** The money market's logo as PendleLoop lists it. */
  protocolIcon: string | null;
  side: 'long' | 'short';
  category: 'crypto' | 'stocks';
  /** The asset the price view is on (WETH, WBTC, TSLAc…). */
  base: { symbol: string; address: string };
  collateral: { symbol: string; address: string };
  debt: { symbol: string; address: string };
  priceUsd: number;
  change24hPct: number | null;
  /** Liquidation LTV, 0…1. */
  lltv: number;
  /** Highest leverage PendleLoop offers, in its own sense (exposure ÷ equity). */
  maxLeverage: number;
  /** Borrow rate today and its 7-day average, % (the model uses the higher). */
  borrowNowPct: number;
  borrow7dPct: number | null;
  /** What the collateral earns: its own yield plus its supply rate in the market, %. */
  collateralYieldPct: number;
  /** What can be borrowed now, USD. */
  liquidityUsd: number | null;
  utilization: number | null;
  optimalUtilization: number | null;
  /** PendleLoop's own fee on the position (0 for Long/Short until Dec 31). */
  feeRate: number;
  risk: LongShortRisk | null;
  /** Stock tokens: when the oracle price updates (unix seconds); empty for crypto (24/7). */
  marketHours: { open: number; close: number }[];
  url: string;
  marketUrl: string | null;
  /** The same view as a perpetual on Hyperliquid, for comparison. */
  perp: PerpRef | null;
}

export interface LongShortRisk {
  /** Pendle's overall rating of the oracle setup. */
  level: string;
  label: string;
  /** One-line summary of how the oracle prices both sides. */
  summary: string | null;
  items: { name: string; level: string; label: string; text: string }[];
}

export interface PerpRef {
  venue: 'Hyperliquid';
  coin: string;
  /** Funding as % a year of the position (positive: longs pay shorts), now and 7-day average. */
  fundingNowPct: number;
  funding7dPct: number | null;
  maxLeverage: number;
  markPx: number;
  url: string;
}

export interface LongShortFeed {
  rows: LongShortRow[];
  fetchedAt: string;
  error: string | null;
  /** The perp comparison failed (the rows are still served). */
  perpError: string | null;
}
