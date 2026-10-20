import type { Estimate, Opportunity } from '../../types/opportunity';
import type { Evaluated } from '../market/analysis';
import type { HorizonDays } from './policy';
import { tokenClass } from '../merkl/vetting';

/**
 * «هدف سود»: the user names a capital, a dollar profit and a period; this finds what
 * the market really offers for it — every strategy the analysis estimates (lending,
 * vaults, fixed-rate lending, PT, loops, PT loops, YT, Merkl rewards), using the same
 * estimates as the ranking (costs and gas included, only `ranked` placements).
 *
 * Each option's dollar result is split by how sure it is:
 *   locked       — fixed in dollars when entered: a dollar PT's discount held to
 *                  maturity (peg verified), fixed-rate lending of a dollar, interest on a fixed-rate loan
 *                  covering the period; known costs.
 *   variable     — follows a rate that can change: lending and vault APYs, variable
 *                  borrow interest, a PT whose dollar peg rests on its name.
 *   speculative  — rewards and points, YT.
 * An option's certainty is its weakest material part, so a loop whose PT side is
 * locked but whose borrow is variable is «variable».
 */

export type Certainty = 'locked' | 'variable' | 'speculative';

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  locked: 'قفل‌شده',
  variable: 'متغیر',
  speculative: 'سفته‌بازانه',
};

/**
 * What an option's profit is counted in: a dollar target is met only by dollar profit.
 * An ETH loop's «net» holds ETH's price constant; in dollars it moves with ETH.
 */
export type ProfitUnit = 'usd' | 'eth' | 'btc' | 'sol' | 'stock' | 'other';

export function unitOf(o: Opportunity): ProfitUnit {
  // A tokenized-stock market (its PT, YT or LP): the capital is the stock, whatever the reward is paid in.
  if (o.ptClass?.class === 'stock') return 'stock';
  const c = o.family === 'pt' ? o.ptClass?.class : o.family === 'leverage' ? o.loop?.pairClass : tokenClass({ symbol: o.assets.deposit[0]?.symbol ?? '' });
  return c === 'usd' || c === 'eth' || c === 'btc' || c === 'sol' ? c : 'other';
}

export interface GoalOption {
  key: string;
  /** Unit of the profit: anything but «usd» moves with that asset's price. */
  unit: ProfitUnit;
  o: Opportunity;
  e: Estimate;
  certainty: Certainty;
  net: number;
  lockedUsd: number;
  variableUsd: number;
  speculativeUsd: number;
  /** Share of the target this reaches (1 = the goal). */
  progress: number;
  /** Loops with a variable borrow: the average borrow rate (% a year) at which the profit is zero… */
  zeroProfitBorrowPct?: number | null;
  /** …and at which it only equals holding the same PT without a loan. */
  ptEqualBorrowPct?: number | null;
  /** A fixed-rate loan covering the whole period (the loop is locked on both sides). */
  borrowLocked?: boolean;
}

export interface GoalResult {
  /** Return the target needs over the period, and as a yearly rate (APY), %. */
  periodPct: number;
  apyPct: number;
  groups: Record<Certainty, GoalOption[]>;
  /** The surest group that reaches the target; null when none does. */
  reachedBy: Certainty | null;
  /** The best result of any kind (when nothing reaches the target). */
  best: GoalOption | null;
  /** Options estimated but not placeable for this amount and period, by reason. */
  excluded: number;
}

const sumCosts = (e: Estimate) => e.costs.reduce((a, c) => a + c.usd, 0);

/** Period growth `g` over `days` back to a yearly rate, %. */
const yearly = (g: number, days: number) => (g > -1 && days > 0 ? (Math.pow(1 + g, 365 / days) - 1) * 100 : null);

export function requiredReturn(capital: number, target: number, days: number) {
  const g = capital > 0 ? target / capital : NaN;
  return { periodPct: g * 100, apyPct: Number.isFinite(g) ? (yearly(g, days) ?? NaN) : NaN };
}

/** Locked / variable / speculative dollars of one estimate (they add up to its net). */
export function split(o: Opportunity, e: Estimate, days: number): Pick<GoalOption, 'lockedUsd' | 'variableUsd' | 'speculativeUsd' | 'borrowLocked'> {
  const net = e.net ?? 0;
  const rewards = e.rewards ?? 0;
  const debt = e.debtCost ?? 0;
  const costs = sumCosts(e);
  // «Locked» means locked in dollars: a PT of SOL or XRP fixes its rate in SOL or XRP, whose price moves.
  const dollar =
    o.family === 'pt' ? o.ptClass?.class === 'usd' : o.family === 'leverage' ? o.loop?.pairClass === 'usd' : tokenClass({ symbol: o.assets.deposit[0]?.symbol ?? '' }) === 'usd';
  const pegged = dollar && o.ptClass?.pegVerified !== false && o.loop?.pegVerified !== false;
  if (o.family === 'yt') return { lockedUsd: 0, variableUsd: 0, speculativeUsd: net };
  if ((o.family === 'pt' || o.family === 'fixed-lend') && pegged) return { lockedUsd: net - rewards, variableUsd: 0, speculativeUsd: rewards };
  if (o.family === 'leverage' && o.maturity && pegged) {
    const term = o.loop?.debt.side.fixedTermDays;
    const borrowLocked = term !== undefined && term >= days;
    // The PT side is fixed; only interest on a variable loan can still move.
    const variable = borrowLocked ? 0 : -debt;
    return { lockedUsd: net - rewards - variable, variableUsd: variable, speculativeUsd: rewards, borrowLocked };
  }
  // Variable rates: what the deposit earns (and what a loan costs) can change; costs are known.
  return { lockedUsd: -costs, variableUsd: net + costs - rewards, speculativeUsd: rewards };
}

export function certaintyOf(o: Opportunity, s: ReturnType<typeof split>): Certainty {
  const gross = Math.max(0, s.lockedUsd) + Math.max(0, s.variableUsd) + Math.max(0, s.speculativeUsd);
  if (o.family === 'yt' || (gross > 0 && s.speculativeUsd >= gross / 2)) return 'speculative';
  const scale = Math.max(1, Math.abs(s.lockedUsd) + Math.abs(s.variableUsd));
  return Math.abs(s.variableUsd) > scale * 0.01 ? 'variable' : 'locked';
}

/** Loop break-evens: the average borrow rate at which profit is zero, and at which it equals the plain PT. */
function breakEvens(e: Estimate, ptNet: number | null): Pick<GoalOption, 'zeroProfitBorrowPct' | 'ptEqualBorrowPct'> {
  const debt = e.leverage?.debt ?? 0;
  const d = e.earningDays;
  if (!(debt > 0) || !(d > 0)) return {};
  const income = (e.baseIncome ?? 0) + (e.rewards ?? 0) - sumCosts(e);
  return {
    zeroProfitBorrowPct: yearly(income / debt, d),
    ptEqualBorrowPct: ptNet === null ? null : yearly((income - ptNet) / debt, d),
  };
}

export function goalOptions(rows: Evaluated[], days: HorizonDays, capital: number, target: number, perGroup = 8): GoalResult {
  const { periodPct, apyPct } = requiredReturn(capital, target, days);
  // Plain PT results by token, for «a loop only pays off below this borrow rate».
  const ptNet = new Map<string, number>();
  for (const r of rows) {
    const e = r.byHorizon[days];
    if (r.o.family === 'pt' && r.o.ptToken?.address && e?.placement === 'ranked' && e.net !== null) ptNet.set(`${r.o.chain}:${r.o.ptToken.address.toLowerCase()}`, e.net);
  }
  const all: GoalOption[] = [];
  let excluded = 0;
  for (const r of rows) {
    const e = r.byHorizon[days];
    if (!e) continue;
    if (e.placement !== 'ranked' || e.net === null || !(e.net > 0)) {
      excluded++;
      continue;
    }
    const s = split(r.o, e, days);
    const collateral = r.o.loop?.collateral.token.address;
    const opt: GoalOption = {
      key: r.o.key,
      o: r.o,
      e,
      certainty: certaintyOf(r.o, s),
      unit: unitOf(r.o),
      net: e.net,
      ...s,
      progress: target > 0 ? e.net / target : 0,
      ...(r.o.family === 'leverage' && !s.borrowLocked ? breakEvens(e, collateral && r.o.maturity ? (ptNet.get(`${r.o.chain}:${collateral.toLowerCase()}`) ?? null) : null) : {}),
    };
    all.push(opt);
  }
  all.sort((a, b) => b.net - a.net);
  const groups: Record<Certainty, GoalOption[]> = { locked: [], variable: [], speculative: [] };
  for (const x of all) if (groups[x.certainty].length < perGroup) groups[x.certainty].push(x);
  // The verdict counts dollar profit only (an ETH loop's dollars move with ETH).
  const reaches = (c: Certainty) => (all.find((x) => x.certainty === c && x.unit === 'usd')?.net ?? 0) >= target;
  const reachedBy: Certainty | null = target > 0 ? ((['locked', 'variable', 'speculative'] as const).find(reaches) ?? null) : null;
  return {
    periodPct,
    apyPct,
    groups,
    reachedBy,
    best: all.find((x) => x.unit === 'usd') ?? all[0] ?? null,
    excluded,
  };
}

/**
 * When a loop is liquidated, in numbers a user can watch:
 *   dropPct     — the collateral's fall against the debt (LeverageResult.liquidationDrop);
 *   ptRatePct   — for a PT, the market rate at which its price has fallen that far
 *                 (price = 1 ÷ (1 + r)^(t ÷ 365), t the days to maturity);
 *   borrowPct   — the average borrow rate at which interest alone reaches the limit by
 *                 the end (collateral and its own yield unchanged);
 *   zeroPct     — the average borrow rate above which the loop earns nothing.
 * Null fields are out of reach (or not applicable).
 */
export interface LiquidationInfo {
  leverage: number;
  health: number;
  dropPct: number;
  ptRatePct: number | null;
  borrowPct: number | null;
  zeroPct: number | null;
}

export function liquidationOf(o: Opportunity, e: Estimate): LiquidationInfo | null {
  const x = e.leverage;
  if (!x || !(x.debt > 0) || !(x.gross > 0)) return null;
  const d = e.earningDays;
  const drop = x.liquidationDrop;
  let ptRatePct: number | null = null;
  if (o.maturity && o.loop && d > 0 && drop < 1) {
    const r = o.loop.collateral.yield.pct / 100;
    const r2 = Math.pow(Math.pow(1 + r, d / 365) / (1 - drop), 365 / d) - 1;
    ptRatePct = Number.isFinite(r2) ? r2 * 100 : null;
  }
  const gG = (e.baseIncome ?? 0) / x.gross;
  const gB = (x.maxLtv * (x.oracleFactor ?? 1) * x.gross * (1 + gG)) / x.debt - 1;
  const borrowPct = d > 0 ? yearly(gB, d) : null;
  const costs = e.costs.reduce((a, c) => a + c.usd, 0);
  const zeroPct = d > 0 ? yearly(((e.baseIncome ?? 0) + (e.rewards ?? 0) - costs) / x.debt, d) : null;
  return { leverage: x.leverage, health: x.health.value, dropPct: drop * 100, ptRatePct, borrowPct, zeroPct };
}
