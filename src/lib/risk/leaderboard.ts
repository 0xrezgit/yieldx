import thresholds from '../../config/thresholds.json';
import { simulateYt } from '../calculators/trade';
import type { OpportunityListing, ScreenSettings } from './opportunities';

/**
 * YT dollar leaderboard («رتبه‌بندی دلاری YT»), kept beside the market analysis:
 * what a given capital earns or loses buying each market's YT.
 *
 * - YT is sold on its best day — the day with the highest cash result at today's
 *   implied APY — which can be well before maturity. The longest loss-free hold
 *   (points for free) is reported next to it.
 *
 * Every row carries the holding period, so a small profit over a long time can be
 * told apart from a good one: `annualized` and `perDay` normalise by time.
 */
export type Verdict = 'free' | 'cheap' | 'costly';

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
}

export interface LeaderInput {
  capital: number;
}

const annualize = (pnl: number, capital: number, days: number) => {
  const g = 1 + pnl / capital;
  return days > 0 && g > 0 ? (Math.pow(g, 365 / days) - 1) * 100 : pnl < 0 ? -100 : 0;
};

const tooBig = (m: OpportunityListing, capital: number) =>
  m.liquidity !== null && m.liquidity > 0 && capital / m.liquidity > thresholds.liquidity.positionShareWarning;

const eligible = (m: OpportunityListing, s: ScreenSettings) =>
  !m.expired && m.daysToMaturity >= s.minDays && m.impliedAPY > 0 && (m.liquidity === null || m.liquidity >= s.minLiquidity);

export function leaderYt(markets: OpportunityListing[], s: ScreenSettings, i: LeaderInput, pointsOnly: boolean): LeaderRow[] {
  const out: LeaderRow[] = [];
  for (const m of markets) {
    if (!eligible(m, s) || m.baseAPY === null || !Number.isFinite(m.baseAPY)) continue;
    if (pointsOnly && !m.hasPoints) continue;
    const D = m.daysToMaturity;
    const multiplier = m.points?.ytMultiplier ?? m.ytMultiplier ?? 1;
    const at = (h: number) =>
      simulateYt({
        capital: i.capital,
        underlyingPrice: 1,
        daysToMaturity: D,
        entryAPY: m.impliedAPY,
        baseAPY: m.baseAPY as number,
        holdDays: h,
        exitAPY: m.impliedAPY,
        feePercent: s.feePercent,
        pointsPerDay: 0,
        ytMultiplier: multiplier,
        pointsBasis: 'usd',
        valuePerPoint: 0,
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
      tooBig: tooBig(m, i.capital),
      freeUntil,
      pointsExposure: best.notional * multiplier,
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
