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

/**
 * The same curve with fewer points: a point is dropped when linear interpolation between
 * the points kept around it (as `curveAt` reads it) lands within `tol` of its rate —
 * so the curve `curveAt` returns is unchanged to `tol` (Douglas–Peucker on u → rate).
 * Interest rate models are piecewise linear: their 101 sampled points come down to the
 * kinks. Kept values are rounded to what the estimates can use (u to 1e-6, rate to 9
 * significant digits).
 */
export function simplifyCurve(points: SupplyCurve['points'], tol?: number): SupplyCurve['points'] {
  if (points.length <= 3) return points;
  const scale = Math.max(...points.map((p) => Math.abs(p.rate)), 1e-12);
  const eps = tol ?? scale * 1e-6;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const pa = points[a];
      const pb = points[b];
      const t = pb.u === pa.u ? 0 : (points[i].u - pa.u) / (pb.u - pa.u);
      const d = Math.abs(points[i].rate - (pa.rate + t * (pb.rate - pa.rate)));
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at > 0 && worst > eps) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ u: Math.round(p.u * 1e6) / 1e6, rate: Number(p.rate.toPrecision(9)) }));
}
