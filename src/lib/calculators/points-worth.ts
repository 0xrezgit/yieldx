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
  /** Value of 1M points, USD: the band starts here (inclusive) and ends at `toPerM` (null: no end). */
  fromPerM: number;
  toPerM: number | null;
  /** Cash result to maturity at the band's start, USD (likely base yield, airdrop at `fromPerM`). */
  resultUsd: number;
}

export interface PointsWorth {
  /** Airdrop zero, likely base yield; and airdrop zero with the pessimistic base. USD. */
  zeroUsd: number;
  zeroLowUsd: number;
  /** What the same capital earns in the safe alternative over the same days, USD. */
  safeUsd: number;
  /** Below which a profit is not worth the time, on top of the safe alternative, USD. */
  extraUsd: number;
  /** Real cost of the points: the safe yield given up plus any cash loss (0 or more), USD. */
  realCostUsd: number;
  points: number | null;
  ladder: LadderStep[] | null;
  /** Points per dollar that can be lost against the safe alternative when the airdrop is zero (pessimistic base). */
  pointsPerRiskUsd: number | null;
  riskUsd: number;
}

const growth = (pct: number, days: number) => Math.pow(1 + pct / 100, days / 365) - 1;

export function pointsWorth(plan: YtPlan, days: number, safePct: number, extraPct: number): PointsWorth {
  const D = Math.max(1, Math.round(days));
  const likely = plan.maturity.find((x) => x.kind === 'likely')!;
  const low = plan.maturity.find((x) => x.kind === 'low')!;
  const safeUsd = plan.capital * growth(Math.max(0, safePct), D);
  const extraUsd = plan.capital * growth(Math.max(0, extraPct), D);
  const cash = likely.cashUsd;
  const P = likely.points;
  const riskUsd = Math.max(0, safeUsd - low.cashUsd);
  let ladder: LadderStep[] | null = null;
  if (P !== null && P > 0) {
    const perM = (usd: number) => Math.max(0, usd) / P * 1e6;
    const v0 = perM(-cash);
    const v1 = Math.max(v0, perM(safeUsd - cash));
    const v2 = Math.max(v1, perM(safeUsd + extraUsd - cash));
    const at = (v: number) => cash + (P * v) / 1e6;
    const steps: LadderStep[] = [];
    if (cash < 0) steps.push({ band: 'loss', fromPerM: 0, toPerM: 0, resultUsd: cash });
    if (v0 > 0) steps.push({ band: 'small-loss', fromPerM: 0, toPerM: v0, resultUsd: cash });
    if (v1 > v0 || cash >= 0) steps.push({ band: 'even', fromPerM: v0, toPerM: v1, resultUsd: at(v0) });
    if (v2 > v1) steps.push({ band: 'thin', fromPerM: v1, toPerM: v2, resultUsd: at(v1) });
    steps.push({ band: 'good', fromPerM: v2, toPerM: null, resultUsd: at(v2) });
    ladder = steps;
  }
  return {
    zeroUsd: cash,
    zeroLowUsd: low.cashUsd,
    safeUsd,
    extraUsd,
    realCostUsd: Math.max(0, safeUsd - cash),
    points: P,
    ladder,
    pointsPerRiskUsd: P !== null && P > 0 ? (riskUsd > 0 ? P / riskUsd : Infinity) : null,
    riskUsd,
  };
}

/** FDV the token needs for 1M points to be worth `perM`, given the program's total points and the airdrop share (%). */
export function fdvFor(perM: number, totalPoints: number, airdropPct: number): number | null {
  if (!(totalPoints > 0) || !(airdropPct > 0)) return null;
  return (perM / 1e6) * totalPoints / (airdropPct / 100);
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
