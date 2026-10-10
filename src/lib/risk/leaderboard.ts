import thresholds from '../../config/thresholds.json';
import type { ExecQuote, Opportunity } from '../../types/opportunity';
import { BASE_RATE_KIND, simulateLoop, simulateYt, YT_YIELD_FEE_PCT } from '../calculators/trade';
import { MAX_POOL_SHARE_WITHOUT_QUOTE, quoteAmount } from '../opportunity/policy';
import { ptOpportunity } from '../opportunity/from-market';
import { loopBorrowPct, PT_LEVERAGE_REASON, ptLenders, ptLoopLeverage } from '../opportunity/leverage';
import { rateAfterBorrow } from '../opportunity/curve';
import type { OpportunityListing, ScreenSettings } from './opportunities';
import { isLoopable, isStable } from './opportunities';
import { quoteCheck } from '../opportunity/pt-price';
import { baseScenarios } from '../opportunity/base-scenarios';
import { ytFees } from '../calculators/yt-plan';

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

export interface YtScenarioRow {
  kind: 'low' | 'likely' | 'high';
  /** Base yield over the hold, % a year. */
  basePct: number;
  /** Yield received plus the sale before maturity, USD. */
  received: number;
  /** Cash result, USD. */
  cash: number;
  /** USD of yield exposure (what points and a points «APY» are counted on). */
  notional: number;
}

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
  /** YT only: the same sale under the low / likely / high base yield (lib/opportunity/base-scenarios). */
  scenarios?: YtScenarioRow[];
  /** YT only: the price an executable quote pays per unit of yield, when the row has one. */
  entryPrice?: number;
  /** Loop only: false when the PT's dollar peg rests only on its name (see `ptClassOf`). */
  pegVerified?: boolean;
  /** «executable»: entry from a quote for this capital; «suspect»: a doubtful input (see `doubts`). */
  confidence?: 'executable' | 'suspect';
  /** Suspect base yield: the result on the conservative and on the published value. */
  range?: { low: number; high: number };
  /** Why an input is doubtful, in Persian. */
  doubts?: string[];
  /**
   * Too large for the pool's mid price (more than MAX_POOL_SHARE_WITHOUT_QUOTE of it) and no
   * executable quote yet: the dollar figure is not shown. `quote` says what to ask for.
   */
  needsQuote?: { side: 'pt' | 'yt'; usd: number };
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

/** The key a quote is stored under for one market, side and amount. */
export const leaderQuoteKey = (marketId: string, side: 'pt' | 'yt', usd: number) => `${marketId}|${side}|${usd}`;

/** A quote that speaks for this amount (within 5%). */
const fits = (q: ExecQuote | null | undefined, side: 'pt' | 'yt', usd: number): q is ExecQuote => !!q && q.side === side && q.units > 0 && q.unitUsd > 0 && Math.abs(q.usd - usd) <= usd * 0.05;

/** More than the pool can take at its mid price without an executable quote. */
const overPool = (m: OpportunityListing, size: number) => m.liquidity === null || !(m.liquidity > 0) || size > m.liquidity * MAX_POOL_SHARE_WITHOUT_QUOTE;

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
export function leaderLoop(markets: OpportunityListing[], s: ScreenSettings, lending: Opportunity[], i: LeaderInput & { quotes?: Record<string, ExecQuote | null> }, fetchedAt = new Date().toISOString()): LoopBoard {
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
      // The loop buys leverage × capital of PT. Too much for the mid price: an executable PT quote
      // for that size gives the rate actually locked (its fee and impact are inside it).
      const size = quoteAmount(i.capital * L);
      const q = i.quotes?.[leaderQuoteKey(m.id, 'pt', size)];
      // A quote far from the market's own rate is a data error, not a price (see pt-price.ts).
      const quoted = fits(q, 'pt', size) && quoteCheck(q, m.impliedAPY, m.daysToMaturity).ok ? q : null;
      const entryAPY = quoted ? (Math.pow((quoted.units * quoted.unitUsd) / size, 365 / D) - 1) * 100 : m.impliedAPY;
      const r = simulateLoop({ capital: i.capital, daysToMaturity: D, entryAPY, leverage: L, borrowAPY: rate, lltv, feePercent: quoted ? 0 : s.feePercent });
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
        ...(doubts.length ? { confidence: 'suspect' as const, doubts } : quoted ? { confidence: 'executable' as const } : {}),
        ...(!quoted && overPool(m, i.capital * L) ? { needsQuote: { side: 'pt' as const, usd: size } } : {}),
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
 * The base a YT is ranked on: the on-chain one when base health measured it, else for a
 * suspect market the lower of the published figure and the conservative one; `capPct` keeps
 * the market's history under it (see base-scenarios).
 */
export function ytBaseOf(m: OpportunityListing): { basePct: number; capPct: number | null } {
  const published = m.baseAPY as number;
  const suspect = m.baseHealth?.status === 'suspect';
  const basePct = m.baseHealth?.rankPct ?? (suspect ? Math.min(published, m.baseHealth?.conservativePct ?? published) : published);
  return { basePct, capPct: suspect ? basePct : null };
}

/** How far the implied APY on the sale day is moved, both ways, for the YT's exit range (points). */
export const YT_EXIT_SHIFT_PP = 3;

/**
 * YT on its best exit day. A suspect base yield is ranked on its conservative value (the
 * published one gives the top of the range); broken data and points-only markets are left
 * to `ytExcluded`. `quotes` (by market id) replace the mid entry price with the price an
 * executable quote for this capital actually pays.
 */
export function leaderYt(markets: OpportunityListing[], s: ScreenSettings, i: LeaderInput & { quotes?: Record<string, ExecQuote | null> }, pointsOnly: boolean): LeaderRow[] {
  const usdQ = quoteAmount(i.capital);
  const out: LeaderRow[] = [];
  for (const m of markets) {
    if (!eligible(m, s) || m.baseAPY === null || !Number.isFinite(m.baseAPY)) continue;
    if (pointsOnly && !m.hasPoints) continue;
    if (m.baseHealth?.pointsOnly || m.baseHealth?.status === 'broken' || m.impliedHealth?.status === 'broken') continue;
    const D = m.daysToMaturity;
    const multiplier = m.points?.ytMultiplier ?? m.ytMultiplier ?? 1;
    const q = i.quotes?.[leaderQuoteKey(m.id, 'yt', usdQ)];
    // The YT price paid per unit of yield, dollars per dollar of underlying: capital ÷ (YT bought × unit USD).
    const entryPrice = fits(q, 'yt', i.capital) && quoteCheck(q, m.impliedAPY, D).ok ? i.capital / (q.units * q.unitUsd) : undefined;
    const suspect = m.baseHealth?.status === 'suspect';
    const published = m.baseAPY as number;
    // The on-chain base when health measured one (it can be above a published 0), else the lower of the two.
    const conservative = m.baseHealth?.rankPct ?? (suspect ? Math.min(published, m.baseHealth?.conservativePct ?? published) : published);
    // The base yield is never held at today's figure: the likely reading fades it into the
    // market's own level over the hold (lib/opportunity/base-scenarios), and that is ranked.
    const scen = (h: number) => baseScenarios(conservative, m.baseLevels, h, suspect ? conservative : null);
    // Each protocol's own fee (Pendle's AMM fee is on the whole yield exposure: ~2% of the capital
    // on a $1,000 YT buy, checked against its quote); the setting only where none is known.
    const fees = ytFees({ ...m, impliedPct: m.impliedAPY }, s.feePercent);
    const run = (baseFor: (h: number) => number) => (h: number, shift = 0, exitShift = 0) =>
      simulateYt({
        capital: i.capital,
        underlyingPrice: 1,
        daysToMaturity: D,
        entryAPY: m.impliedAPY,
        baseAPY: baseFor(h) + shift,
        holdDays: h,
        exitAPY: Math.max(0, m.impliedAPY + exitShift),
        feePercent: fees.entryPct,
        exitFeePercent: fees.exitPct(Math.max(0, m.impliedAPY + exitShift), D - Math.min(h, D)),
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
    const at = run((h) => scen(h).likely);
    const { best, day: bestDay, freeUntil } = bestOf(at);
    const s0 = scen(bestDay);
    const scenarios: YtScenarioRow[] = (['low', 'likely', 'high'] as const).map((kind) => {
      const r = kind === 'likely' ? best : run(() => s0[kind])(bestDay);
      return { kind, basePct: s0[kind], received: r.yieldEarned + r.saleValue, cash: r.cash, notional: r.notional };
    });
    const high = suspect && conservative < published ? bestOf(run(() => published)).best.cash : null;
    // A sale before maturity is priced at that day's implied APY, assumed unchanged: the range
    // shows the same sale with the market's rate `YT_EXIT_SHIFT_PP` lower or higher.
    const exitRange = bestDay < D ? [at(bestDay, 0, -YT_EXIT_SHIFT_PP).cash, at(bestDay, 0, YT_EXIT_SHIFT_PP).cash] : [];
    const spread = [best.cash, ...scenarios.map((x) => x.cash), ...(high !== null ? [high] : []), ...exitRange];
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
      scenarios,
      ...(entryPrice !== undefined ? { entryPrice } : {}),
      ...(entryPrice !== undefined ? { confidence: 'executable' as const } : doubts.length ? { confidence: 'suspect' as const } : {}),
      ...(spread.length > 1 ? { range: { low: Math.min(...spread), high: Math.max(...spread) } } : {}),
      ...(doubts.length ? { doubts } : {}),
      // A YT buy moves the pool by its notional: too large for the mid price without a quote.
      ...(entryPrice === undefined && overPool(m, best.notional) ? { needsQuote: { side: 'yt' as const, usd: usdQ } } : {}),
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
