import type { LongShortRow, PerpRef } from '../longshort/types';
import type { MultiplyRow } from '../multiply/types';

/**
 * Everything the leverage comparison needs, in one response so the list is ranked once
 * (no rows jumping as slow sources arrive). Each source carries its own error: a venue
 * that failed is shown as «not received», never as «does not list this asset».
 */
export interface LeverageFeed {
  kamino: MultiplyRow[];
  kaminoError: string | null;
  pendle: LongShortRow[];
  pendleError: string | null;
  /** Hyperliquid perps by coin («BTC», «xyz:TSLA»). */
  perps: Record<string, PerpRef>;
  perpError: string | null;
  fetchedAt: string;
}
