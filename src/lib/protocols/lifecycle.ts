import type { MarketListing, MarketSummary } from '../../types/market';
import { DAY_MS } from '../utils/math';

/**
 * Applies the same lifecycle rules to every protocol's list, so markets added in
 * the future need no extra code: anything past maturity is expired (even if an
 * upstream cache still lists it), expired markets sort last, and active ones are
 * ordered by liquidity.
 */
export function withLifecycle(markets: MarketSummary[], now = Date.now()): MarketListing[] {
  return markets
    .map((m) => {
      const ms = new Date(m.maturity).getTime() - now;
      const expired = !Number.isFinite(ms) || ms <= 0;
      return { ...m, expired, daysToMaturity: expired ? 0 : Math.ceil(ms / DAY_MS) };
    })
    .sort((a, b) => Number(a.expired) - Number(b.expired) || (b.liquidity ?? 0) - (a.liquidity ?? 0));
}
