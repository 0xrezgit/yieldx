import type { PoolShape } from './scenarios';

/**
 * How long the price stays inside a range, from the pair's measured volatility.
 *
 * The log price is taken as a random walk with no drift and yearly volatility σ
 * (vfat: 30 days of 4-hour returns). In log terms the range is (ln low, ln high)
 * and today's price sits at 0, x₀ = −ln low from the lower edge, W = ln(high/low)
 * wide. Then:
 *
 * - expected time to the first exit: x₀·(W − x₀) / σ² (years);
 * - chance of no exit by t: Σₙ (2/(nπ))·(1 − (−1)ⁿ)·sin(nπx₀/W)·e^(−n²π²σ²t/(2W²)).
 *
 * Real prices jump and trend, so these are rough guides; a range narrower than
 * the usual move is left within hours, whatever it pays on paper.
 */

const sigma = (volAnnualPct: number) => volAnnualPct / 100;

function edges(shape: PoolShape): { x0: number; w: number } | null {
  if (shape.kind === 'full') return null;
  if (!(shape.low > 0) || !(shape.high > 1) || !(shape.low < 1)) return null;
  return { x0: -Math.log(shape.low), w: Math.log(shape.high / shape.low) };
}

/** Expected days until the price first leaves the range; Infinity for the full range. NaN without volatility. */
export function expectedDaysInRange(shape: PoolShape, volAnnualPct: number): number {
  if (shape.kind === 'full') return Infinity;
  const e = edges(shape);
  const s = sigma(volAnnualPct);
  if (!e || !(s > 0)) return NaN;
  return ((e.x0 * (e.w - e.x0)) / (s * s)) * 365;
}

const normCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

function erfc(x: number): number {
  // Numerical Recipes' erfc (fractional error < 1.2e-7).
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Chance (0…1) the price is still inside the range after `days`; 1 for the full range. NaN without volatility. */
export function stayInRange(shape: PoolShape, volAnnualPct: number, days: number): number {
  if (shape.kind === 'full' || days <= 0) return 1;
  const e = edges(shape);
  const s = sigma(volAnnualPct);
  if (!e || !(s > 0)) return NaN;
  const t = days / 365;
  const k = (Math.PI * Math.PI * s * s * t) / (2 * e.w * e.w);
  // Terms fade once n²k is large; for a short time against a wide range that takes
  // too many, and leaving is rare: the two edges' first-passage chances (images) are
  // then exact enough.
  const terms = Math.ceil(Math.sqrt(60 / k));
  if (terms > 4000) {
    const sd = s * Math.sqrt(t);
    return Math.max(0, Math.min(1, 1 - 2 * normCdf(-e.x0 / sd) - 2 * normCdf(-(e.w - e.x0) / sd)));
  }
  let p = 0;
  for (let n = 1; n <= terms; n += 2) p += (4 / (n * Math.PI)) * Math.sin((n * Math.PI * e.x0) / e.w) * Math.exp(-n * n * k);
  return Math.max(0, Math.min(1, p));
}

/** A symmetric range ±pct% around today's price. */
export const symmetricRange = (pct: number): PoolShape => ({ kind: 'range', low: 1 - pct / 100, high: 1 + pct / 100 });
