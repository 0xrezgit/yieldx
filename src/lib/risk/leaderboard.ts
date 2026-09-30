import thresholds from '../../config/thresholds.json';
import { BASE_RATE_KIND, simulateLoop, simulateYt, YT_YIELD_FEE_PCT } from '../calculators/trade';
import type { LoopSettings, OpportunityListing, ScreenSettings } from './opportunities';
import { isLoopable, isStable } from './opportunities';

/**
 * Dollar leaderboards kept beside the market analysis («رتبه‌بندی دلاری YT» and
 * «رتبه‌بندی دلاری Loop PT»): what a given capital earns or loses in each market.
 *
 * - A PT loop is held to maturity at the leverage, borrow rate and LLTV the user enters.
 *   A loop already liquidatable at entry (health below 1) cannot be opened and is left out.
 * - YT is sold on its best day — the day with the highest cash result at today's
 *   implied APY — which can be well before maturity. The longest loss-free hold
 *   (points for free) is reported next to it.
 *
 * Every row carries the holding period, so a small profit over a long time can be
 * told apart from a good one: `annualized` and `perDay` normalise by time.
 */
export type LeaderStrategy = 'yt' | 'loop';

export type Verdict = 'worth' | 'thin' | 'loss' | 'free' | 'cheap' | 'costly';

export interface LeaderRow {
  m: OpportunityListing;
  /** USD result for the capital (before any airdrop). */
  pnl: number;
  pnlPercent: number;
  /** Days the position is held. */
  days: number;
  /** Result annualised over `days`, %. */
  annualized: number;
  /** USD per day held. */
  perDay: number;
  verdict: Verdict;
  /** Capital is a large share of the market's liquidity. */
  tooBig: boolean;
  /** YT only: last day the position is still loss-free (points for free); null if none. */
  freeUntil: number | null;
  /** YT only: multiplier-weighted exposure in USD earning points. */
  pointsExposure: number | null;
  /** YT only: USD change of the result per 1 percentage point of base yield (the one input that decides it). */
  perBasePoint?: number | null;
  /** Loop only: health factor at entry (LLTV × collateral ÷ debt); null without debt. */
  health?: number | null;
}

export interface LeaderInput {
  capital: number;
  /** Minimum annualised return that makes a loop worth the lock-up, %. */
  hurdle?: number;
}

const annualize = (pnl: number, capital: number, days: number) => {
  const g = 1 + pnl / capital;
  return days > 0 && g > 0 ? (Math.pow(g, 365 / days) - 1) * 100 : pnl < 0 ? -100 : 0;
};

const tooBig = (m: OpportunityListing, size: number, share = thresholds.liquidity.positionShareWarning) =>
  m.liquidity !== null && m.liquidity > 0 && size / m.liquidity > share;

const eligible = (m: OpportunityListing, s: ScreenSettings) =>
  !m.expired && m.daysToMaturity >= s.minDays && m.impliedAPY > 0 && (m.liquidity === null || m.liquidity >= s.minLiquidity);

const fixedVerdict = (annualized: number, hurdle: number): Verdict => (annualized <= 0 ? 'loss' : annualized >= hurdle ? 'worth' : 'thin');

/** PT loops: markets Pendle lists for looping, or deep stablecoin markets; held to maturity. */
export function leaderLoop(markets: OpportunityListing[], s: ScreenSettings, l: LoopSettings, i: LeaderInput): LeaderRow[] {
  const out: LeaderRow[] = [];
  for (const m of markets) {
    if (!(eligible(m, s) && m.daysToMaturity >= thresholds.opportunities.loopMinDays && (isLoopable(m) || (isStable(m) && (m.liquidity ?? 0) >= thresholds.opportunities.loopCandidateLiquidityUsd)))) continue;
    const D = m.daysToMaturity;
    const r = simulateLoop({ capital: i.capital, daysToMaturity: D, entryAPY: m.impliedAPY, leverage: l.leverage, borrowAPY: l.borrowAPY, lltv: l.lltv, feePercent: s.feePercent });
    if (r.healthFactor < 1) continue;
    const annualized = annualize(r.profit, i.capital, D);
    out.push({
      m,
      pnl: r.profit,
      pnlPercent: (r.profit / i.capital) * 100,
      days: D,
      annualized,
      perDay: r.profit / D,
      verdict: fixedVerdict(annualized, i.hurdle ?? 8),
      // The loop buys `leverage` × capital of PT.
      tooBig: tooBig(m, i.capital * Math.max(1, l.leverage)),
      freeUntil: null,
      pointsExposure: null,
      health: Number.isFinite(r.healthFactor) ? r.healthFactor : null,
    });
  }
  return out;
}

export function leaderYt(markets: OpportunityListing[], s: ScreenSettings, i: LeaderInput, pointsOnly: boolean): LeaderRow[] {
  const out: LeaderRow[] = [];
  for (const m of markets) {
    if (!eligible(m, s) || m.baseAPY === null || !Number.isFinite(m.baseAPY)) continue;
    if (pointsOnly && !m.hasPoints) continue;
    const D = m.daysToMaturity;
    const multiplier = m.points?.ytMultiplier ?? m.ytMultiplier ?? 1;
    const at = (h: number, shift = 0) =>
      simulateYt({
        capital: i.capital,
        underlyingPrice: 1,
        daysToMaturity: D,
        entryAPY: m.impliedAPY,
        baseAPY: (m.baseAPY as number) + shift,
        holdDays: h,
        exitAPY: m.impliedAPY,
        feePercent: s.feePercent,
        pointsPerDay: 0,
        ytMultiplier: multiplier,
        pointsBasis: 'usd',
        valuePerPoint: 0,
        yieldFeePercent: YT_YIELD_FEE_PCT[m.protocol] ?? 0,
        baseRateKind: BASE_RATE_KIND[m.protocol],
      });

    // Best exit day at today's implied APY; ties go to the longer hold (more points).
    let best = at(1);
    let bestDay = 1;
    let freeUntil: number | null = null;
    for (let h = 1; h <= D; h++) {
      const r = h === 1 ? best : at(h);
      if (r.cash >= best.cash) {
        best = r;
        bestDay = h;
      }
      if (r.cash >= 0) freeUntil = h;
    }
    const loss = -best.cashPercent;
    out.push({
      m,
      pnl: best.cash,
      pnlPercent: best.cashPercent,
      days: bestDay,
      annualized: annualize(best.cash, i.capital, bestDay),
      perDay: best.cash / bestDay,
      verdict: best.cash >= 0 ? 'free' : loss <= s.lossBudget ? 'cheap' : 'costly',
      // YT buys `notional` of yield exposure against the pool, not just the capital.
      tooBig: tooBig(m, best.notional, thresholds.liquidity.ytShareWarning),
      freeUntil,
      pointsExposure: best.notional * multiplier,
      perBasePoint: at(bestDay, 1).cash - best.cash,
    });
  }
  return out;
}

export type RankBy = 'total' | 'perDay';

export interface Buckets {
  topProfit: LeaderRow[];
  leastProfit: LeaderRow[];
  topLoss: LeaderRow[];
  leastLoss: LeaderRow[];
}

/**
 * Four lists of up to `n`: biggest and smallest profits (result ≥ 0), biggest and
 * smallest losses. The "smallest" lists skip rows already in the "biggest" ones,
 * so no market appears twice.
 */
export function buckets(rows: LeaderRow[], by: RankBy = 'total', n = 15): Buckets {
  const key = (r: LeaderRow) => (by === 'total' ? r.pnl : r.perDay);
  const gains = rows.filter((r) => r.pnl >= 0).sort((a, b) => key(b) - key(a));
  const losses = rows.filter((r) => r.pnl < 0).sort((a, b) => key(a) - key(b));
  const topProfit = gains.slice(0, n);
  const topLoss = losses.slice(0, n);
  return {
    topProfit,
    leastProfit: gains.slice(topProfit.length).reverse().slice(0, n),
    topLoss,
    leastLoss: losses.slice(topLoss.length).reverse().slice(0, n),
  };
}
