/**
 * LP analysis — «تحلیل تخصصی»: why an LP position has no single defensible
 * dollar figure, made visible. Report §4-7:
 *
 * - four separate parts: trading fees, rewards, the change in value of the
 *   position, and the comparison with simply holding the same two assets (HODL);
 * - price scenarios of asset A against asset B, each labelled hypothetical and
 *   never given a probability;
 * - fees only while the price is inside the range, along a straight price path
 *   from today to the scenario's end price (the path is unknown — stated).
 *
 * Prices are in units of B per A, normalised to 1 today. B is held at its
 * reference USD price (1 when B is a dollar stablecoin).
 */

export type PoolShape = { kind: 'full' } | { kind: 'range'; low: number; high: number };

export interface LpInput {
  capital: number;
  days: number;
  shape: PoolShape;
  /** Trading-fee APR earned on the position while in range, %; null → unknown. */
  feeAprPct: number | null;
  /** Rewards over the period, USD (e.g. Merkl engine), or null → use `rewardAprPct`. */
  rewardUsd: number | null;
  rewardAprPct: number | null;
  /** Entry + exit costs counted, USD. */
  costsUsd: number;
}

export interface LpScenario {
  /** Relative move of A against B, e.g. −0.2 for −20%. */
  move: number;
  positionUsd: number;
  hodlUsd: number;
  /** Position − HODL (≤ 0): the change in value from being an LP. */
  ilUsd: number;
  ilPct: number;
  /** Share of the straight path spent inside the range, 0…1. */
  inRange: number;
  feesUsd: number | null;
  rewardsUsd: number;
  /** Against holding the two assets: fees + rewards − IL − costs. */
  vsHodlUsd: number | null;
  /** Against keeping the capital in B: position + fees + rewards − capital − costs. */
  vsCashUsd: number | null;
}

/** Token amounts for liquidity L at price p in [a, b] (Uniswap v3 maths); full range = a→0, b→∞. */
function amounts(L: number, p: number, a: number, b: number) {
  const sp = Math.sqrt(Math.min(Math.max(p, a), b));
  const x = b === Infinity ? L / sp : L * (1 / sp - 1 / Math.sqrt(b));
  const y = a === 0 ? L * sp : L * (sp - Math.sqrt(a));
  return { x, y };
}

const bounds = (s: PoolShape): [number, number] => (s.kind === 'full' ? [0, Infinity] : [s.low, s.high]);

/** Position value and HODL value at end price `p1` for `capital` deposited at price 1. */
export function valueAt(shape: PoolShape, capital: number, p1: number) {
  const [a, b] = bounds(shape);
  const unit = amounts(1, 1, a, b);
  const v0 = unit.x * 1 + unit.y;
  if (!(v0 > 0) || !(p1 > 0)) return { position: NaN, hodl: NaN };
  const L = capital / v0;
  const start = amounts(L, 1, a, b);
  const end = amounts(L, p1, a, b);
  return { position: end.x * p1 + end.y, hodl: start.x * p1 + start.y };
}

/** Share of a straight path from 1 to p1 inside [a, b] (today's price is inside). */
export function inRangeShare(shape: PoolShape, p1: number): number {
  if (shape.kind === 'full') return 1;
  const { low: a, high: b } = shape;
  if (p1 >= a && p1 <= b) return 1;
  const edge = p1 > b ? b : a;
  return Math.max(0, Math.min(1, (edge - 1) / (p1 - 1)));
}

export function scenario(input: LpInput, move: number): LpScenario {
  const p1 = 1 + move;
  const { position, hodl } = valueAt(input.shape, input.capital, p1);
  const share = inRangeShare(input.shape, p1);
  const t = input.days / 365;
  // Fees accrue on the position's value; average of start and end is used over the path.
  const feesUsd = input.feeAprPct === null ? null : ((input.capital + position) / 2) * (input.feeAprPct / 100) * t * share;
  const rewardsUsd = input.rewardUsd ?? (input.rewardAprPct ? input.capital * (input.rewardAprPct / 100) * t : 0);
  const ilUsd = position - hodl;
  return {
    move,
    positionUsd: position,
    hodlUsd: hodl,
    ilUsd,
    ilPct: hodl > 0 ? (ilUsd / hodl) * 100 : NaN,
    inRange: share,
    feesUsd,
    rewardsUsd,
    vsHodlUsd: feesUsd === null ? null : ilUsd + feesUsd + rewardsUsd - input.costsUsd,
    vsCashUsd: feesUsd === null ? null : position - input.capital + feesUsd + rewardsUsd - input.costsUsd,
  };
}

/** Default hypothetical moves: small for two dollar stablecoins (depeg), larger otherwise. */
export const defaultMoves = (stablePair: boolean) => (stablePair ? [-0.05, -0.01, 0, 0.01, 0.05] : [-0.2, -0.05, 0, 0.05, 0.2]);

/**
 * The price moves (down and up) at which fees and rewards stop covering the
 * change in value against HODL, within ±95% / +500%; null when never reached.
 */
export function breakEven(input: LpInput): { down: number | null; up: number | null } {
  const f = (m: number) => scenario(input, m).vsHodlUsd ?? NaN;
  if (!(f(0) > 0)) return { down: null, up: null };
  const solve = (lo: number, hi: number) => {
    // f(lo) > 0 at the start side, f(hi) ≤ 0 at the far side.
    if (!(f(hi) <= 0)) return null;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { down: solve(0, -0.95), up: solve(0, 5) };
}
