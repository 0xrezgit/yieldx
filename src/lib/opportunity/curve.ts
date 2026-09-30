import type { SupplyCurve } from '../../types/opportunity';

/** Linear interpolation on a curve sorted by utilization; clamps outside its range. */
export function curveAt(points: SupplyCurve['points'], u: number): number | null {
  if (!points.length || !Number.isFinite(u)) return null;
  if (u <= points[0].u) return points[0].rate;
  const last = points[points.length - 1];
  if (u >= last.u) return last.rate;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (u <= b.u) {
      const a = points[i - 1];
      const t = b.u === a.u ? 0 : (u - a.u) / (b.u - a.u);
      return a.rate + t * (b.rate - a.rate);
    }
  }
  return last.rate;
}

/**
 * The supply rate (% per year) after depositing `amount` USD: utilization drops
 * from borrowed ÷ supplied to borrowed ÷ (supplied + amount), and the published
 * rate is scaled by how much the curve falls between those two points. Held
 * constant for the period — the curve itself also moves over time.
 */
export function rateAfterDeposit(curve: SupplyCurve, amount: number, publishedPct: number): number | null {
  const { suppliedUsd: s, borrowedUsd: b, points } = curve;
  if (!(s > 0) || !(b >= 0) || !(amount >= 0) || !points.length) return null;
  const now = curveAt(points, b / s);
  const after = curveAt(points, b / (s + amount));
  if (now === null || after === null) return null;
  if (now <= 0) return after <= 0 ? 0 : null;
  return publishedPct * (after / now);
}

/**
 * The classic two-slope model (Aave): borrow = base + slope1·u/opt below the kink,
 * base + slope1 + slope2·(u − opt)/(1 − opt) above it; supply = borrow · u · (1 − fee).
 * All inputs are fractions. 201 points, 0% to 100% in 0.5% steps.
 */
export function kinkedSupplyCurve(p: { base: number; slope1: number; slope2: number; optimal: number; fee: number }): SupplyCurve['points'] {
  const { base, slope1, slope2, optimal, fee } = p;
  if (![base, slope1, slope2, optimal, fee].every(Number.isFinite) || !(optimal > 0 && optimal < 1)) return [];
  return Array.from({ length: 201 }, (_, i) => {
    const u = i / 200;
    const borrow = u <= optimal ? base + (slope1 * u) / optimal : base + slope1 + (slope2 * (u - optimal)) / (1 - optimal);
    return { u, rate: borrow * u * (1 - fee) };
  });
}

/** Borrow rate of the same two-slope model (fractions), 201 points. */
export function kinkedBorrowCurve(p: { base: number; slope1: number; slope2: number; optimal: number }): SupplyCurve['points'] {
  const { base, slope1, slope2, optimal } = p;
  if (![base, slope1, slope2, optimal].every(Number.isFinite) || !(optimal > 0 && optimal < 1)) return [];
  return Array.from({ length: 201 }, (_, i) => {
    const u = i / 200;
    return { u, rate: u <= optimal ? base + (slope1 * u) / optimal : base + slope1 + (slope2 * (u - optimal)) / (1 - optimal) };
  });
}

/**
 * The borrow rate (% per year) after borrowing `amount` USD: utilization rises from
 * borrowed ÷ supplied to (borrowed + amount) ÷ supplied; the published rate is scaled
 * by the curve between those points. Null when the borrow would exceed the supply.
 */
export function rateAfterBorrow(curve: SupplyCurve, amount: number, publishedPct: number): number | null {
  const { suppliedUsd: s, borrowedUsd: b, points } = curve;
  if (!(s > 0) || !(b >= 0) || !(amount >= 0) || !points.length || b + amount > s) return null;
  const now = curveAt(points, b / s);
  const after = curveAt(points, (b + amount) / s);
  if (now === null || after === null || !(now > 0)) return null;
  return publishedPct * (after / now);
}
