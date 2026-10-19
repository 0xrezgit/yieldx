import type { YtPlan } from './yt-plan';
import { pointsEarned, pointsExposure } from './airdrop';

/**
 * «آیا این پوینت می‌ارزد؟» — no forecast of the airdrop. For one YT statement it gives:
 * the result if the airdrop is zero (and if the base yield also disappoints), the real
 * cost once the safe alternative is counted, and the value 1M points must reach for
 * each outcome — net loss, small loss, break-even, thin profit, good profit — so the
 * buyer judges how likely each condition is. A past airdrop says nothing about this one.
 */

export type Band = 'loss' | 'small-loss' | 'even' | 'thin' | 'good';

export interface LadderStep {
  band: Band;
  /** Total airdrop to the buyer, USD: the band starts here (inclusive) and ends at `toUsd` (null: no end). */
  fromUsd: number;
  toUsd: number | null;
  /** The same per 1M points, when the points are known. */
  fromPerM: number | null;
  toPerM: number | null;
  /** Cash result at the band's start, USD (likely base yield, airdrop at `fromUsd`). */
  resultUsd: number;
}

export interface PointsWorth {
  /** Airdrop zero: the likely result and a pessimistic one. USD. */
  zeroUsd: number;
  zeroLowUsd: number;
  /** What the same capital earns in the safe alternative over the same days, USD. */
  safeUsd: number;
  /** Below which a profit is not worth the time, on top of the safe alternative, USD. */
  extraUsd: number;
  /** Real cost of the points: the safe yield given up plus any cash loss (0 or more), USD. */
  realCostUsd: number;
  points: number | null;
  /** Always there: thresholds in airdrop dollars need no point count. */
  ladder: LadderStep[];
  /** Points per dollar that can be lost against the safe alternative when the airdrop is zero (pessimistic). */
  pointsPerRiskUsd: number | null;
  riskUsd: number;
}

const growth = (pct: number, days: number) => Math.pow(1 + pct / 100, days / 365) - 1;

/** Any position that earns points: its cash result to the end with no airdrop (likely and pessimistic) and its points. */
export interface PointsPosition {
  capital: number;
  days: number;
  cashUsd: number;
  lowCashUsd: number;
  points: number | null;
}

export function pointsLadder(x: PointsPosition, safePct: number, extraPct: number): PointsWorth {
  const D = Math.max(1, Math.round(x.days));
  const safeUsd = x.capital * growth(Math.max(0, safePct), D);
  const extraUsd = x.capital * growth(Math.max(0, extraPct), D);
  const cash = x.cashUsd;
  const P = x.points;
  const riskUsd = Math.max(0, safeUsd - x.lowCashUsd);
  const a0 = Math.max(0, -cash);
  const a1 = Math.max(a0, safeUsd - cash);
  const a2 = Math.max(a1, safeUsd + extraUsd - cash);
  const perM = (usd: number | null) => (usd === null || P === null || !(P > 0) ? null : (usd / P) * 1e6);
  const step = (band: Band, from: number, to: number | null): LadderStep => ({ band, fromUsd: from, toUsd: to, fromPerM: perM(from), toPerM: perM(to), resultUsd: cash + from });
  const ladder: LadderStep[] = [];
  if (cash < 0) ladder.push(step('loss', 0, 0));
  if (a0 > 0) ladder.push(step('small-loss', 0, a0));
  if (a1 > a0 || cash >= 0) ladder.push(step('even', a0, a1));
  if (a2 > a1) ladder.push(step('thin', a1, a2));
  ladder.push(step('good', a2, null));
  return {
    zeroUsd: cash,
    zeroLowUsd: x.lowCashUsd,
    safeUsd,
    extraUsd,
    realCostUsd: Math.max(0, safeUsd - cash),
    points: P,
    ladder,
    pointsPerRiskUsd: P !== null && P > 0 ? (riskUsd > 0 ? P / riskUsd : Infinity) : null,
    riskUsd,
  };
}

/**
 * A YT statement as a points position. `pointsOverride`: the points the buyer reads on the
 * project's own dashboard when the protocol publishes no rate (Pendle, Spectra).
 */
export function pointsWorth(plan: YtPlan, days: number, safePct: number, extraPct: number, pointsOverride?: number | null): PointsWorth {
  const likely = plan.maturity.find((x) => x.kind === 'likely')!;
  const low = plan.maturity.find((x) => x.kind === 'low')!;
  const points = likely.points ?? (pointsOverride && pointsOverride > 0 ? pointsOverride : null);
  return pointsLadder({ capital: plan.capital, days, cashUsd: likely.cashUsd, lowCashUsd: low.cashUsd, points }, safePct, extraPct);
}

/**
 * FDV the token needs for 1M points to be worth `perM`: the program's total points at the
 * season's end (raised by a dilution buffer, %, since totals usually end above today's
 * projection) and the airdrop share of the supply (%).
 */
export function fdvFor(perM: number, totalPoints: number, airdropPct: number, bufferPct = 0): number | null {
  if (!(totalPoints > 0) || !(airdropPct > 0)) return null;
  return ((perM / 1e6) * totalPoints * (1 + Math.max(0, bufferPct) / 100)) / (airdropPct / 100);
}

/** Extra borrow interest over `days` if the loan rate rises by `plusPct` points, USD. */
export function borrowShockUsd(debtUsd: number, borrowPct: number, days: number, plusPct = 2): number {
  const D = Math.max(1, Math.round(days));
  return Math.max(0, debtUsd * (growth(borrowPct + plusPct, D) - growth(borrowPct, D)));
}

export interface HoldAlternative {
  /** Holding the asset itself (multiplier 1): points and what can be lost against the safe alternative. */
  hold: { points: number; riskUsd: number; pointsPerRiskUsd: number };
  /** Pendle LP with the program's LP multiplier — an upper bound: only the pool's SY share usually earns. */
  lp: { points: number; multiplier: number } | null;
}

/** The same capital in the asset itself or in LP, for points per dollar at risk next to the YT. */
export function holdAlternative(plan: YtPlan, days: number, safePct: number, unitUsd: number): HoldAlternative | null {
  const prog = plan.program;
  if (!prog || !(prog.pointsPerDay > 0)) return null;
  const D = Math.max(1, Math.round(days));
  const units = plan.capital / (unitUsd > 0 ? unitUsd : 1);
  const exposure = pointsExposure(units, plan.capital, prog.basis);
  const holdPoints = pointsEarned(exposure, prog.pointsPerDay, 1, D);
  const riskUsd = Math.max(0, plan.capital * (growth(Math.max(0, safePct), D) - growth(plan.scenarios.low, D)));
  return {
    hold: { points: holdPoints, riskUsd, pointsPerRiskUsd: riskUsd > 0 ? holdPoints / riskUsd : Infinity },
    lp: prog.lpMultiplier > 0 ? { points: pointsEarned(exposure, prog.pointsPerDay, prog.lpMultiplier, D), multiplier: prog.lpMultiplier } : null,
  };
}

/**
 * «بودجه‌ی بلیت»: spread a loss budget over several programs — the best market of each,
 * by points exposure per dollar at risk — so that even if every airdrop is zero the
 * loss stays within the budget. `planAt` re-prices a market at another amount.
 */
export interface BudgetPick {
  id: string;
  amountUsd: number;
  worstUsd: number;
  plan: YtPlan;
}

export function spreadBudget(
  candidates: { id: string; program: string; plan: YtPlan }[],
  budgetUsd: number,
  maxPerMarket: number,
  planAt: (id: string, amount: number) => YtPlan | null,
  count = 5,
): BudgetPick[] {
  if (!(budgetUsd > 0) || !(maxPerMarket > 0)) return [];
  const worst = (p: YtPlan) => Math.max(0, -p.maturity.find((x) => x.kind === 'low')!.cashUsd);
  const score = (p: YtPlan) => (p.exposureDollarDays * (p.program?.ytMultiplier || 1)) / Math.max(1, worst(p));
  const best = new Map<string, { id: string; plan: YtPlan }>();
  for (const c of candidates) {
    const cur = best.get(c.program);
    if (!cur || score(c.plan) > score(cur.plan)) best.set(c.program, c);
  }
  const chosen = [...best.values()].sort((a, b) => score(b.plan) - score(a.plan)).slice(0, count);
  if (!chosen.length) return [];
  const share = budgetUsd / chosen.length;
  const out: BudgetPick[] = [];
  for (const c of chosen) {
    const w = worst(c.plan);
    let amount = w > 0 ? Math.min(maxPerMarket, (c.plan.capital * share) / w) : maxPerMarket;
    // Fixed fees and gas weigh more on a smaller amount: shrink until the loss fits.
    let plan = planAt(c.id, amount);
    for (let k = 0; k < 4 && plan && worst(plan) > share * 1.001; k++) {
      amount *= share / worst(plan);
      plan = planAt(c.id, amount);
    }
    if (plan && amount >= 10) out.push({ id: c.id, amountUsd: amount, worstUsd: worst(plan), plan });
  }
  return out;
}
