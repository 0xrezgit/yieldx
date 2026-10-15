import type { CostItem, Estimate, Opportunity } from '../../types/opportunity';
import type { GasQuote } from '../merkl/types';
import { estimateAt, type Evaluated } from '../market/analysis';
import { txCost } from '../opportunity/costs';
import { tokenClass } from '../merkl/vetting';
import { defaultLeverageInput, type LeverageInput } from '../opportunity/leverage';
import { LEVERAGE_PROFILES } from '../opportunity/policy';

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
const BOOSTED: LeverageInput = { version: 'lev-v1-monthly-boosted', minHealth: 1.08, maxLeverage: 8 };

/** The fall of collateral against debt that liquidates a loop opened at the risk's minimum health. */
export const riskDrop = (risk: MonthlyRisk) => (risk === 'stable' ? null : (1 - 1 / (risk === 'boosted' ? BOOSTED.minHealth : LEVERAGE_PROFILES.balanced.lev.minHealth)) * 100);

/** Borrow rate rise of a «bad month» for loops, percentage points. */
export const BAD_BORROW_PP = 2;
/** No asset (a loop's collateral) or market takes more than this share of the capital. */
export const MONTHLY_MAX_SHARE = 0.5;

/** What one risk depends on: a loop's collateral token (two loops of sUSDai are one risk), else the market. */
const exposureOf = (o: Opportunity) => (o.family === 'leverage' && o.loop ? `asset:${(o.loop.collateral.token.symbol ?? '').toUpperCase()}` : `market:${o.key}`);
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

/** Can this opportunity pay a dollar income every month? */
export function monthlyEligible(o: Opportunity, risk: MonthlyRisk, ethereum: boolean): boolean {
  if (!ethereum && o.chain === 'eip155:1') return false;
  if (o.family === 'lend' || o.family === 'vault') return tokenClass({ symbol: o.assets.deposit[0]?.symbol ?? '' }) === 'usd';
  if (o.family === 'leverage') return risk !== 'stable' && !o.maturity && o.loop?.pairClass === 'usd' && o.loop.pegVerified !== false;
  return false;
}

interface Ctx {
  gas: GasQuote[];
  now: number;
  lev: LeverageInput;
  cache: Map<string, MonthlyPart | null>;
}

/** One opportunity at an amount, as a monthly income; null when it does not take the amount. */
function partAt(c: Ctx, o: Opportunity, amount: number): MonthlyPart | null {
  const k = `${o.key}|${Math.round(amount)}`;
  if (c.cache.has(k)) return c.cache.get(k)!;
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
    r = monthly > 0 ? { o, amount: e.allocatable > 0 ? Math.min(amount, e.allocatable + oneTime) : amount, monthly, bad, oneTime, withdrawCost, e } : null;
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
function pick(c: Ctx, rows: Evaluated[], risk: MonthlyRisk, ethereum: boolean, probe: number): Opportunity[] {
  return rows
    .filter((r) => monthlyEligible(r.o, risk, ethereum))
    .map((r) => ({ o: r.o, p: partAt(c, r.o, probe) }))
    .filter((x): x is { o: Opportunity; p: MonthlyPart } => x.p !== null)
    .sort((a, b) => b.p.monthly - a.p.monthly)
    .slice(0, CANDIDATES)
    .map((x) => x.o);
}

export function monthlyIncome(rows: Evaluated[], gas: GasQuote[], capital: number, target: number, opts: { risk: MonthlyRisk; ethereum: boolean; now?: number }): MonthlyResult {
  const c: Ctx = { gas, now: opts.now ?? Date.now(), lev: levOf(opts.risk), cache: new Map() };
  const plan = planAt(c, pick(c, rows, opts.risk, opts.ethereum, capital / CHUNKS), capital);
  if (plan.monthly >= target || !(target > 0)) return { plan, capitalForTarget: plan.monthly >= target ? capital : null, maxMonthly: plan.monthly };
  // Capital for the target: grow until reached or the market stops taking more, then narrow down.
  const at = (x: number) => planAt(c, pick(c, rows, opts.risk, opts.ethereum, x / CHUNKS), x);
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
