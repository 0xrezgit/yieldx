import type { CostItem, Estimate, Opportunity } from '../../types/opportunity';
import type { GasQuote, MerklOpportunity } from '../merkl/types';
import type { VetContext } from '../merkl/vetting';
import { estimateAt, type Evaluated } from '../market/analysis';
import { claimCost, txCost } from '../opportunity/costs';
import { addMerklRewards } from '../opportunity/merkl-link';
import { tokenClass } from '../merkl/vetting';
import { defaultLeverageInput, type LeverageInput } from '../opportunity/leverage';
import { HORIZONS, LEVERAGE_PROFILES, type HorizonDays } from '../opportunity/policy';
import { maturityState } from '../protocols/lifecycle';

/**
 * «درآمد ماهانه» — money withdrawn every month, the capital left working. Independent of
 * «هدف سود»: its own question (a steady monthly amount, not one period's profit), its own
 * candidates and its own plan; it only reads the market analysis' opportunities.
 *
 * Only what can pay every month is used: lending, vaults, and loops without a maturity
 * (their profit taken out each month by repaying a little debt and withdrawing the same
 * value of collateral). A PT pays at maturity only; Merkl rewards are not a monthly income.
 * Only dollar deposits and dollar/dollar loops: the income is in dollars.
 *
 * Opt-in, LP of a tokenized-stock market (Pendle): its only cash is claimable incentives —
 * the Merkl campaign linked to the LP (priced with the same vetting as the analysis) and
 * PENDLE emissions — so they are its monthly, shown as an estimate (`incentive`), never as
 * a guaranteed income; the bad month keeps only the Merkl part. The pool's own yield is in
 * the stock's units and stays in the LP. The capital is the stock (`stock`).
 *
 *   monthly (typical) = 30 days of the estimate's income on the money placed, entry and
 *                       exit costs taken out (they are paid once, shown apart), minus
 *                       one withdrawal a month (its gas, and the swap a loop needs);
 *   monthly (bad)     = the estimate's low reading of the rate (lending, vaults), or the
 *                       borrow rate 2 points higher (loops).
 */

export type MonthlyRisk = 'stable' | 'balanced' | 'boosted';
export const MONTHLY_RISK_LABEL: Record<MonthlyRisk, string> = { stable: 'پایدار', balanced: 'متعادل', boosted: 'کمی بیشتر' };

/**
 * «کمی بیشتر»: between the balanced profile (health 1.12) and the aggressive one (1.05),
 * which this tool never uses. Defined here so «هدف سود» is untouched.
 */
const BOOSTED: LeverageInput = {
  version: 'lev-v1-monthly-boosted',
  minHealth: 1.08,
  maxLeverage: 8,
  // Its own cap for loops whose dollar peg is unverified, between balanced (4×) and aggressive (8×).
  pt: { ...LEVERAGE_PROFILES.balanced.pt, version: 'lev-pt-v2-monthly-boosted', minHealth: 1.08, maxLeverage: 7, cautiousLeverage: 5 },
};

/** The fall of collateral against debt that liquidates a loop opened at the risk's minimum health. */
export const riskDrop = (risk: MonthlyRisk) => (risk === 'stable' ? null : (1 - 1 / (risk === 'boosted' ? BOOSTED.minHealth : LEVERAGE_PROFILES.balanced.lev.minHealth)) * 100);

/** Borrow rate rise of a «bad month» for loops, percentage points. */
export const BAD_BORROW_PP = 2;
/** No asset (a loop's collateral) or market takes more than this share of the capital. */
export const MONTHLY_MAX_SHARE = 0.5;

/** What one risk depends on: a loop's collateral token (two loops of sUSDai are one risk), else the market. */
const exposureOf = (o: Opportunity) =>
  o.family === 'leverage' && o.loop ? `asset:${(o.loop.collateral.token.symbol ?? '').toUpperCase()}` : o.family === 'pt' ? `asset:${(o.assets.deposit[0]?.symbol ?? '').toUpperCase()}` : `market:${o.key}`;
const CHUNKS = 8;
const CANDIDATES = 12;
const DAYS = 30 as const;

export interface MonthlyPart {
  o: Opportunity;
  amount: number;
  /** Dollars a month: typical, and in a bad month. */
  monthly: number;
  bad: number;
  /** One-time costs to open (and later close) the position. */
  oneTime: number;
  /** Cost of the monthly withdrawal, dollars. */
  withdrawCost: number;
  e: Estimate;
  /** Days between withdrawals: 30, or a PT's days to maturity (its profit comes at maturity). */
  payoutDays: number;
  /** A dollar peg resting only on the name (opt-in). */
  unverified: boolean;
  /** Of `monthly`, dollars that are incentives (estimated, diluted by the pool, not guaranteed). */
  incentive: number;
  /** The capital is a tokenized stock: its dollar value moves with the stock's price. */
  stock: boolean;
}

export interface MonthlyOptions {
  risk: MonthlyRisk;
  ethereum: boolean;
  /** Loops on a collateral whose dollar peg rests only on its name (apyUSD): opt-in, warned. */
  unverified?: boolean;
  /** Dollar PTs, withdrawn at maturity (every 1–4 months), shown as a monthly average. */
  pt?: boolean;
  /** LP of tokenized-stock markets, its claimable incentives as the monthly (estimated, the capital in the stock). */
  lp?: boolean;
  /** The analysis' Merkl vetting: without it no Merkl campaign is counted. */
  merklCtx?: VetContext | null;
  now?: number;
}

export interface MonthlyPlan {
  capital: number;
  parts: MonthlyPart[];
  monthly: number;
  bad: number;
  oneTime: number;
  /** Money no opportunity took. */
  idle: number;
}

export interface MonthlyResult {
  plan: MonthlyPlan;
  /** Capital that would give the target a month, re-estimated at each amount; null when the market cannot. */
  capitalForTarget: number | null;
  /** The most a month the market takes at this risk (when the target is out of reach at any amount). */
  maxMonthly: number;
}

const sum = (c: CostItem[]) => c.reduce((a, x) => a + x.usd, 0);
const levOf = (risk: MonthlyRisk): LeverageInput => (risk === 'boosted' ? BOOSTED : risk === 'balanced' ? { ...LEVERAGE_PROFILES.balanced.lev, pt: LEVERAGE_PROFILES.balanced.pt } : defaultLeverageInput);

/** Can this opportunity pay a dollar income every month (or, opted in, at a PT's maturity)? */
export function monthlyEligible(o: Opportunity, risk: MonthlyRisk, ethereum: boolean, opts: Pick<MonthlyOptions, 'unverified' | 'pt' | 'lp'> = {}): boolean {
  if (!ethereum && o.chain === 'eip155:1') return false;
  if (o.family === 'lend' || o.family === 'vault') return tokenClass({ symbol: o.assets.deposit[0]?.symbol ?? '' }) === 'usd';
  if (o.family === 'leverage') return risk !== 'stable' && !o.maturity && o.loop?.pairClass === 'usd' && (o.loop.pegVerified !== false || opts.unverified === true);
  if (o.family === 'pt') return opts.pt === true && o.ptClass?.class === 'usd' && o.ptClass.pegVerified !== false;
  if (o.family === 'lp') return opts.lp === true && risk !== 'stable' && !!o.pendleLp;
  return false;
}

/** A PT's estimate horizon: the shortest one its maturity fits in; null past the last. */
function ptHorizon(o: Opportunity, now: number): HorizonDays | null {
  const m = maturityState(o.maturity, now);
  if (m.state !== 'active' || m.days === null) return null;
  return HORIZONS.find((h) => h >= m.days!) ?? null;
}

interface Ctx {
  gas: GasQuote[];
  now: number;
  lev: LeverageInput;
  cache: Map<string, MonthlyPart | null>;
  /** Merkl campaigns linked to each opportunity (key), and the vetting to price them. */
  merkl: Map<string, MerklOpportunity[]>;
  merklCtx: VetContext | null;
}

/** One opportunity at an amount, as a monthly income; null when it does not take the amount. */
function partAt(c: Ctx, o: Opportunity, amount: number): MonthlyPart | null {
  const k = `${o.key}|${Math.round(amount)}`;
  if (c.cache.has(k)) return c.cache.get(k)!;
  if (o.family === 'pt') {
    // Paid at maturity: the profit of one round as a monthly average; buying, redeeming
    // and the swap back repeat each round, so they stay inside it. The first round is
    // locked, the bad month is the same.
    const h = ptHorizon(o, c.now);
    const e = h ? estimateAt(o, amount, h, c.gas, c.now) : null;
    let r: MonthlyPart | null = null;
    if (e && e.placement === 'ranked' && e.net !== null && e.earningDays > 0) {
      const monthly = ((e.net - (e.rewards ?? 0)) * 30) / e.earningDays;
      if (monthly > 0) r = { o, amount: e.allocatable > 0 ? Math.min(amount, e.allocatable + sum(e.costs)) : amount, monthly, bad: monthly, oneTime: 0, withdrawCost: (sum(e.costs) * 30) / e.earningDays, e, payoutDays: e.earningDays, unverified: false, incentive: 0, stock: false };
    }
    c.cache.set(k, r);
    return r;
  }
  if (o.family === 'lp') {
    let e = estimateAt(o, amount, DAYS, c.gas, c.now);
    const linked = c.merkl.get(o.key);
    if (linked?.length && c.merklCtx) e = addMerklRewards(e, linked, c.merklCtx, claimCost(c.gas));
    let r: MonthlyPart | null = null;
    if (e.placement === 'ranked' && e.net !== null && e.earningDays >= DAYS - 1) {
      const lines = e.rewardLines.filter((l) => l.days > 0);
      const perMonth = (src?: 'merkl') => lines.filter((l) => !src || l.source === src).reduce((a, l) => a + (l.usd * DAYS) / l.days, 0);
      // A month of claims (one per source) at today's share of each campaign; opening and closing are paid once.
      const withdrawCost = txCost(o.chain, ['claim'], c.gas).usd * new Set(lines.map((l) => l.source)).size;
      const monthly = perMonth() - withdrawCost;
      const bad = Math.max(0, perMonth('merkl') - txCost(o.chain, ['claim'], c.gas).usd);
      r = monthly > 0 ? { o, amount: e.allocatable > 0 ? Math.min(amount, e.allocatable + sum(e.costs)) : amount, monthly, bad, oneTime: sum(e.costs), withdrawCost, e, payoutDays: DAYS, unverified: false, incentive: monthly, stock: o.ptClass?.class === 'stock' } : null;
    }
    c.cache.set(k, r);
    return r;
  }
  const e = estimateAt(o, amount, DAYS, c.gas, c.now, o.family === 'leverage' ? c.lev : defaultLeverageInput);
  let r: MonthlyPart | null = null;
  if (e.placement === 'ranked' && e.net !== null && e.earningDays >= DAYS - 1) {
    const oneTime = sum(e.costs);
    // 30 days of income without the rewards (not monthly cash) and without one-time costs.
    const income = e.net + oneTime - (e.rewards ?? 0);
    const steps: ('withdraw' | 'swap' | 'deposit')[] = o.family === 'leverage' ? ['swap', 'deposit', 'withdraw'] : ['withdraw'];
    const withdrawCost = txCost(o.chain, steps, c.gas).usd + (o.family === 'leverage' ? Math.max(0, income) * 0.001 : 0);
    const monthly = income - withdrawCost;
    let bad = monthly;
    if (o.family === 'leverage' && e.leverage) bad = monthly - (e.leverage.debt * BAD_BORROW_PP) / 100 / 12;
    else {
      // The lowest rate seen: today, the 7-day average, the history's medians and long mean.
      // The rate the estimate actually used (it may already be the lower of today and the 7-day average).
      const used = e.baseIncome !== null && e.allocatable > 0 && e.earningDays > 0 ? (e.baseIncome / e.allocatable) * (365 / e.earningDays) * 100 : (o.rate.robust?.pct ?? o.rate.value);
      const seen = [o.rate.value, o.rate.avg7d, o.rate.robust?.median7, o.rate.robust?.median30, o.rate.robust?.long].filter((x): x is number => typeof x === 'number' && x >= 0);
      const lowest = seen.length ? Math.min(...seen) : null;
      if (used && used > 0 && lowest !== null) bad = monthly * Math.min(1, lowest / used);
    }
    r = monthly > 0 ? { o, amount: e.allocatable > 0 ? Math.min(amount, e.allocatable + oneTime) : amount, monthly, bad, oneTime, withdrawCost, e, payoutDays: DAYS, unverified: o.loop?.pegVerified === false, incentive: 0, stock: false } : null;
  }
  c.cache.set(k, r);
  return r;
}

function planAt(c: Ctx, candidates: Opportunity[], capital: number): MonthlyPlan {
  const held = new Map<string, number>();
  const byExposure = new Map<string, number>();
  const chunk = capital / CHUNKS;
  let left = capital;
  for (let i = 0; i < CHUNKS * 3 && left > capital * 1e-6; i++) {
    let best: { o: Opportunity; size: number; per: number } | null = null;
    for (const o of candidates) {
      const h = held.get(o.key) ?? 0;
      const room = capital * MONTHLY_MAX_SHARE - (byExposure.get(exposureOf(o)) ?? 0);
      if (room <= capital * 1e-6) continue;
      const now = h > 0 ? partAt(c, o, h) : null;
      if (h > 0 && !now) continue;
      for (const size of [chunk, chunk / 2].map((x) => Math.min(x, left, room))) {
        const next = partAt(c, o, h + size);
        if (!next) continue;
        const per = (next.monthly - (now?.monthly ?? 0)) / size;
        if (per > 0 && (!best || per > best.per)) best = { o, size, per };
        break;
      }
    }
    if (!best) break;
    held.set(best.o.key, (held.get(best.o.key) ?? 0) + best.size);
    byExposure.set(exposureOf(best.o), (byExposure.get(exposureOf(best.o)) ?? 0) + best.size);
    left -= best.size;
  }
  const parts = candidates.map((o) => (held.get(o.key) ? partAt(c, o, held.get(o.key)!) : null)).filter((p): p is MonthlyPart => p !== null).sort((a, b) => b.monthly - a.monthly);
  return {
    capital,
    parts,
    monthly: parts.reduce((s, p) => s + p.monthly, 0),
    bad: parts.reduce((s, p) => s + p.bad, 0),
    oneTime: parts.reduce((s, p) => s + p.oneTime, 0),
    idle: Math.max(0, capital - parts.reduce((s, p) => s + p.amount, 0)),
  };
}

/** The best dollar-a-month per dollar placed, among eligible opportunities, at one chunk of an amount. */
function pick(c: Ctx, rows: Evaluated[], opts: MonthlyOptions, probe: number): Opportunity[] {
  return rows
    .filter((r) => monthlyEligible(r.o, opts.risk, opts.ethereum, opts))
    .map((r) => ({ o: r.o, p: partAt(c, r.o, probe) }))
    .filter((x): x is { o: Opportunity; p: MonthlyPart } => x.p !== null)
    .sort((a, b) => b.p.monthly - a.p.monthly)
    .slice(0, CANDIDATES)
    .map((x) => x.o);
}

export function monthlyIncome(rows: Evaluated[], gas: GasQuote[], capital: number, target: number, opts: MonthlyOptions): MonthlyResult {
  const c: Ctx = { gas, now: opts.now ?? Date.now(), lev: levOf(opts.risk), cache: new Map(), merkl: new Map(rows.map((r) => [r.o.key, r.merkl])), merklCtx: opts.merklCtx ?? null };
  const plan = planAt(c, pick(c, rows, opts, capital / CHUNKS), capital);
  if (plan.monthly >= target || !(target > 0)) return { plan, capitalForTarget: plan.monthly >= target ? capital : null, maxMonthly: plan.monthly };
  // Capital for the target: grow until reached or the market stops taking more, then narrow down.
  const at = (x: number) => planAt(c, pick(c, rows, opts, x / CHUNKS), x);
  let lo = capital;
  let hi = capital;
  let p = plan;
  let max = plan.monthly;
  while (p.monthly < target && hi < 10_000_000) {
    lo = hi;
    hi *= 2;
    p = at(hi);
    if (p.monthly < max * 1.05) {
      max = Math.max(max, p.monthly);
      return { plan, capitalForTarget: null, maxMonthly: max };
    }
    max = Math.max(max, p.monthly);
  }
  if (p.monthly < target) return { plan, capitalForTarget: null, maxMonthly: max };
  for (let k = 0; k < 12 && hi - lo > hi * 0.01; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid).monthly >= target) hi = mid;
    else lo = mid;
  }
  return { plan, capitalForTarget: hi, maxMonthly: max };
}
