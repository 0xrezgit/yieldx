import type { PointsBasis } from '../../types/market';
import { ptPriceFromAPY } from './implied-apy';
import { pointsEarned, pointsExposure } from './airdrop';

/**
 * Trade simulators for the opportunities page: buy YT or PT at one implied APY,
 * exit at another (or hold to maturity), and PT loops at a chosen leverage.
 *
 * Conventions (same as the rest of YieldX):
 *   PT(r, τ) = (1 + r)^(−τ/365),  YT = 1 − PT   (asset units, τ = days left)
 *   yield of one YT over h days = (1 + a)^(h/365) − 1 asset units (a = base APY)
 * A fee of `feePercent` is charged on every swap (entry and early exit); redeeming
 * at maturity is free. USD results assume the asset's USD price stays constant.
 */

const growth = (apy: number, days: number) => Math.pow(1 + apy / 100, days / 365) - 1;

/** APY implied by a PT price with `days` left. Unlike impliedAPYFromPT it also accepts PT ≥ 1 (negative APY). */
const apyFromPT = (pt: number, days: number) => (Math.pow(1 / pt, 365 / days) - 1) * 100;

/** YT price (asset units) at which the market implies `apy` with `days` left. */
export function ytPriceFromAPY(apy: number, days: number): number {
  return days > 0 ? 1 - ptPriceFromAPY(apy, days) : 0;
}

// ─── YT ────────────────────────────────────────────────────────────────────────

export interface YtTradeInput {
  capital: number;
  /** USD price of one asset unit (only matters for unit-based points). */
  underlyingPrice: number;
  daysToMaturity: number;
  /** Market implied APY when buying, %. */
  entryAPY: number;
  /** Underlying APY earned while holding, %. */
  baseAPY: number;
  /** Days held; ≥ daysToMaturity means holding to maturity. */
  holdDays: number;
  /** Market implied APY when selling, %. Ignored at maturity. */
  exitAPY: number;
  feePercent: number;
  pointsPerDay: number;
  ytMultiplier: number;
  pointsBasis: PointsBasis;
  /** USD value of one point. */
  valuePerPoint: number;
}

export interface YtTrade {
  entryPrice: number;
  units: number;
  /** USD value of the underlying whose yield the position receives. */
  notional: number;
  /** Notional per dollar invested. */
  leverage: number;
  heldDays: number;
  toMaturity: boolean;
  yieldEarned: number;
  exitPrice: number;
  saleValue: number;
  /** Yield + sale − capital, before any airdrop. */
  cash: number;
  cashPercent: number;
  points: number;
  airdrop: number;
  total: number;
  /** Exit is loss-free when the exit implied APY is at least this (−∞: any rate, +∞: none). */
  breakEvenExitAPY: number;
  /** USD value per point at which the airdrop covers the cash loss (0 when there is no loss). */
  breakEvenPointValue: number;
}

export function simulateYt(i: YtTradeInput): YtTrade {
  const D = Math.max(1, i.daysToMaturity);
  const h = Math.min(Math.max(0, i.holdDays), D);
  const fee = i.feePercent / 100;
  const toMaturity = h >= D;

  const entryPrice = ytPriceFromAPY(i.entryAPY, D);
  const units = (i.capital * (1 - fee)) / (entryPrice * i.underlyingPrice);
  const notional = units * i.underlyingPrice;
  const yieldEarned = notional * growth(i.baseAPY, h);
  const exitPrice = toMaturity ? 0 : ytPriceFromAPY(i.exitAPY, D - h);
  const saleValue = notional * exitPrice * (1 - fee);
  const cash = yieldEarned + saleValue - i.capital;

  const points = pointsEarned(pointsExposure(units, notional, i.pointsBasis), i.pointsPerDay, i.ytMultiplier, h);
  const airdrop = points * i.valuePerPoint;

  let breakEvenExitAPY: number;
  if (toMaturity) breakEvenExitAPY = cash >= 0 ? -Infinity : Infinity;
  else {
    const needed = (i.capital - yieldEarned) / (notional * (1 - fee)); // YT exit price that returns the capital
    breakEvenExitAPY = needed <= 0 ? -Infinity : needed >= 1 ? Infinity : apyFromPT(1 - needed, D - h);
  }

  return {
    entryPrice,
    units,
    notional,
    leverage: notional / i.capital,
    heldDays: h,
    toMaturity,
    yieldEarned,
    exitPrice,
    saleValue,
    cash,
    cashPercent: (cash / i.capital) * 100,
    points,
    airdrop,
    total: cash + airdrop,
    breakEvenExitAPY,
    breakEvenPointValue: cash >= 0 ? 0 : points > 0 ? -cash / points : Infinity,
  };
}

/**
 * Highest entry implied APY at which `resultPercent(entryAPY)` still reaches `target`.
 * Scans upward from ~0 (where a YT is nearly free and the result is large) and
 * refines the first crossing by bisection. Returns null when no entry rate reaches
 * the target, Infinity when every rate up to 500% does.
 */
export function maxEntryAPY(resultPercent: (entryAPY: number) => number, target: number): number | null {
  const LO = 0.01;
  const HI = 500;
  const STEP = 0.25;
  if (!(resultPercent(LO) >= target)) return null;
  let ok = LO;
  for (let r = LO + STEP; r <= HI; r += STEP) {
    if (resultPercent(r) >= target) {
      ok = r;
      continue;
    }
    let lo = ok;
    let hi = r;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (resultPercent(mid) >= target) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  return Infinity;
}

/**
 * Entry limits for a YT strategy: the implied APY at or below which buying loses
 * nothing (`free`) or at most `lossBudget`% of capital (`budget`). The exit happens
 * at the same implied APY as the entry — the market doesn't have to move in your favour.
 */
export function ytEntryLimits(
  i: Omit<YtTradeInput, 'entryAPY' | 'exitAPY'>,
  lossBudget: number,
): { free: number | null; budget: number | null } {
  const f = (r: number) => simulateYt({ ...i, entryAPY: r, exitAPY: r }).cashPercent;
  return { free: maxEntryAPY(f, 0), budget: maxEntryAPY(f, -Math.max(0, lossBudget)) };
}

// ─── PT ────────────────────────────────────────────────────────────────────────

export interface PtTradeInput {
  capital: number;
  daysToMaturity: number;
  entryAPY: number;
  /** Days held; ≥ daysToMaturity means redeeming at maturity. */
  holdDays: number;
  exitAPY: number;
  feePercent: number;
}

export interface PtTrade {
  entryPrice: number;
  /** PT bought per dollar of capital × capital, in USD face value at maturity. */
  faceValue: number;
  heldDays: number;
  toMaturity: boolean;
  exitPrice: number;
  value: number;
  profit: number;
  profitPercent: number;
  /** Profit annualised over the days held, %. */
  annualized: number;
  /** Exit is loss-free when the exit implied APY is at most this, %. */
  breakEvenExitAPY: number;
}

export function simulatePt(i: PtTradeInput): PtTrade {
  const D = Math.max(1, i.daysToMaturity);
  const h = Math.min(Math.max(0, i.holdDays), D);
  const fee = i.feePercent / 100;
  const toMaturity = h >= D;

  const entryPrice = ptPriceFromAPY(i.entryAPY, D);
  const faceValue = (i.capital * (1 - fee)) / entryPrice;
  const exitPrice = toMaturity ? 1 : ptPriceFromAPY(i.exitAPY, D - h);
  const value = toMaturity ? faceValue : faceValue * exitPrice * (1 - fee);
  const profit = value - i.capital;
  const growthFactor = value / i.capital;

  const needed = i.capital / (faceValue * (1 - fee)); // PT exit price that returns the capital
  const breakEvenExitAPY = toMaturity ? (profit >= 0 ? Infinity : -Infinity) : apyFromPT(needed, D - h);

  return {
    entryPrice,
    faceValue,
    heldDays: h,
    toMaturity,
    exitPrice,
    value,
    profit,
    profitPercent: (profit / i.capital) * 100,
    annualized: h > 0 && growthFactor > 0 ? (Math.pow(growthFactor, 365 / h) - 1) * 100 : NaN,
    breakEvenExitAPY,
  };
}

// ─── PT loop ───────────────────────────────────────────────────────────────────

export interface LoopTradeInput {
  capital: number;
  daysToMaturity: number;
  /** PT implied APY at entry, %. */
  entryAPY: number;
  /** Total PT exposure / own capital. 1 = no borrowing. */
  leverage: number;
  borrowAPY: number;
  /** Liquidation LTV of the money market, %. */
  lltv: number;
  feePercent: number;
}

export interface LoopTrade {
  /** PT redeemable at maturity, USD face value. */
  faceValue: number;
  /** Market value of the PT collateral today. */
  collateralValue: number;
  debt: number;
  /** Debt / collateral today, %. */
  ltv: number;
  healthFactor: number;
  /** Debt / collateral at maturity (PT at par, debt with interest), %. */
  maturityLTV: number;
  /** PT price at which the position is liquidated (market-priced collateral). */
  liquidationPTPrice: number;
  /** Market implied APY at which the position is liquidated, %; −∞ when already liquidatable. */
  liquidationAPY: number;
  payout: number;
  profit: number;
  netAPY: number;
  /** Borrow APY at which the loop earns nothing, %; NaN when it loses even at 0% borrow. */
  breakEvenBorrowAPY: number;
  /** Net APY without leverage (plain PT), for comparison. */
  unleveredAPY: number;
}

export function simulateLoop(i: LoopTradeInput): LoopTrade {
  const D = Math.max(1, i.daysToMaturity);
  const t = D / 365;
  const L = Math.max(1, i.leverage);
  const fee = i.feePercent / 100;
  const lltv = i.lltv / 100;

  const p0 = ptPriceFromAPY(i.entryAPY, D);
  const debt = i.capital * (L - 1);
  const collateralValue = i.capital * L * (1 - fee);
  const faceValue = collateralValue / p0;
  const debtAtMaturity = debt * (1 + growth(i.borrowAPY, D));
  const payout = faceValue - debtAtMaturity;
  const profit = payout - i.capital;

  const liquidationPTPrice = debt > 0 && lltv > 0 ? debt / (faceValue * lltv) : 0;
  const liquidationAPY =
    debt <= 0 ? Infinity : liquidationPTPrice >= p0 ? -Infinity : apyFromPT(liquidationPTPrice, D);
  const annual = (g: number) => (g > 0 ? (Math.pow(g, 1 / t) - 1) * 100 : -100);

  return {
    faceValue,
    collateralValue,
    debt,
    ltv: collateralValue > 0 ? (debt / collateralValue) * 100 : 0,
    healthFactor: debt > 0 ? (lltv * collateralValue) / debt : Infinity,
    maturityLTV: faceValue > 0 ? (debtAtMaturity / faceValue) * 100 : 0,
    liquidationPTPrice,
    liquidationAPY,
    payout,
    profit,
    netAPY: annual(payout / i.capital),
    breakEvenBorrowAPY:
      debt <= 0 ? Infinity : faceValue > i.capital ? (Math.pow((faceValue - i.capital) / debt, 1 / t) - 1) * 100 : NaN,
    unleveredAPY: annual((1 - fee) / p0),
  };
}

/** Highest leverage that keeps the health factor at `minHealth` or above. */
export function maxLoopLeverage(lltv: number, minHealth: number, feePercent = 0): number {
  const maxLtv = lltv / 100 / Math.max(1, minHealth);
  // LTV = (L − 1) / (L (1 − fee))  ⇒  L = 1 / (1 − LTV (1 − fee))
  const denom = 1 - maxLtv * (1 - feePercent / 100);
  return denom > 0 ? 1 / denom : Infinity;
}
