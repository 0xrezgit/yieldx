import type { BookLevel, OrderBook } from '../../types/opportunity';

/**
 * Fixed-rate maths on an order book (Morpho Midnight). Never the best price for the
 * whole amount: the user's money walks the book level by level.
 *
 *   per level:  cost per unit c_i = p_i + settlement fee
 *               units bought u_i = min(level units, money left ÷ c_i)
 *   U = Σ u_i,  spent = Σ u_i · c_i,  average price = spent ÷ U
 *   at maturity: U × (1 − continuous fee × D/365) loan tokens
 *
 * Money the book cannot absorb stays unallocated (earns nothing).
 */

/** Settlement fee for a time to maturity, linearly interpolated between breakpoints (as Midnight does). */
export function settlementFeeAt(fee: OrderBook['settlementFee'], secondsToMaturity: number): number {
  const { breakpointsSec: b, values: v } = fee;
  if (!b.length || b.length !== v.length) return NaN;
  const t = Math.max(0, secondsToMaturity);
  if (t >= b[b.length - 1]) return v[v.length - 1];
  const hi = b.findIndex((x) => t < x);
  if (hi <= 0) return v[0];
  const lo = hi - 1;
  return (v[lo] * (b[hi] - t) + v[hi] * (t - b[lo])) / (b[hi] - b[lo]);
}

export interface Fill {
  /** Units bought (loan-token units). */
  units: number;
  /** Loan tokens spent, settlement fee included. */
  spent: number;
  /** Loan tokens that did not fit in the book. */
  left: number;
  averagePrice: number | null;
  /** Settlement fee paid, in loan tokens (already inside `spent`). */
  feePaid: number;
}

/** Buy from asks (best first) with `amount` loan tokens. */
export function fillAsks(asks: BookLevel[], amount: number, settlementFee: number): Fill {
  let left = Math.max(0, amount);
  let units = 0;
  let spent = 0;
  let feePaid = 0;
  for (const l of [...asks].sort((a, b) => a.price - b.price)) {
    if (left <= 0) break;
    const c = l.price + settlementFee;
    if (!(c > 0) || !(l.units > 0) || c > 1) continue;
    const u = Math.min(l.units, left / c);
    units += u;
    spent += u * c;
    feePaid += u * settlementFee;
    left -= u * c;
  }
  return { units, spent, left: Math.max(0, left), averagePrice: units > 0 ? spent / units : null, feePaid };
}

/** Sell `units` into bids (best first): what they fetch today, net of the settlement fee. */
export function sellIntoBids(bids: BookLevel[], units: number, settlementFee: number): { proceeds: number; sold: number } {
  let left = Math.max(0, units);
  let proceeds = 0;
  let sold = 0;
  for (const l of [...bids].sort((a, b) => b.price - a.price)) {
    if (left <= 0) break;
    const p = l.price - settlementFee;
    if (!(p > 0) || !(l.units > 0)) continue;
    const u = Math.min(l.units, left);
    proceeds += u * p;
    sold += u;
    left -= u;
  }
  return { proceeds, sold };
}

/** Total loan tokens the asks could absorb, fee included. */
export const askDepth = (asks: BookLevel[], settlementFee: number) =>
  asks.reduce((a, l) => (l.price + settlementFee > 0 && l.price + settlementFee <= 1 ? a + l.units * (l.price + settlementFee) : a), 0);

/** Yearly rate that turns `spent` into `received` over `days`, as APY in %. */
export const impliedApy = (spent: number, received: number, days: number) =>
  spent > 0 && received > 0 && days > 0 ? (Math.pow(received / spent, 365 / days) - 1) * 100 : null;
