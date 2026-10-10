import thresholds from '../../config/thresholds.json';
import type { MarketListing } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import { ptPriceFromAPY } from '../calculators/implied-apy';
import { baseScenarios } from '../opportunity/base-scenarios';
import { ytFees } from '../calculators/yt-plan';
import { BASE_RATE_KIND, simulateLoop, simulateYt, ytEntryLimits, ytPriceFromAPY, YT_YIELD_FEE_PCT } from '../calculators/trade';
import { formatNumber, formatUSDCompact } from '../utils/formatting';

/**
 * Ranks live markets from every protocol for three strategies: YT for points,
 * fixed-rate PT, and PT looping. Everything here works from the list rows alone
 * (implied APY, base APY, days left, liquidity), so the whole board can be scored
 * without fetching each market.
 */
export type OpportunityListing = MarketListing & { protocol: ProtocolId };

const T = thresholds.opportunities;

export interface ScreenSettings {
  /** 'maturity': hold YT to maturity. 'roundtrip': sell after holdDays at the entry rate. */
  ytMode: 'maturity' | 'roundtrip';
  holdDays: number;
  /** Largest accepted YT cash loss, % of capital. */
  lossBudget: number;
  /** Swap fee / slippage per trade, %. */
  feePercent: number;
  minLiquidity: number;
  minDays: number;
}

export const defaultScreenSettings: ScreenSettings = {
  ytMode: 'roundtrip',
  holdDays: 30,
  lossBudget: 10,
  feePercent: thresholds.exit.costPercent,
  minLiquidity: 100_000,
  minDays: 7,
};

const STABLE_TAGS = new Set(['stables', 'stablecoins', 'stable', 'usd']);
const STABLE_NAME = /usd|dai|gho|frax|eur|lusd|crvusd|usde|usdc|usdt/i;

/** The protocol itself tags the market as a stablecoin market. */
export const stableTagged = (m: Pick<MarketListing, 'categories'>) => m.categories.some((c) => STABLE_TAGS.has(c));

export const isStable = (m: Pick<MarketListing, 'categories' | 'name'>) => stableTagged(m) || STABLE_NAME.test(m.name);

/** Pendle lists these markets on its PT-looping page (money market accepts the PT). */
export const isLoopable = (m: Pick<MarketListing, 'categories'>) => m.categories.includes('pt-looping');

/**
 * Why a market is left out of the boards and the ranking, in plain Persian —
 * shown in the calculator so a market picked by hand is never mistaken for a
 * ranked opportunity. Empty when it qualifies.
 */
export function rankingExclusions(m: OpportunityListing, s: ScreenSettings): string[] {
  const out: string[] = [];
  if (m.expired) out.push('سررسید شده است');
  else if (m.daysToMaturity < s.minDays) out.push(`کمتر از ${formatNumber(s.minDays, 0)} روز تا سررسید مانده`);
  if (!(m.impliedAPY > 0)) out.push('نرخ بازار (Implied) صفر یا نامعتبر است');
  if (m.liquidity !== null && m.liquidity < s.minLiquidity) out.push(`نقدینگی ${formatUSDCompact(m.liquidity)} کمتر از حداقل ${formatUSDCompact(s.minLiquidity)} است`);
  if (m.baseAPY === null || !Number.isFinite(m.baseAPY)) out.push('بازده پایه از API نیامده یا نامعتبر است (برای YT لازم است)');
  return out;
}

const tradable = (m: OpportunityListing, s: ScreenSettings) =>
  !m.expired && m.daysToMaturity >= s.minDays && (m.liquidity === null || m.liquidity >= s.minLiquidity);

// ─── YT for points ─────────────────────────────────────────────────────────────

export type YtZone = 'free' | 'budget' | 'expensive';

export interface YtOpportunity {
  m: OpportunityListing;
  ytPrice: number;
  /** Notional per dollar (yield + points exposure). */
  leverage: number;
  multiplier: number;
  /** Days the strategy holds the YT. */
  holdDays: number;
  /** Cash result of the strategy at today's rates, % of capital (before airdrop). */
  cashPercent: number;
  /** Entry implied APY at or below which the strategy loses nothing. */
  freeLimit: number | null;
  /** Entry implied APY at or below which the loss stays within the budget. */
  budgetLimit: number | null;
  zone: YtZone;
  /**
   * Cash cost per $1,000 of multiplier-weighted exposure per day. Negative means
   * the position pays you to collect points. Comparable across markets.
   */
  costPerKDay: number;
  /** Round trip only: exit implied APY needed to break even, %. */
  exitBreakEvenAPY: number | null;
}

export function screenYt(markets: OpportunityListing[], s: ScreenSettings, pointsOnly = true): YtOpportunity[] {
  const out: YtOpportunity[] = [];
  for (const m of markets) {
    if (!tradable(m, s) || m.baseAPY === null || !Number.isFinite(m.baseAPY) || !(m.impliedAPY > 0)) continue;
    if (pointsOnly && !m.hasPoints) continue;

    const D = m.daysToMaturity;
    const holdDays = s.ytMode === 'maturity' ? D : Math.min(s.holdDays, D);
    const multiplier = m.points?.ytMultiplier ?? m.ytMultiplier ?? 1;
    const fees = ytFees({ ...m, impliedPct: m.impliedAPY }, s.feePercent);
    const base = {
      capital: 1000,
      underlyingPrice: 1,
      daysToMaturity: D,
      // Today's base fades into the market's own level over the hold (lib/opportunity/base-scenarios).
      baseAPY: baseScenarios(m.baseAPY, m.baseLevels, holdDays).likely,
      holdDays,
      feePercent: fees.entryPct,
      exitFeePercent: fees.exitPct(m.impliedAPY, D - Math.min(holdDays, D)),
      pointsPerDay: 0,
      ytMultiplier: multiplier,
      pointsBasis: 'usd' as const,
      valuePerPoint: 0,
      yieldFeePercent: YT_YIELD_FEE_PCT[m.protocol] ?? 0,
      baseRateKind: BASE_RATE_KIND[m.protocol],
    };
    const trade = simulateYt({ ...base, entryAPY: m.impliedAPY, exitAPY: m.impliedAPY });
    const limits = ytEntryLimits(base, s.lossBudget);
    const zone: YtZone = trade.cashPercent >= 0 ? 'free' : trade.cashPercent >= -s.lossBudget ? 'budget' : 'expensive';
    const exposureDays = trade.leverage * multiplier * holdDays;

    out.push({
      m,
      ytPrice: ytPriceFromAPY(m.impliedAPY, D),
      leverage: trade.leverage,
      multiplier,
      holdDays,
      cashPercent: trade.cashPercent,
      freeLimit: limits.free,
      budgetLimit: limits.budget,
      zone,
      costPerKDay: exposureDays > 0 ? ((-trade.cashPercent / 100) / exposureDays) * 1000 : Infinity,
      exitBreakEvenAPY: trade.toMaturity ? null : trade.breakEvenExitAPY,
    });
  }
  const zoneRank: Record<YtZone, number> = { free: 0, budget: 1, expensive: 2 };
  return out.sort((a, b) => zoneRank[a.zone] - zoneRank[b.zone] || a.costPerKDay - b.costPerKDay);
}

// ─── Fixed-rate PT ─────────────────────────────────────────────────────────────

/** 'unknown': the floating (base) rate is missing, so no comparison is claimed. */
export type PtZone = 'strong' | 'fair' | 'weak' | 'unknown';

export interface PtOpportunity {
  m: OpportunityListing;
  ptPrice: number;
  /** Implied − base, percentage points (null when base is unknown). */
  spread: number | null;
  /** Fixed return to maturity after the entry fee, % of capital. */
  returnToMaturity: number;
  zone: PtZone;
  /** Suggested limit: buy at implied APY ≥ this (PT price ≤ limitPrice). */
  limitAPY: number;
  limitPrice: number;
  /** Suspiciously high fixed rate — usually priced-in risk (depeg, credit, lockups). */
  highRate: boolean;
}

export function screenPt(markets: OpportunityListing[], s: ScreenSettings): PtOpportunity[] {
  return markets
    .filter((m) => tradable(m, s) && m.impliedAPY > 0)
    .map((m) => {
      const D = m.daysToMaturity;
      const ptPrice = ptPriceFromAPY(m.impliedAPY, D);
      const spread = m.baseAPY === null || !Number.isFinite(m.baseAPY) ? null : m.impliedAPY - m.baseAPY;
      const zone: PtZone =
        spread === null ? 'unknown' : spread >= T.ptMarginPP ? 'strong' : spread <= -T.ptMarginPP ? 'weak' : 'fair';
      // Locking a fixed rate is worth it when it beats the floating rate by the margin.
      const limitAPY = spread === null ? m.impliedAPY : Math.max(m.impliedAPY, (m.baseAPY as number) + T.ptMarginPP);
      return {
        m,
        ptPrice,
        spread,
        returnToMaturity: ((1 - s.feePercent / 100) / ptPrice - 1) * 100,
        zone,
        limitAPY,
        limitPrice: ptPriceFromAPY(limitAPY, D),
        highRate: m.impliedAPY >= T.ptHighRateWarn,
      };
    })
    .sort((a, b) => Number(a.highRate) - Number(b.highRate) || b.m.impliedAPY - a.m.impliedAPY);
}

// ─── PT loop ───────────────────────────────────────────────────────────────────

export interface LoopSettings {
  leverage: number;
  borrowAPY: number;
  /** Liquidation LTV, %. */
  lltv: number;
}

export const defaultLoopSettings: LoopSettings = { leverage: 3, borrowAPY: 5.5, lltv: 86 };

export interface LoopOpportunity {
  m: OpportunityListing;
  /** Listed on Pendle's PT-looping page; otherwise a stablecoin candidate to verify. */
  listed: boolean;
  netAPY: number;
  unleveredAPY: number;
  breakEvenBorrowAPY: number;
  healthFactor: number;
  liquidationAPY: number;
  risky: boolean;
}

export function screenLoop(markets: OpportunityListing[], s: ScreenSettings, l: LoopSettings): LoopOpportunity[] {
  return markets
    .filter(
      (m) =>
        tradable(m, s) &&
        m.impliedAPY > 0 &&
        m.daysToMaturity >= T.loopMinDays &&
        (isLoopable(m) || (isStable(m) && (m.liquidity ?? 0) >= T.loopCandidateLiquidityUsd)),
    )
    .map((m) => {
      const r = simulateLoop({
        capital: 1000,
        daysToMaturity: m.daysToMaturity,
        entryAPY: m.impliedAPY,
        leverage: l.leverage,
        borrowAPY: l.borrowAPY,
        lltv: l.lltv,
        feePercent: s.feePercent,
      });
      return {
        m,
        listed: isLoopable(m),
        netAPY: r.netAPY,
        unleveredAPY: r.unleveredAPY,
        breakEvenBorrowAPY: r.breakEvenBorrowAPY,
        healthFactor: r.healthFactor,
        liquidationAPY: r.liquidationAPY,
        risky: r.healthFactor < T.loopMinHealth,
      };
    })
    .sort((a, b) => Number(b.listed) - Number(a.listed) || b.netAPY - a.netAPY);
}
