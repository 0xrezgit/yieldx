/**
 * «What would this loop have done»: every past hour of one PendleLoop box replayed as an
 * entry at a leverage, held until the data ends (today, or the PT's maturity).
 *
 * The box's own history from Pendle (`/v1/pt-looping/loop/pts/{chain}/{pt}/charts`): the
 * borrow APY, the PT price the money market's oracle read (what liquidates) and the PT's
 * market price (what an entry pays), in units of the debt. Same for Morpho, Aave V3 and
 * Euler on every network, so no market's behaviour is assumed from another's.
 *
 * Entry at hour i with leverage L on 1 of own money (dollar leverage, as the calculator):
 *   PT bought  N = L ÷ market(i)        debt  D(i) = L − 1
 *   debt grows by each hour's borrow APY: D(j) = D(i) · A(j) ÷ A(i)
 *   health     H(j) = N · oracle(j) · LLTV ÷ D(j)  — liquidated at the first H(j) < 1.
 * So H(j) = k · (oracle(j) ÷ A(j)) ÷ (market(i) ÷ A(i)) with k = L · LLTV ÷ (L − 1): the
 * lowest health of every entry comes from one suffix minimum of oracle ÷ A, in O(n).
 * An hour where the entry's own buffer 1 − 1/H(i) is under PendleLoop's minimum to open is not a
 * liquidation but a position that cannot be opened: counted apart. Fees, the price impact of the entry and liquidations inside an hour are not modelled.
 */

export interface LoopPoint {
  /** Unix seconds. */
  t: number;
  /** Borrow APY, % (the hour's average as Pendle reports it). */
  borrowPct: number;
  /** PT (or collateral) price the money market's oracle read, in debt units. */
  oracle: number;
  /** PT's market price, in debt units. */
  market: number;
  /** PT fixed APY, %, when reported. */
  fixedPct: number | null;
  liquidityUsd: number | null;
}

export interface LoopBacktest {
  leverage: number;
  /** Hours with at least `minHoldHours` of data after them. */
  candidates: number;
  /**
   * Of those, hours this leverage could not even be opened: on the oracle's price the position
   * started under PendleLoop's minimum buffer (an oracle reading the PT under its market price).
   */
  unopenable: number;
  /** Entries replayed: the candidates that could be opened. */
  entries: number;
  liquidated: number;
  /** Share of entries liquidated, %. */
  sharePct: number;
  /** Lowest health any opened entry reached (below 1 = liquidated); NaN when none opened. */
  minHealth: number;
  /** The fall in the collateral's value that liquidated at that lowest point, % (1 − 1/health). */
  minBufferPct: number;
  /** When that lowest point was (unix seconds), and the entry that met it. */
  worstAt: number;
  worstEntryAt: number;
  /** First entry that was liquidated (unix seconds), null when none. */
  firstLiquidatedEntryAt: number | null;
}

export interface LoopHistorySummary {
  from: number;
  to: number;
  days: number;
  points: number;
  /** Highest borrow APY and the deepest fall of the oracle price from its running high, %. */
  maxBorrowPct: number;
  maxOracleDropPct: number;
  /** Too short to say anything (under `MIN_DAYS` or `MIN_ENTRIES`). */
  enough: boolean;
}

export const MIN_DAYS = 14;
export const MIN_ENTRIES = 48;
/** PendleLoop opens a position only with this buffer to liquidation (its boxes' `minHealthFactor`, 0.03 on all). */
export const OPEN_BUFFER = 0.03;
const YEAR_S = 365 * 86_400;
/** A borrow APY above this (1,000%) is a broken point, not a rate: Pendle's list showed 18,298% on an expired box. */
const MAX_BORROW_PCT = 1000;

/** Valid points only, oldest first, one per timestamp. */
export function cleanPoints(points: LoopPoint[]): LoopPoint[] {
  const ok = points.filter((p) => Number.isFinite(p.t) && p.oracle > 0 && p.market > 0 && Number.isFinite(p.borrowPct) && p.borrowPct >= 0 && p.borrowPct <= MAX_BORROW_PCT);
  ok.sort((a, b) => a.t - b.t);
  return ok.filter((p, i) => i === 0 || p.t !== ok[i - 1].t);
}

/** Accrual factor A(j): what 1 of debt at the first point has become by point j. */
function accrual(p: LoopPoint[]): number[] {
  const a = new Array<number>(p.length);
  a[0] = 1;
  for (let j = 1; j < p.length; j++) a[j] = a[j - 1] * Math.pow(1 + p[j - 1].borrowPct / 100, (p[j].t - p[j - 1].t) / YEAR_S);
  return a;
}

export function summarize(points: LoopPoint[]): LoopHistorySummary {
  const p = cleanPoints(points);
  if (!p.length) return { from: 0, to: 0, days: 0, points: 0, maxBorrowPct: 0, maxOracleDropPct: 0, enough: false };
  let high = 0;
  let drop = 0;
  for (const x of p) {
    high = Math.max(high, x.oracle);
    drop = Math.max(drop, (1 - x.oracle / high) * 100);
  }
  const days = (p[p.length - 1].t - p[0].t) / 86_400;
  return { from: p[0].t, to: p[p.length - 1].t, days, points: p.length, maxBorrowPct: Math.max(...p.map((x) => x.borrowPct)), maxOracleDropPct: drop, enough: days >= MIN_DAYS };
}

/**
 * Every entry at `leverage` (> 1) replayed on the box's history; `lltv` as a fraction, the
 * money market's own (the oracle price is already in the history, so not the oracle-adjusted one).
 */
export function backtestLoop(points: LoopPoint[], leverage: number, lltv: number, minHoldHours = 24 * 7, openBuffer = OPEN_BUFFER): LoopBacktest | null {
  const p = cleanPoints(points);
  if (!(leverage > 1) || !(lltv > 0 && lltv < 1) || p.length < 2) return null;
  const A = accrual(p);
  const k = (leverage * lltv) / (leverage - 1);
  // Suffix minimum of oracle ÷ A, with where it is.
  const n = p.length;
  const sufMin = new Array<number>(n);
  const sufAt = new Array<number>(n);
  for (let j = n - 1; j >= 0; j--) {
    const v = p[j].oracle / A[j];
    if (j === n - 1 || v < sufMin[j + 1]) {
      sufMin[j] = v;
      sufAt[j] = j;
    } else {
      sufMin[j] = sufMin[j + 1];
      sufAt[j] = sufAt[j + 1];
    }
  }
  const end = p[n - 1].t;
  let candidates = 0;
  let unopenable = 0;
  let entries = 0;
  let liquidated = 0;
  let minHealth = Infinity;
  let worstAt = p[0].t;
  let worstEntryAt = p[0].t;
  let first: number | null = null;
  for (let i = 0; i < n; i++) {
    if (end - p[i].t < minHoldHours * 3600) break;
    candidates++;
    if (1 - p[i].market / (k * p[i].oracle) < openBuffer) {
      unopenable++;
      continue;
    }
    entries++;
    const h = (k * sufMin[i]) / (p[i].market / A[i]);
    if (h < 1) {
      liquidated++;
      first ??= p[i].t;
    }
    if (h < minHealth) {
      minHealth = h;
      worstAt = p[sufAt[i]].t;
      worstEntryAt = p[i].t;
    }
  }
  if (!candidates) return null;
  return {
    leverage,
    candidates,
    unopenable,
    entries,
    liquidated,
    sharePct: entries ? (liquidated / entries) * 100 : 0,
    minHealth: entries ? minHealth : NaN,
    minBufferPct: entries ? (1 - 1 / minHealth) * 100 : NaN,
    worstAt,
    worstEntryAt,
    firstLiquidatedEntryAt: first,
  };
}

/** The leverages a history table shows: 2× … 6× and the edge, plus the one chosen, under the edge. */
export function historyLevels(top: number, chosen?: number): number[] {
  const set = new Set([2, 3, 4, 5, 6].filter((x) => x < top));
  if (top > 1) set.add(Math.floor(top * 10) / 10);
  if (chosen && chosen > 1 && chosen <= top) set.add(Math.round(chosen * 10) / 10);
  return [...set].sort((a, b) => a - b);
}
