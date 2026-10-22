/**
 * PendleLoop Long/Short: a price view built on a lending market, not a perpetual.
 *
 *   Long  — collateral: the asset, debt: dollars. Leverage L = exposure ÷ equity.
 *           collateral = L × E of the asset, debt = (L − 1) × E.
 *           health = LLTV × L ÷ (L − 1); liquidation at price₀ × (L − 1) ÷ (L × LLTV).
 *   Short — collateral: dollars, debt: the asset. Leverage L = short exposure ÷ equity.
 *           collateral = (1 + L) × E, debt = L × E of the asset.
 *           health = LLTV × (1 + L) ÷ L; liquidation at price₀ × LLTV × (1 + L) ÷ L.
 *
 * PendleLoop's «Health Factor %» is the distance to liquidation, 1 − 1 ÷ health (checked
 * against its own screens: long 4× at LLTV 86% → 12.79%, short 2.6× at LLTV 78% → 7.41%).
 * Its holding cost per year, on the equity: long L × yield − (L − 1) × borrow; short
 * (1 + L) × yield − L × borrow.
 *
 * The perpetual beside it (Hyperliquid) pays or charges funding on the whole position
 * and is liquidated at its maintenance margin — half the margin at its highest leverage.
 * A rough line, for comparison: no fee tiers, no ADL, funding held at its 7-day average.
 */

import type { LongShortRow, PerpRef } from './types';

export interface LongShortInput {
  capital: number;
  leverage: number;
  days: number;
  /** Swap cost (fee + price impact) on what is swapped to open or close the loop, % each way. */
  swapPct: number;
  /** Perp trading fee on the position, % each way. */
  perpFeePct: number;
}

export const LEVERAGE_MIN = 1.1;

/** PendleLoop's own cap, as its screen shows it (one decimal, rounded down). */
export const maxLeverageOf = (row: Pick<LongShortRow, 'maxLeverage'>) => Math.max(LEVERAGE_MIN, Math.floor(row.maxLeverage * 10 + 1e-9) / 10);

export const leverageOf = (row: Pick<LongShortRow, 'maxLeverage'>, asked: number) =>
  Math.min(Math.max(LEVERAGE_MIN, Number.isFinite(asked) ? asked : LEVERAGE_MIN), maxLeverageOf(row));

/** The borrow rate the model holds: today's or the 7-day average, whichever is higher. */
export const borrowPctOf = (row: Pick<LongShortRow, 'borrowNowPct' | 'borrow7dPct'>) => Math.max(row.borrowNowPct, row.borrow7dPct ?? -Infinity);

export function healthOf(side: LongShortRow['side'], L: number, lltv: number) {
  return side === 'long' ? (L > 1 ? (lltv * L) / (L - 1) : Infinity) : (lltv * (1 + L)) / L;
}

/** Liquidation price ÷ today's price. */
export function liqRatioOf(side: LongShortRow['side'], L: number, lltv: number) {
  return side === 'long' ? (L > 1 ? (L - 1) / (L * lltv) : 0) : (lltv * (1 + L)) / L;
}

/** Holding cost (negative) or income per year, % of the equity, at an unchanged price. */
export function holdingPctOf(side: LongShortRow['side'], L: number, yieldPct: number, borrowPct: number) {
  return side === 'long' ? L * yieldPct - (L - 1) * borrowPct : (1 + L) * yieldPct - L * borrowPct;
}

/** Morpho's liquidation incentive for an LLTV: min(1.15, 1 ÷ (0.3 × LLTV + 0.7)) − 1. Null elsewhere (not published). */
export const liqPenaltyOf = (row: Pick<LongShortRow, 'protocol' | 'lltv'>) => (row.protocol.toLowerCase() === 'morpho' ? Math.min(1.15, 1 / (0.3 * row.lltv + 0.7)) - 1 : null);

/** The perp's move to liquidation (fraction, signed), from its maintenance margin; null above its highest leverage. */
export function perpLiqMoveOf(side: LongShortRow['side'], L: number, perpMaxLeverage: number) {
  if (!(perpMaxLeverage > 0) || L > perpMaxLeverage) return null;
  const mm = 1 / (2 * perpMaxLeverage);
  return side === 'long' ? (mm - 1 / L) / (1 - mm) : (1 / L - mm) / (1 + mm);
}

/** Funding per year on the equity, %: a long pays positive funding, a short receives it. */
export const perpHoldingPctOf = (side: LongShortRow['side'], L: number, fundingPct: number) => (side === 'long' ? -L * fundingPct : L * fundingPct);

export interface Outcome {
  /** Price move from today, fraction. */
  move: number;
  pnl: number;
  liquidated: boolean;
  /** The same move on the perp (straight path, funding at its average); null without one. */
  perpPnl: number | null;
  perpLiquidated: boolean;
}

export interface LongShortAnalysis {
  leverage: number;
  capped: boolean;
  exposureUsd: number;
  health: number;
  /** PendleLoop's «Health Factor %». */
  healthPct: number;
  liqPriceUsd: number;
  /** Move to liquidation from today, fraction (negative for a long). */
  liqMove: number;
  borrowPct: number;
  holdingPct: number;
  /** Holding over the period, plus opening and closing swaps, USD. */
  holdingUsd: number;
  tradeCostUsd: number;
  /** Price move that pays the period's costs (positive: the price has to go your way by this much). */
  breakEvenMove: number;
  /** Liquidation price at the end of the period with only interest moving it. */
  liqPriceEndUsd: number;
  liqPenalty: number | null;
  outcomes: Outcome[];
  perp: PerpAnalysis | null;
}

export interface PerpAnalysis {
  ref: PerpRef;
  fundingPct: number;
  holdingPct: number;
  holdingUsd: number;
  tradeCostUsd: number;
  liqMove: number | null;
  /** Total cost over the period, PendleLoop minus perp (negative: PendleLoop is cheaper). */
  costGapUsd: number;
}

const MOVES = [-0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3];

export function analyzeLongShort(row: LongShortRow, i: LongShortInput, moves = MOVES): LongShortAnalysis {
  const L = leverageOf(row, i.leverage);
  const E = Math.max(0, i.capital);
  const t = Math.max(0, i.days) / 365;
  const borrowPct = borrowPctOf(row);
  const g = (pct: number) => Math.pow(1 + pct / 100, t);
  const gc = g(row.collateralYieldPct);
  const gb = g(borrowPct);
  const holdingPct = holdingPctOf(row.side, L, row.collateralYieldPct, borrowPct);
  // What is swapped: a long buys the borrowed (L − 1) × E of the asset; a short sells the borrowed L × E.
  const swapped = E * (row.side === 'long' ? L - 1 : L);
  const tradeCostUsd = 2 * swapped * (Math.max(0, i.swapPct) / 100) + E * L * row.feeRate;
  // Collateral and debt at the end, in today's dollars per unit of equity (price moves apply to the asset side).
  const end = (move: number) => {
    const p = 1 + move;
    return row.side === 'long' ? { c: L * gc * p, d: (L - 1) * gb } : { c: (1 + L) * gc, d: L * gb * p };
  };
  const flat = end(0);
  const holdingUsd = E * (flat.c - flat.d - 1);
  const penalty = liqPenaltyOf(row);
  const outcomes: Outcome[] = moves.map((move) => {
    const { c, d } = end(move);
    if (d > 0 && d / c >= row.lltv) {
      // Liquidated on the way: what is left at the liquidation point (debt = LLTV × collateral there),
      // less the liquidator's incentive on that debt when known. The dollar side is the fixed one.
      const debtAtLiq = row.side === 'long' ? d : row.lltv * c;
      const left = debtAtLiq * (1 / row.lltv - 1) - (penalty ?? 0) * debtAtLiq;
      return { move, pnl: E * Math.max(0, left) - E - tradeCostUsd / 2, liquidated: true, perpPnl: null, perpLiquidated: false };
    }
    return { move, pnl: E * (c - d - 1) - tradeCostUsd, liquidated: false, perpPnl: null, perpLiquidated: false };
  });
  const liqRatio = liqRatioOf(row.side, L, row.lltv);
  const liqRatioEnd = row.side === 'long' ? ((L - 1) * gb) / (L * gc * row.lltv) : (row.lltv * (1 + L) * gc) / (L * gb);
  const costUsd = tradeCostUsd - holdingUsd;
  const exposure = E * L;
  const breakEvenMove = exposure > 0 ? costUsd / exposure : 0;
  const health = healthOf(row.side, L, row.lltv);
  let perp: PerpAnalysis | null = null;
  if (row.perp) {
    const fundingPct = row.perp.funding7dPct ?? row.perp.fundingNowPct;
    const pHolding = perpHoldingPctOf(row.side, L, fundingPct);
    const pHoldingUsd = E * (Math.pow(1 + pHolding / 100, t) - 1);
    const pTrade = 2 * exposure * (Math.max(0, i.perpFeePct) / 100);
    const liqMove = perpLiqMoveOf(row.side, L, row.perp.maxLeverage);
    perp = { ref: row.perp, fundingPct, holdingPct: pHolding, holdingUsd: pHoldingUsd, tradeCostUsd: pTrade, liqMove, costGapUsd: costUsd - (pTrade - pHoldingUsd) };
    const sign = row.side === 'long' ? 1 : -1;
    for (const o of outcomes) {
      if (liqMove === null) continue;
      // Past its maintenance margin the perp is closed: the margin is gone (its liquidation fee aside).
      o.perpLiquidated = sign * o.move <= sign * liqMove;
      o.perpPnl = o.perpLiquidated ? -E : sign * exposure * o.move + pHoldingUsd - pTrade;
    }
  }
  return {
    leverage: L,
    capped: L < i.leverage - 1e-9,
    exposureUsd: exposure,
    health,
    healthPct: Number.isFinite(health) ? 1 - 1 / health : 1,
    liqPriceUsd: row.priceUsd * liqRatio,
    liqMove: liqRatio - 1,
    borrowPct,
    holdingPct,
    holdingUsd,
    tradeCostUsd,
    breakEvenMove: row.side === 'long' ? breakEvenMove : -breakEvenMove,
    liqPriceEndUsd: row.priceUsd * liqRatioEnd,
    liqPenalty: penalty,
    outcomes,
    perp,
  };
}

/** Is the stock market (the oracle's source) open at `nowSec`, and when does that change? */
export function marketClock(hours: LongShortRow['marketHours'], nowSec: number): { open: boolean; next: number | null } | null {
  if (!hours.length) return null;
  const sorted = [...hours].sort((a, b) => a.open - b.open);
  const now = sorted.find((h) => h.open <= nowSec && nowSec < h.close);
  if (now) return { open: true, next: now.close };
  const upcoming = sorted.find((h) => h.open > nowSec);
  return { open: false, next: upcoming?.open ?? null };
}
