import type { LongShortRisk } from '../longshort/types';

/** One PendleLoop «Loop to Earn» box as /api/pendleloop sends it (live; expired PTs left out). */
export interface LoopBox {
  boxId: string;
  chainId: number;
  /** 'pt': a PT with a maturity; 'vanilla': a yield-bearing asset without one. */
  kind: 'pt' | 'vanilla';
  collateral: { address: string; symbol: string };
  debt: { address: string; symbol: string };
  protocol: { name: string; icon: string | null };
  moneyMarketAddress: string;
  /** ISO, PT only. */
  expiry: string | null;
  ptMarketAddress: string | null;
  /** The box in PendleLoop and in the money market's own app. */
  pendleUrl: string;
  marketUrl: string | null;
  lltv: number;
  /** Fractions, as Pendle gives them. */
  borrowApy: number;
  borrowApy7dAvg: number | null;
  /** PT: the fixed APY of its reference; vanilla: the asset's own yield. */
  yieldApy: number | null;
  maxApy: number | null;
  maxLeverage: number | null;
  liquidityUsd: number | null;
  utilization: number | null;
  /** PendleLoop's service fee on the position, fraction. */
  serviceFeeRate: number | null;
  minOpenUsd: number | null;
  isDepegged: boolean;
  /** Pendle's oracle write-up: whether the PT price follows the market or a fixed curve. */
  risk: LongShortRisk | null;
}

export interface LoopBoxesFeed {
  fetchedAt: string;
  boxes: LoopBox[];
  error: string | null;
}

/** One box's hourly history: [unix s, borrow %, oracle price, market price, fixed APY % | null, liquidity USD | null]. */
export type LoopHistoryRow = [number, number, number, number, number | null, number | null];

export interface LoopHistorySeries {
  boxId: string;
  moneyMarketAddress: string;
  debtAsset: string;
  rows: LoopHistoryRow[];
}

export interface LoopHistoryFeed {
  chainId: number;
  pt: string;
  fetchedAt: string;
  series: LoopHistorySeries[];
}
