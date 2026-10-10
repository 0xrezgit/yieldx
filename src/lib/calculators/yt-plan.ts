import type { MarketPointsProgram } from '../../types/market';
import { baseScenarios, type BaseScenarios } from '../opportunity/base-scenarios';
import { afterAmmFee } from '../opportunity/pt-price';
import type { BaseLevels } from '../../types/market';
import { BASE_RATE_KIND, simulateYt, ytPriceFromAPY, YT_YIELD_FEE_PCT, type YtTrade } from './trade';

/**
 * «کارنامه‌ی YT»: what buying a market's YT with a given amount does, in dollars and
 * points — what is paid, what burns (the YT is worth nothing at maturity), the yield
 * received under the three base-yield readings, every fee, the points and what each
 * costs, until when an exit loses nothing, and the market rate a sale needs to.
 *
 * Fees are each protocol's own, not one flat guess:
 * - Pendle: the AMM fee is a log-rate (`ammFeeLn`): a YT buy pays implied + fee, a sale
 *   implied − fee (Pendle docs; checked against its quotes in pt-price.ts).
 * - Exponent: ~0.05% a trade on its order book (115.42 → 115.36 USD for 100 ONyc, 2026-10-10).
 * - Anyone else: the user's assumed fee, labelled as such.
 * An executable quote, when there is one, replaces the entry price and fee.
 */

export const EXPONENT_FEE_PCT = 0.05;

export type FeeSource = 'pendle-amm' | 'exponent-book' | 'quote' | 'assumed';

export interface YtPlanMarket {
  protocol: string;
  impliedPct: number;
  basePct: number;
  daysToMaturity: number;
  baseLevels?: BaseLevels | null;
  /** Conservative base for a suspect market (base health), else null. */
  capPct?: number | null;
  ammFeeLn?: number | null;
  points?: MarketPointsProgram | null;
  hasPoints: boolean;
  /** USD price of one asset unit (unit-based points). */
  unitUsd?: number | null;
}

export interface YtPlanInput {
  capital: number;
  /** Fee assumed where the protocol's own is unknown, % a trade. */
  assumedFeePct: number;
  /** An executable quote's price per unit of yield (fees and impact in it), when there is one. */
  entryPrice?: number;
  /** Network cost of each transaction on the market's chain, USD. */
  txUsd: number;
  /** Assumed USD value of 1M points (0: none). */
  valuePerMillion?: number;
}

/** Fee of a buy at the market rate, %, and of a sale `left` days before maturity at `exitPct`. */
export function ytFees(m: Pick<YtPlanMarket, 'protocol' | 'ammFeeLn' | 'impliedPct' | 'daysToMaturity'>, assumedPct: number) {
  if (m.protocol === 'pendle' && m.ammFeeLn && m.ammFeeLn > 0) {
    const D = m.daysToMaturity;
    const mid = ytPriceFromAPY(m.impliedPct, D);
    const paid = ytPriceFromAPY(afterAmmFee(m.impliedPct, m.ammFeeLn, 'yt'), D);
    return {
      source: 'pendle-amm' as FeeSource,
      entryPct: paid > 0 ? (1 - mid / paid) * 100 : assumedPct,
      exitPct: (exitPct: number, left: number) => {
        const q0 = ytPriceFromAPY(exitPct, left);
        const q1 = ytPriceFromAPY(afterAmmFee(exitPct, m.ammFeeLn, 'pt'), left);
        return q0 > 0 ? Math.max(0, (1 - q1 / q0) * 100) : assumedPct;
      },
    };
  }
  if (m.protocol === 'exponent') return { source: 'exponent-book' as FeeSource, entryPct: EXPONENT_FEE_PCT, exitPct: () => EXPONENT_FEE_PCT };
  return { source: 'assumed' as FeeSource, entryPct: assumedPct, exitPct: () => assumedPct };
}

export type Reading = 'low' | 'likely' | 'high';

export interface MaturityLine {
  kind: Reading;
  basePct: number;
  /** Yield received to maturity, after the protocol's share, USD. */
  yieldUsd: number;
  /** The protocol's share of that yield, USD. */
  yieldFeeUsd: number;
  cashUsd: number;
  points: number | null;
  /** USD each 1M points cost (loss ÷ points); 0 when free; null without a point count. */
  costPerMillion: number | null;
}

export interface ExitLine {
  day: number;
  /** Cash result if the market rate is unchanged on the sale day, USD. */
  cashUsd: number;
  /** The market rate at or above which the sale loses nothing, %; −∞ any, +∞ none. */
  breakEvenPct: number;
  points: number | null;
}

export interface YtPlan {
  capital: number;
  feeSource: FeeSource;
  entry: { feeUsd: number; feePct: number; gasUsd: number; ytPrice: number; notionalUsd: number; leverage: number };
  /** Spent on the YT itself — worth nothing at maturity. */
  burnedUsd: number;
  scenarios: BaseScenarios;
  maturity: MaturityLine[];
  exits: ExitLine[];
  /** Last day an exit loses nothing at an unchanged market rate (likely base, fees and gas in); null if none. */
  freeUntil: number | null;
  /** Points: per day and the program used; null when the protocol publishes none (Pendle). */
  pointsPerDay: number | null;
  program: MarketPointsProgram | null;
  /** Dollar-days of yield exposure to maturity — what most programs pay on, comparable across markets. */
  exposureDollarDays: number;
  /** Loss per 1,000 dollar-days of exposure held to maturity (likely), USD; 0 when free. */
  costPerKDollarDay: number;
  /** USD value of 1M points at which holding to maturity breaks even (likely); 0 when free. */
  breakEvenPerMillion: number | null;
  gasUsd: { entry: number; exit: number; claim: number };
  /** With the assumed points value, held to maturity (likely). */
  withPointsUsd: number | null;
}

const READINGS: Reading[] = ['low', 'likely', 'high'];
const EXIT_DAYS = [1, 7, 14, 30, 60];

export function ytPlan(m: YtPlanMarket, i: YtPlanInput): YtPlan | null {
  const D = Math.max(1, Math.round(m.daysToMaturity));
  if (!(i.capital > 0) || !(m.impliedPct > 0) || !Number.isFinite(m.basePct)) return null;
  const fees = ytFees({ ...m, daysToMaturity: D }, i.assumedFeePct);
  const quoted = i.entryPrice !== undefined && i.entryPrice > 0;
  const prog = m.points ?? null;
  const unitUsd = m.unitUsd && m.unitUsd > 0 ? m.unitUsd : 1;
  const base = (h: number) => baseScenarios(m.basePct, m.baseLevels, h, m.capPct ?? null);
  const yieldFee = YT_YIELD_FEE_PCT[m.protocol] ?? 0;
  const sim = (h: number, basePct: number, exitPct = m.impliedPct): YtTrade =>
    simulateYt({
      capital: i.capital,
      underlyingPrice: prog?.basis === 'unit' ? unitUsd : 1,
      daysToMaturity: D,
      entryAPY: m.impliedPct,
      baseAPY: basePct,
      holdDays: h,
      exitAPY: exitPct,
      feePercent: quoted ? 0 : fees.entryPct,
      exitFeePercent: fees.exitPct(exitPct, D - Math.min(h, D)),
      pointsPerDay: prog ? prog.pointsPerDay : 0,
      ytMultiplier: prog ? prog.ytMultiplier : 1,
      pointsBasis: prog?.basis ?? 'usd',
      valuePerPoint: (i.valuePerMillion ?? 0) / 1e6,
      yieldFeePercent: yieldFee,
      baseRateKind: BASE_RATE_KIND[m.protocol],
      entryPrice: quoted ? i.entryPrice : undefined,
    });

  const gas = { entry: i.txUsd * 2, exit: i.txUsd, claim: i.txUsd }; // approve + buy; sell; claim at maturity
  const sc = base(D);
  const t0 = sim(D, sc.likely);
  const feeUsd = quoted ? 0 : (i.capital * fees.entryPct) / 100;
  const maturity: MaturityLine[] = READINGS.map((kind) => {
    const t = kind === 'likely' ? t0 : sim(D, sc[kind]);
    const gross = yieldFee < 100 ? t.yieldEarned / (1 - yieldFee / 100) : t.yieldEarned;
    const cash = t.cash - gas.entry - gas.claim;
    const points = prog ? t.points : null;
    return { kind, basePct: sc[kind], yieldUsd: t.yieldEarned, yieldFeeUsd: gross - t.yieldEarned, cashUsd: cash, points, costPerMillion: points && points > 0 ? (cash >= 0 ? 0 : (-cash / points) * 1e6) : null };
  });

  const exits: ExitLine[] = [];
  let freeUntil: number | null = null;
  for (let h = 1; h < D; h++) {
    const t = sim(h, base(h).likely);
    const cash = t.cash - gas.entry - gas.exit;
    if (cash >= 0) freeUntil = h;
    if (EXIT_DAYS.includes(h)) exits.push({ day: h, cashUsd: cash, breakEvenPct: t.breakEvenExitAPY, points: prog ? t.points : null });
  }
  const likely = maturity[1];
  if (likely.cashUsd >= 0) freeUntil = D;
  const exposureDollarDays = t0.notional * D;
  const pointsPerDay = prog ? t0.points / D : null;
  return {
    capital: i.capital,
    feeSource: quoted ? 'quote' : fees.source,
    entry: { feeUsd, feePct: quoted ? 0 : fees.entryPct, gasUsd: gas.entry, ytPrice: t0.entryPrice, notionalUsd: t0.notional, leverage: t0.leverage },
    burnedUsd: i.capital - feeUsd,
    scenarios: sc,
    maturity,
    exits,
    freeUntil,
    pointsPerDay,
    program: prog,
    exposureDollarDays,
    costPerKDollarDay: likely.cashUsd >= 0 ? 0 : (-likely.cashUsd / exposureDollarDays) * 1000,
    breakEvenPerMillion: likely.costPerMillion,
    gasUsd: gas,
    withPointsUsd: prog && (i.valuePerMillion ?? 0) > 0 && likely.points !== null ? likely.cashUsd + (likely.points * (i.valuePerMillion as number)) / 1e6 : null,
  };
}

export type Cheapness = 'free' | 'cheap' | 'fair' | 'dear';

/**
 * How a market's points compare with the other points markets: the cost per 1M points
 * within the same program when at least three markets share it, else the cost per 1,000
 * dollar-days of exposure (÷ the YT multiplier when known) across every points market.
 * Cheapest quarter «cheap», dearest quarter «dear».
 */
export function pointsCheapness(plans: { id: string; plan: YtPlan }[]): Map<string, { level: Cheapness; rank: number; of: number; basis: 'program' | 'exposure' }> {
  const out = new Map<string, { level: Cheapness; rank: number; of: number; basis: 'program' | 'exposure' }>();
  const byProgram = new Map<string, { id: string; cost: number }[]>();
  const all: { id: string; cost: number }[] = [];
  for (const { id, plan } of plans) {
    const prog = plan.program;
    const per = plan.breakEvenPerMillion;
    if (prog && per !== null) byProgram.set(prog.name, [...(byProgram.get(prog.name) ?? []), { id, cost: per }]);
    all.push({ id, cost: plan.costPerKDollarDay / (prog?.ytMultiplier || 1) });
  }
  const rank = (list: { id: string; cost: number }[], basis: 'program' | 'exposure') => {
    const sorted = [...list].sort((a, b) => a.cost - b.cost);
    sorted.forEach((x, k) => {
      if (out.has(x.id) && basis === 'exposure') return;
      const q = sorted.length > 1 ? k / (sorted.length - 1) : 0;
      const level: Cheapness = x.cost <= 0 ? 'free' : q <= 0.25 ? 'cheap' : q >= 0.75 ? 'dear' : 'fair';
      out.set(x.id, { level, rank: k + 1, of: sorted.length, basis });
    });
  };
  for (const list of byProgram.values()) if (list.length >= 3) rank(list, 'program');
  rank(all, 'exposure');
  return out;
}
