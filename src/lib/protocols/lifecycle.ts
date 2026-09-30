import type { MarketListing, MarketSummary } from '../../types/market';
import { DAY_MS } from '../utils/math';

/**
 * Where a product stands in its life, from its maturity date:
 * - open: no maturity at all (lending, vaults) — never expires;
 * - active: matures in the future;
 * - matured: the date has passed;
 * - invalid: a maturity was given but cannot be read (a data error, not «expired»).
 */
export type MaturityState = 'open' | 'active' | 'matured' | 'invalid';

export interface Maturity {
  state: MaturityState;
  /** Whole days left (ceil); 0 once matured; null when open or invalid. */
  days: number | null;
}

export function maturityState(maturity: string | null | undefined, now = Date.now()): Maturity {
  if (maturity === null || maturity === undefined || maturity.trim() === '') return { state: 'open', days: null };
  const ms = new Date(maturity).getTime() - now;
  if (!Number.isFinite(ms)) return { state: 'invalid', days: null };
  if (ms <= 0) return { state: 'matured', days: 0 };
  return { state: 'active', days: Math.ceil(ms / DAY_MS) };
}

/**
 * Applies the same lifecycle rules to every PT/YT protocol's list, so markets added
 * in the future need no extra code: anything past maturity is expired (even if an
 * upstream cache still lists it), expired markets sort last, and active ones are
 * ordered by liquidity.
 *
 * PT/YT markets only: a PT cannot be valued without its maturity, so an unreadable
 * date is set aside with the expired ones. Products without a maturity go through
 * `maturityState` directly, where they are «open», never expired.
 */
export function withLifecycle(markets: MarketSummary[], now = Date.now()): MarketListing[] {
  return markets
    .map((m) => {
      const { state, days } = maturityState(m.maturity, now);
      const expired = state !== 'active';
      return { ...m, expired, daysToMaturity: expired ? 0 : (days ?? 0) };
    })
    .sort((a, b) => Number(a.expired) - Number(b.expired) || (b.liquidity ?? 0) - (a.liquidity ?? 0));
}
