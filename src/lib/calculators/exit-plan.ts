import thresholds from '../../config/thresholds.json';
import type { PointsBasis } from '../../types/market';
import { impliedAPYFromPT } from './implied-apy';
import { pointsEarned, pointsExposure } from './airdrop';

/**
 * When to sell a YT before maturity.
 *
 * Holding YT for t days (of D) earns yield on the notional plus points; selling
 * returns the YT's market value, which decays toward 0 as maturity nears:
 *   YT(t) = 1 − (1 + r)^(−(D − t)/365)       (r = market implied APY)
 *   cash(t) = yield(t) + sale(t) − capital   (what you walk away with, before any airdrop)
 *   total(t) = cash(t) + points(t) × value per point
 *
 * The plan assumes r stays where it is today. That is why it also reports, for each
 * day, the YT price at which selling costs nothing — a price trigger that stays valid
 * whatever the market does.
 */
export interface ExitPlanInput {
  capital: number;
  underlyingPrice: number;
  ytPrice: number;
  baseAPY: number;
  impliedAPY: number;
  daysToMaturity: number;
  pointsPerDay: number;
  ytMultiplier: number;
  pointsBasis: PointsBasis;
  valuePerPoint: number;
  /** Days until the airdrop snapshot (points after it are worthless); null if unknown. */
  snapshotDays: number | null;
  /** Largest acceptable cash loss, % of capital. */
  maxLossPercent: number;
}

export interface ExitPoint {
  day: number;
  /** Cash result if sold on this day at today's implied APY, USD. */
  cash: number;
  /** Cash result plus the airdrop value of the points, USD. */
  total: number;
  points: number;
  /** YT price (asset units) at which selling on this day breaks even in cash. 0 = yield already covers it. */
  breakEvenPrice: number;
  /** Market implied APY that corresponds to breakEvenPrice, %. */
  breakEvenImpliedAPY: number;
}

export interface ExitPlan {
  /** Day 0 (sell now) … maturity; sampled to at most ~120 points for charts. */
  series: ExitPoint[];
  /** Most points while cash loss stays within the budget (and not past the snapshot). */
  recommended: ExitPoint;
  /** Highest total result including the airdrop. */
  bestTotal: ExitPoint;
  /** Highest cash result (smallest loss). */
  bestCash: ExitPoint;
  /** First day on which cash ≥ 0, if any. */
  cashBreakEven: ExitPoint | null;
  /** Holding past this day earns nothing more (snapshot or maturity). */
  horizon: number;
  /** Price trigger for today: selling at or above it exits without cash loss. */
  sellTriggerToday: ExitPoint;
  /** Checkpoints at ¼, ½ and ¾ of the horizon plus the recommended day. */
  milestones: ExitPoint[];
  earnsPoints: boolean;
  lossBudget: number;
}

export function computeExitPlan(input: ExitPlanInput): ExitPlan | null {
  const D = Math.max(1, Math.round(input.daysToMaturity));
  const r = input.impliedAPY / 100;
  const a = input.baseAPY / 100;
  if (!(input.ytPrice > 0 && input.underlyingPrice > 0 && input.capital > 0) || !Number.isFinite(r)) return null;

  const cost = thresholds.exit.costPercent / 100;
  const units = input.capital / (input.ytPrice * input.underlyingPrice);
  const notional = units * input.underlyingPrice;
  const exposure = pointsExposure(units, notional, input.pointsBasis);
  const horizon = input.snapshotDays === null ? D : Math.max(0, Math.min(D, Math.round(input.snapshotDays)));
  const lossBudget = (input.capital * Math.max(0, input.maxLossPercent)) / 100;
  const saleUnit = units * input.underlyingPrice * (1 - cost);

  const at = (t: number): ExitPoint => {
    const tau = D - t;
    const ytPrice = tau > 0 ? 1 - Math.pow(1 + r, -tau / 365) : 0;
    const accrued = notional * (Math.pow(1 + a, t / 365) - 1);
    const cash = accrued + ytPrice * saleUnit - input.capital;
    const points = pointsEarned(exposure, input.pointsPerDay, input.ytMultiplier, Math.min(t, horizon));
    const breakEvenPrice = Math.max(0, (input.capital - accrued) / saleUnit);
    const breakEvenImpliedAPY =
      tau > 0 && breakEvenPrice > 0 && breakEvenPrice < 1 ? impliedAPYFromPT(1 - breakEvenPrice, tau) : NaN;
    return { day: t, cash, total: cash + points * input.valuePerPoint, points, breakEvenPrice, breakEvenImpliedAPY };
  };

  const all = Array.from({ length: D + 1 }, (_, t) => at(t));
  const byMax = (key: 'cash' | 'total', pool = all) => pool.reduce((best, x) => (x[key] > best[key] ? x : best), pool[0]);

  const earnsPoints = input.pointsPerDay > 0 && input.ytMultiplier > 0 && horizon > 0;
  const withinHorizon = all.slice(0, horizon + 1);
  const affordable = withinHorizon.filter((x) => x.cash >= -lossBudget);
  // With points: hold as long as the loss budget allows (latest affordable day ≤ horizon).
  // Without points: points don't matter, so take the best cash day.
  const recommended = earnsPoints
    ? (affordable.length ? affordable[affordable.length - 1] : all[0])
    : byMax('cash');

  const step = Math.max(1, Math.ceil(D / 120));
  const series = all.filter((x) => x.day % step === 0 || x.day === D || x.day === recommended.day || x.day === horizon);

  const q = (f: number) => all[Math.max(1, Math.round(horizon * f))] ?? all[D];
  const milestones = [...new Map([q(0.25), q(0.5), q(0.75), recommended].map((x) => [x.day, x])).values()].sort(
    (x, y) => x.day - y.day,
  );

  return {
    series,
    recommended,
    bestTotal: byMax('total'),
    bestCash: byMax('cash'),
    cashBreakEven: all.find((x) => x.day > 0 && x.cash >= 0) ?? null,
    horizon,
    sellTriggerToday: all[Math.min(1, D)],
    milestones,
    earnsPoints,
    lossBudget,
  };
}
