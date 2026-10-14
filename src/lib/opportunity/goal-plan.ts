import type { Estimate, Opportunity } from '../../types/opportunity';
import type { GasQuote } from '../merkl/types';
import type { Evaluated } from '../market/analysis';
import { estimateAt } from '../market/analysis';
import { certaintyOf, split, unitOf, type Certainty } from './goal';
import { HORIZONS, type HorizonDays } from './policy';

/**
 * «نزدیک‌ترین راه‌های واقعی» — when a profit target is out of reach, what is in reach,
 * across every market and strategy the analysis estimates (never one token):
 *
 *  1. realistic target: the most this capital earns in this period, locked and with
 *     variable rates — as a portfolio spread over many opportunities;
 *  2. the capital the target needs with locked dollars only, re-estimated at each
 *     amount (rates fall and pools fill as the amount grows — never scaled linearly),
 *     or «not reachable at any amount» when the market's locked capacity runs out;
 *  3. the period: what each horizon gives the same capital;
 *  4. the smallest share in variable-rate strategies that reaches the target, the rest
 *     locked — only when it really does.
 *
 * Portfolio: the amount is cut into chunks; each goes to the opportunity where it adds
 * the most dollars (none holding more than half the plan) given what it already holds (its own capacity, price
 * impact and fixed costs re-estimated at the new size). Only `ranked` estimates count.
 * Merkl rewards are left out of the plan: they are not locked, nor a rate. Only dollar
 * profit is planned on: an ETH loop's dollars move with ETH's price.
 */

export type PlanLevel = 'locked' | 'variable-only' | 'any';

export interface Allocation {
  o: Opportunity;
  amount: number;
  /** Dollars counted (locked part, or locked + variable), and the estimate behind them. */
  net: number;
  e: Estimate;
  certainty: Certainty;
}

export interface Plan {
  amount: number;
  total: number;
  parts: Allocation[];
}

/** The day the last part of a plan pays out (its money and profit are all back); 0 for an empty plan. */
export const finishDay = (p: Pick<Plan, 'parts'>) => p.parts.reduce((m, x) => Math.max(m, x.e.earningDays), 0);

export interface NearResult {
  realistic: { locked: Plan; variable: Plan };
  /** Capital needed for the target with locked dollars; `reachable` false when the market cannot take it. */
  capitalLocked: { reachable: boolean; capital: number | null; plan: Plan | null; maxTotal: number };
  horizons: { days: HorizonDays; locked: number; variable: number }[];
  /** Smallest share of the capital in variable-rate strategies reaching the target; null when none does. */
  blend: { share: number; total: number; variable: Plan; locked: Plan } | null;
}

/** How many opportunities a plan may draw on per level, and the chunks it is cut into. */
const CANDIDATES = 12;
const CHUNKS = 12;
const MAX_CAPITAL = 10_000_000;
/** No single opportunity takes more than this share of a plan: one market, one issuer, one oracle is a risk of its own. */
export const MAX_SHARE = 0.5;

interface Ctx {
  days: HorizonDays;
  /** Most of a plan one opportunity may take (MAX_SHARE, or 1 without the diversity rule). */
  maxShare: number;
  gas: GasQuote[];
  now: number;
  cache: Map<string, Estimate>;
}

function estAt(c: Ctx, o: Opportunity, amount: number, days = c.days): Estimate {
  const k = `${o.key}|${days}|${Math.round(amount * 100)}`;
  let e = c.cache.get(k);
  if (!e) {
    e = estimateAt(o, amount, days, c.gas, c.now);
    c.cache.set(k, e);
  }
  return e;
}

/** Dollars an opportunity is counted for at an amount under a level; null when it does not qualify. */
function value(c: Ctx, o: Opportunity, amount: number, level: PlanLevel, days = c.days): { net: number; e: Estimate; certainty: Certainty } | null {
  // A dollar target: profit in ETH, BTC or SOL (or of unknown unit) is not planned on.
  if (!(amount > 0) || unitOf(o) !== 'usd') return null;
  const e = estAt(c, o, amount, days);
  if (e.placement !== 'ranked' || e.net === null) return null;
  const s = split(o, e, days);
  const certainty = certaintyOf(o, s);
  if (certainty === 'speculative') return null;
  if (level === 'locked' && certainty !== 'locked') return null;
  if (level === 'variable-only' && certainty !== 'variable') return null;
  // Only what is earned on the money actually placed counts (the rest stays idle).
  return { net: s.lockedUsd + s.variableUsd, e, certainty };
}

/**
 * Greedy portfolio of `amount` over the candidates: each step places a chunk (or a half
 * or quarter of one, so a small market fills to its own capacity) where it adds the most
 * dollars per dollar placed. Money no opportunity takes stays unplaced.
 */
function plan(c: Ctx, candidates: Opportunity[], amount: number, level: PlanLevel, days = c.days, capBase = amount): Plan {
  const held = new Map<string, number>();
  const chunk = amount / CHUNKS;
  let left = amount;
  for (let i = 0; i < CHUNKS * 4 && left > amount * 1e-6; i++) {
    let best: { o: Opportunity; size: number; perDollar: number } | null = null;
    for (const o of candidates) {
      const h = held.get(o.key) ?? 0;
      const room = capBase * c.maxShare - h;
      if (room <= amount * 1e-6) continue;
      const now = h > 0 ? value(c, o, h, level, days) : { net: 0 };
      if (!now) continue;
      for (const size of [chunk, chunk / 2, chunk / 4].map((x) => Math.min(x, left, room))) {
        const next = value(c, o, h + size, level, days);
        if (!next) continue;
        const perDollar = (next.net - now.net) / size;
        if (perDollar > 0 && (!best || perDollar > best.perDollar)) best = { o, size, perDollar };
        break;
      }
    }
    if (!best) break;
    held.set(best.o.key, (held.get(best.o.key) ?? 0) + best.size);
    left -= best.size;
  }
  const parts: Allocation[] = [];
  for (const o of candidates) {
    const a = held.get(o.key);
    if (!a) continue;
    const v = value(c, o, a, level, days);
    if (v) parts.push({ o, amount: a, net: v.net, e: v.e, certainty: v.certainty });
  }
  parts.sort((x, y) => y.net - x.net);
  return { amount, total: parts.reduce((s, p) => s + p.net, 0), parts };
}

/**
 * The candidates of a level, over every market and strategy: the best few by rate at
 * one chunk of the capital — a market too small for the whole amount still has a place.
 */
function pick(c: Ctx, rows: Evaluated[], probe: number, level: PlanLevel, days = c.days): Opportunity[] {
  const scored: { o: Opportunity; rate: number }[] = [];
  for (const r of rows) {
    if (r.o.family === 'yt') continue;
    const v = value(c, r.o, probe, level, days);
    if (v && v.net > 0) scored.push({ o: r.o, rate: v.net / probe });
  }
  return scored
    .sort((a, b) => b.rate - a.rate)
    .slice(0, CANDIDATES)
    .map((x) => x.o);
}

export function nearestPaths(rows: Evaluated[], gas: GasQuote[], days: HorizonDays, capital: number, target: number, now = Date.now(), maxShare = MAX_SHARE): NearResult {
  const c: Ctx = { days, gas, now, maxShare, cache: new Map() };
  const probe = capital / CHUNKS;
  const locked = pick(c, rows, probe, 'locked');
  const variableOnly = pick(c, rows, probe, 'variable-only');
  const any = pick(c, rows, probe, 'any');

  const realistic = { locked: plan(c, locked, capital, 'locked'), variable: plan(c, any, capital, 'any') };

  // 2. Capital for the target, locked: grow until reached or the market stops taking more.
  // Candidates are re-picked at each size (a bigger chunk suits other markets), kept with today's.
  const lockedAt = (amount: number) => {
    const extra = pick(c, rows, amount / CHUNKS, 'locked');
    return plan(c, [...locked, ...extra.filter((o) => !locked.includes(o))], amount, 'locked');
  };
  let lo = capital;
  let hi = capital;
  let atHi = realistic.locked;
  let maxTotal = atHi.total;
  while (atHi.total < target && hi < MAX_CAPITAL) {
    lo = hi;
    hi = Math.min(MAX_CAPITAL, hi * 2);
    atHi = lockedAt(hi);
    // Doubling the money no longer adds 5 %: the locked market is full.
    if (atHi.total < maxTotal * 1.05) {
      maxTotal = Math.max(maxTotal, atHi.total);
      break;
    }
    maxTotal = Math.max(maxTotal, atHi.total);
  }
  let capitalLocked: NearResult['capitalLocked'];
  if (atHi.total >= target) {
    for (let k = 0; k < 14 && hi - lo > Math.max(1, hi * 0.01); k++) {
      const mid = (lo + hi) / 2;
      const p = lockedAt(mid);
      if (p.total >= target) {
        hi = mid;
        atHi = p;
      } else lo = mid;
    }
    capitalLocked = { reachable: true, capital: hi, plan: atHi, maxTotal: Math.max(maxTotal, atHi.total) };
  } else capitalLocked = { reachable: false, capital: null, plan: null, maxTotal };

  // 3. Every horizon for the same capital.
  const horizons = HORIZONS.map((d) => ({
    days: d,
    locked: plan(c, pick(c, rows, probe, 'locked', d), capital, 'locked', d).total,
    variable: plan(c, pick(c, rows, probe, 'any', d), capital, 'any', d).total,
  }));

  // 4. Smallest variable share reaching the target (rest locked).
  // The half-the-capital cap applies to the whole portfolio, so more variable money is not
  // always more profit: scan the shares, then narrow down below the first that reaches.
  const blendAt = (share: number) => {
    const v = plan(c, variableOnly, capital * share, 'variable-only', days, capital);
    const l = plan(c, locked, capital * (1 - share), 'locked', days, capital);
    return { share, total: v.total + l.total, variable: v, locked: l };
  };
  let blend: NearResult['blend'] = null;
  if (realistic.locked.total < target) {
    let prev = 0;
    for (let k = 1; k <= 20 && !blend; k++) {
      const share = k / 20;
      const r = blendAt(share);
      if (r.total >= target) {
        let a = prev;
        let b = share;
        let hit = r;
        for (let j = 0; j < 8; j++) {
          const m = (a + b) / 2;
          const x = blendAt(m);
          if (x.total >= target) {
            b = m;
            hit = x;
          } else a = m;
        }
        blend = hit;
      }
      prev = share;
    }
  }
  return { realistic, capitalLocked, horizons, blend };
}
