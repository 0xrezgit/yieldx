import thresholds from '../../config/thresholds.json';
import type { ExecQuote, Opportunity } from '../../types/opportunity';
import { BASE_RATE_KIND, simulateLoop, simulateYt, YT_YIELD_FEE_PCT } from '../calculators/trade';
import { ptOpportunity } from '../opportunity/from-market';
import { loopBorrowPct, PT_LEVERAGE_REASON, ptLenders, ptLoopLeverage } from '../opportunity/leverage';
import { rateAfterBorrow } from '../opportunity/curve';
import type { OpportunityListing, ScreenSettings } from './opportunities';
import { isLoopable, isStable } from './opportunities';

/**
 * Dollar leaderboards kept beside the market analysis («رتبه‌بندی دلاری YT» and
 * «رتبه‌بندی دلاری Loop PT»): what a given capital earns or loses in each market.
 *
 * - A PT loop is built only on a real lending market that takes this exact PT as
 *   collateral (the market analysis' own matching): its borrow rate after the user's
 *   borrow, its LLTV and its borrowable liquidity. Leverage follows the PT loop policy
 *   (`ptLoopLeverage`: 3× or 2.5× by the market's own live data); held to maturity. A PT without such a market gets no dollar figure — without a
 *   place to post the PT there is no loop. A loop liquidatable at entry (health below 1)
 *   or larger than the market can lend is left out and counted.
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
  /** Loop only: the lending market the loop is built on. */
  lender?: LoopLender;
  /** Unique row key (a PT can have several lending markets). */
  id?: string;
  /** Loop only: the leverage used (PT loop policy) and why. */
  leverage?: number;
  leverageReason?: string;
  /** Loop only: false when the PT's dollar peg rests only on its name (see `ptClassOf`). */
  pegVerified?: boolean;
  /** «executable»: entry from a quote for this capital; «suspect»: a doubtful input (see `doubts`). */
  confidence?: 'executable' | 'suspect';
  /** Suspect base yield: the result on the conservative and on the published value. */
  range?: { low: number; high: number };
  /** Why an input is doubtful, in Persian. */
  doubts?: string[];
}

export interface LoopLender {
  /** The lending market as its adapter names it, e.g. «USDC · وثیقه PT-… · LLTV ۹۱٫۵٪». */
  name: string;
  protocol: string;
  url: string | null;
  debtSymbol: string;
  /** Borrow rate after the user's own borrow, %. */
  borrowPct: number;
  /** Published borrow rate before it, %. */
  borrowNowPct: number;
  /** Whether the user's own borrow was modelled on the rate curve. */
  rateModelled: boolean;
  lltvPct: number;
  availableUsd: number | null;
}

export interface LoopBoard {
  rows: LeaderRow[];
  /** Loop candidates with no lending market for their PT in YieldX's sources: no dollar figure. */
  noLender: { m: OpportunityListing; pendleLoop: boolean }[];
  /** Loops left out: the policy allows no leverage at the market's LLTV, or it cannot lend enough. */
  liquidated: number;
  /** The PT's implied APY is broken: no dollar figure (lib/opportunity/health). */
  broken: { m: OpportunityListing; reasons: string[] }[];
  shortLiquidity: number;
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

/**
 * PT loops held to maturity on real lending markets. `lending` is the lending feed of
 * the market analysis (markets with a borrow side). Markets Pendle lists for looping,
 * or deep stablecoin markets, that have no lending market are returned in `noLender`.
 */
export function leaderLoop(markets: OpportunityListing[], s: ScreenSettings, lending: Opportunity[], i: LeaderInput, fetchedAt = new Date().toISOString()): LoopBoard {
  const board: LoopBoard = { rows: [], noLender: [], liquidated: 0, shortLiquidity: 0, broken: [] };
  for (const m of markets) {
    if (!(eligible(m, s) && m.daysToMaturity >= thresholds.opportunities.loopMinDays)) continue;
    if (m.impliedHealth?.status === 'broken') {
      board.broken.push({ m, reasons: m.impliedHealth.reasons });
      continue;
    }
    const pt = ptOpportunity(m.protocol, m, fetchedAt);
    const lenders = ptLenders(pt, lending);
    const doubts = m.impliedHealth?.status === 'suspect' ? m.impliedHealth.reasons : [];
    if (!lenders.length) {
      if (isLoopable(m) || (isStable(m) && (m.liquidity ?? 0) >= thresholds.opportunities.loopCandidateLiquidityUsd)) board.noLender.push({ m, pendleLoop: isLoopable(m) });
      continue;
    }
    const D = m.daysToMaturity;
    for (const { lender, collateral, debt: token } of lenders) {
      const side = lender.borrow!;
      const lltv = collateral.maxLtv * 100;
      // Today's rate or the 7-day average, whichever is higher.
      const now = loopBorrowPct(side) as number;
      // PT loop policy (shared with the market analysis): 3× or 2.5×, lower only for health or a rate jump.
      const { leverage: L, reason } = ptLoopLeverage({ impliedPct: m.impliedAPY, borrowPct: now, days: D, lltvPct: lltv, pegVerified: pt.ptClass?.pegVerified !== false, feePercent: s.feePercent });
      if (!(L > 1)) {
        board.liquidated++;
        continue;
      }
      const debt = i.capital * (L - 1);
      if (side.availableUsd !== null && debt > side.availableUsd) {
        board.shortLiquidity++;
        continue;
      }
      const after = side.curve ? rateAfterBorrow(side.curve, debt, now) : null;
      const rate = after ?? now;
      const r = simulateLoop({ capital: i.capital, daysToMaturity: D, entryAPY: m.impliedAPY, leverage: L, borrowAPY: rate, lltv, feePercent: s.feePercent });
      if (r.healthFactor < 1) {
        board.liquidated++;
        continue;
      }
      const annualized = annualize(r.profit, i.capital, D);
      board.rows.push({
        m,
        id: `${m.protocol}-${m.id}-${lender.key}`,
        leverage: L,
        leverageReason: PT_LEVERAGE_REASON[reason],
        pnl: r.profit,
        pnlPercent: (r.profit / i.capital) * 100,
        days: D,
        annualized,
        perDay: r.profit / D,
        verdict: fixedVerdict(annualized, i.hurdle ?? 8),
        // The loop buys `leverage` × capital of PT.
        tooBig: tooBig(m, i.capital * L),
        freeUntil: null,
        pointsExposure: null,
        health: Number.isFinite(r.healthFactor) ? r.healthFactor : null,
        pegVerified: pt.ptClass?.pegVerified !== false,
        ...(doubts.length ? { confidence: 'suspect' as const, doubts } : {}),
        lender: {
          name: lender.market.name,
          protocol: lender.protocol.name,
          url: lender.url ?? null,
          debtSymbol: token.symbol ?? '—',
          borrowPct: rate,
          borrowNowPct: now,
          rateModelled: after !== null,
          lltvPct: lltv,
          availableUsd: side.availableUsd,
        },
      });
    }
  }
  return board;
}

/** Markets kept out of the YT dollar ranking, and why: no dollar figure is shown for them. */
export interface YtExcluded {
  /** 0% base on a points market: the YT pays only in points. */
  pointsOnly: OpportunityListing[];
  /** The base yield or the implied APY is broken (lib/opportunity/health). */
  broken: { m: OpportunityListing; reasons: string[] }[];
}

export function ytExcluded(markets: OpportunityListing[], s: ScreenSettings): YtExcluded {
  const out: YtExcluded = { pointsOnly: [], broken: [] };
  for (const m of markets) {
    if (!eligible(m, s)) continue;
    if (m.baseHealth?.pointsOnly) out.pointsOnly.push(m);
    else if (m.baseHealth?.status === 'broken' || m.impliedHealth?.status === 'broken') out.broken.push({ m, reasons: [...(m.baseHealth?.status === 'broken' ? m.baseHealth.reasons : []), ...(m.impliedHealth?.status === 'broken' ? m.impliedHealth.reasons : [])] });
  }
  return out;
}

/**
 * YT on its best exit day. A suspect base yield is ranked on its conservative value (the
 * published one gives the top of the range); broken data and points-only markets are left
 * to `ytExcluded`. `quotes` (by market id) replace the mid entry price with the price an
 * executable quote for this capital actually pays.
 */
export function leaderYt(markets: OpportunityListing[], s: ScreenSettings, i: LeaderInput & { quotes?: Record<string, ExecQuote | null> }, pointsOnly: boolean): LeaderRow[] {
  const out: LeaderRow[] = [];
  for (const m of markets) {
    if (!eligible(m, s) || m.baseAPY === null || !Number.isFinite(m.baseAPY)) continue;
    if (pointsOnly && !m.hasPoints) continue;
    if (m.baseHealth?.pointsOnly || m.baseHealth?.status === 'broken' || m.impliedHealth?.status === 'broken') continue;
    const D = m.daysToMaturity;
    const multiplier = m.points?.ytMultiplier ?? m.ytMultiplier ?? 1;
    const q = i.quotes?.[m.id];
    // The YT price paid per unit of yield, dollars per dollar of underlying: capital ÷ (YT bought × unit USD).
    const entryPrice = q && q.side === 'yt' && Math.abs(q.usd - i.capital) <= i.capital * 0.05 && q.units > 0 && q.unitUsd > 0 ? i.capital / (q.units * q.unitUsd) : undefined;
    const suspect = m.baseHealth?.status === 'suspect';
    const published = m.baseAPY as number;
    const conservative = suspect ? Math.min(published, m.baseHealth?.conservativePct ?? published) : published;
    const run = (baseAPY: number) => (h: number, shift = 0) =>
      simulateYt({
        capital: i.capital,
        underlyingPrice: 1,
        daysToMaturity: D,
        entryAPY: m.impliedAPY,
        baseAPY: baseAPY + shift,
        holdDays: h,
        exitAPY: m.impliedAPY,
        feePercent: s.feePercent,
        pointsPerDay: 0,
        ytMultiplier: multiplier,
        pointsBasis: 'usd',
        valuePerPoint: 0,
        yieldFeePercent: YT_YIELD_FEE_PCT[m.protocol] ?? 0,
        baseRateKind: BASE_RATE_KIND[m.protocol],
        entryPrice,
      });
    const bestOf = (at: ReturnType<typeof run>) => {
      // Best exit day at today's implied APY; ties go to the longer hold (more points).
      let best = at(1);
      let day = 1;
      let freeUntil: number | null = null;
      for (let h = 1; h <= D; h++) {
        const r = h === 1 ? best : at(h);
        if (r.cash >= best.cash) {
          best = r;
          day = h;
        }
        if (r.cash >= 0) freeUntil = h;
      }
      return { best, day, freeUntil };
    };
    const at = run(conservative);
    const { best, day: bestDay, freeUntil } = bestOf(at);
    const high = suspect && conservative < published ? bestOf(run(published)).best.cash : null;
    const loss = -best.cashPercent;
    const doubts = [...(suspect ? (m.baseHealth?.reasons ?? []) : []), ...(m.impliedHealth?.status === 'suspect' ? m.impliedHealth.reasons : [])];
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
      ...(entryPrice !== undefined ? { confidence: 'executable' as const } : doubts.length ? { confidence: 'suspect' as const } : {}),
      ...(high !== null ? { range: { low: Math.min(best.cash, high), high: Math.max(best.cash, high) } } : {}),
      ...(doubts.length ? { doubts } : {}),
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
