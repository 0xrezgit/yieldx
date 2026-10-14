/**
 * Multiply on a volatile collateral (SOL, JLP, cbBTC, tokenised stocks…) against a
 * dollar debt: a leveraged long. Its result is the price path, not the rates — so it
 * is never in the dollar ranking. This model answers two questions instead:
 *
 *  1. Where is liquidation?  LTV = debt ÷ (collateral × price) reaches the liquidation
 *     LTV. At the start: price_liq = price₀ × (L − 1) ÷ (L × liqLtv).
 *  2. What happens along six price paths, under five ways of managing the position?
 *
 * Paths are sized by the pair's own volatility (σ of the collateral/debt price ratio,
 * from the last 90 days), so a stock token and a memecoin-like asset are not given
 * the same «−20 %». The amplitude is k × σ × √(days ÷ 365), with a floor and a cap.
 *
 * Simulated day by day, in debt units (the debt is a dollar):
 *   collateral units grow at the collateral's yield, the debt at the borrow rate;
 *   the price moves along the path; then the strategy acts; then liquidation is
 *   checked as the protocol does it: a liquidator repays part of the debt
 *   (close factor) and takes that much collateral plus the liquidation bonus, until
 *   the LTV is back under the limit. A strategy acting once a day cannot dodge a
 *   move inside the day — a crash is a gap, and the model shows that.
 */

import { formatNumber, formatPercent } from '../utils/formatting';

export interface MultiplyPairInput {
  /** Collateral's own yield plus its supply APY, % per year. */
  collateralYieldPct: number;
  /** Borrow rate, % per year (held constant). */
  borrowPct: number;
  /** Liquidation LTV and the protocol's borrowing limit (max LTV), 0…1. */
  liqLtv: number;
  maxLtv: number;
  /** Liquidator's bonus (fraction of the debt repaid), and the share of debt one liquidation may repay. */
  liqBonus: number;
  closeFactor: number;
  /** Annualised volatility of the collateral/debt price ratio, %. */
  volPct: number;
  /** Kamino's flash-loan fee on what one-click Multiply borrows to open or rebalance, fraction. */
  flashFee?: number;
}

export interface MultiplySettings {
  capital: number;
  leverage: number;
  days: number;
  /** Swap cost per rebalance or exit (fee + slippage), % of the amount swapped. */
  swapPct: number;
}

export type ScenarioId = 'crash' | 'bear' | 'chop' | 'dip' | 'bull' | 'rally';
export type StrategyId = 'spot' | 'hold' | 'guard' | 'constant' | 'stop';

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** What the path looks like. */
  text: string;
  /** What managing the position means on this path. */
  lesson: string;
  /** Path as a multiple of σ√t at each moment u ∈ [0, 1] (log-price). */
  shape: (u: number) => number;
}

export interface Strategy {
  id: StrategyId;
  title: string;
  text: string;
}

/** Health line the «guard» strategy defends: LTV ≤ liqLtv ÷ 1.15. */
export const GUARD_TRIGGER = 1.15;
/** «guard» deleverages back to this health. */
export const GUARD_TARGET = 1.4;
/** «constant» rebalances when leverage drifts this far (relative) from the target. */
export const CONSTANT_BAND = 0.1;
/** «stop» closes the position at this loss of the capital. */
export const STOP_LOSS = 0.3;
/** Path amplitude bounds: one σ√t move is at least 5 % and at most 60 %. */
const AMP_MIN = 0.05;
const AMP_MAX = 0.6;

export const SCENARIOS: Scenario[] = [
  {
    id: 'crash',
    title: 'سقوط ناگهانی',
    text: 'افت تند ۲٫۲σ در چند روز اول، بعد درجا.',
    lesson: 'شکاف قیمت: واکنش روزانه دیر است؛ فقط اهرم کمتر از اول نجات می‌دهد.',
    shape: (u) => -2.2 * Math.min(1, u / 0.1),
  },
  {
    id: 'bear',
    title: 'روند نزولی آرام',
    text: 'افت یکنواخت ۱٫۲σ در کل دوره.',
    lesson: 'زمان برای واکنش هست: کاهش اهرم به‌موقع جلوی لیکوییدشدن را می‌گیرد.',
    shape: (u) => -1.2 * u,
  },
  {
    id: 'chop',
    title: 'نوسان بی‌جهت',
    text: 'دو موج ±۰٫۸σ و برگشت به قیمت اول.',
    lesson: 'قیمت آخر همان اول است، ولی بازتنظیم مکرر هزینه دارد و در اوج‌وفرودها ضرر قفل می‌کند.',
    shape: (u) => 0.8 * Math.sin(4 * Math.PI * u),
  },
  {
    id: 'dip',
    title: 'افت و بازگشت',
    text: 'افت ۱٫۶σ تا وسط دوره، بازگشت کامل تا آخر.',
    lesson: 'آن‌که لیکویید نشود سود بازگشت را می‌برد؛ حد ضرر در کف می‌فروشد و جا می‌ماند.',
    shape: (u) => -1.6 * (u < 0.5 ? u / 0.5 : (1 - u) / 0.5),
  },
  {
    id: 'bull',
    title: 'روند صعودی',
    text: 'رشد یکنواخت ۱σ در کل دوره.',
    lesson: 'اهرم سود را چند برابر می‌کند؛ اهرم ثابت با وام بیشتر در راه بالا جلو می‌افتد.',
    shape: (u) => 1 * u,
  },
  {
    id: 'rally',
    title: 'رالی تند',
    text: 'رشد ۲٫۲σ با شتاب در نیمه‌ی دوم.',
    lesson: 'بیشترین سود اهرم؛ ولی اهرم ثابت بالای قله بیشترین وام را دارد.',
    shape: (u) => 2.2 * u * u,
  },
];

export const STRATEGIES: Strategy[] = [
  { id: 'spot', title: 'بدون اهرم', text: 'همان سرمایه، فقط خرید و نگه‌داشتن وثیقه (مبنای مقایسه).' },
  { id: 'hold', title: 'باز کن و رها کن', text: 'اهرم اول، بی‌هیچ اقدامی تا آخر دوره.' },
  { id: 'guard', title: 'محافظ سلامت', text: `اگر سلامت به ${formatNumber(GUARD_TRIGGER, 2)} برسد، بخشی از وثیقه فروخته و وام پرداخت می‌شود تا سلامت ${formatNumber(GUARD_TARGET, 2)} شود.` },
  { id: 'constant', title: 'اهرم ثابت', text: `اهرم هر روز به هدف برمی‌گردد اگر بیش از ${formatPercent(CONSTANT_BAND * 100, 0)} دور شده باشد؛ در سود وام بیشتر، در ضرر وام کمتر.` },
  { id: 'stop', title: 'حد ضرر', text: `اگر ${formatPercent(STOP_LOSS * 100, 0)} سرمایه از دست برود، کل موقعیت بسته و نقد می‌شود.` },
];

export interface StrategyResult {
  strategy: StrategyId;
  /** Equity at the end, debt units (USD). */
  equity: number;
  pnl: number;
  pnlPct: number;
  liquidated: boolean;
  /** Collateral lost to liquidators' bonus, USD. */
  liquidationLoss: number;
  /** Swap costs paid by the strategy, USD. */
  swapCost: number;
  /** Rebalances or exits made. */
  actions: number;
  /** Lowest health on the way (∞ without debt). */
  minHealth: number;
  closedEarly: boolean;
}

export interface ScenarioResult {
  scenario: ScenarioId;
  /** Price at the end and at the lowest point, relative to today (1 = unchanged). */
  endPrice: number;
  lowPrice: number;
  path: number[];
  results: StrategyResult[];
  /** Best leveraged strategy on this path (by equity). */
  best: StrategyId;
}

export interface MultiplyAnalysis {
  /** Leverage used (the one asked for, capped at `maxLeverage`). */
  leverage: number;
  /** Amplitude of a one-σ move over the period, fraction. */
  amplitude: number;
  /** Highest leverage the protocol allows: 1 ÷ (1 − maxLtv). */
  maxLeverage: number;
  /** Start: LTV, health, liquidation price relative to today, and the move to it. */
  ltv: number;
  health: number;
  liqPrice: number;
  liqDrop: number;
  /** Liquidation price at the end of the period with only interest moving it (no price change). */
  liqPriceEnd: number;
  /** Carry per year on the capital at an unchanged price, %: L × yield − (L − 1) × borrow. */
  carryPct: number;
  scenarios: ScenarioResult[];
}

export const maxLeverageOf = (maxLtv: number) => (maxLtv > 0 && maxLtv < 1 ? 1 / (1 - maxLtv) : 1);

/** One σ√t move over `days`, bounded (a short period or a quiet pair still gets a visible path). */
export function amplitudeOf(volPct: number, days: number): number {
  const a = (volPct / 100) * Math.sqrt(Math.max(1, days) / 365);
  return Math.min(AMP_MAX, Math.max(AMP_MIN, Number.isFinite(a) ? a : AMP_MIN));
}

/** Daily price path (relative to today) for a scenario. */
export function pathOf(s: Scenario, amplitude: number, days: number): number[] {
  const n = Math.max(1, Math.round(days));
  return Array.from({ length: n + 1 }, (_, i) => Math.exp(s.shape(i / n) * amplitude));
}

interface State {
  c: number; // collateral units (price₀ = 1 debt unit)
  d: number; // debt, debt units
  cash: number; // closed out, debt units
  liquidated: boolean;
  liquidationLoss: number;
  swapCost: number;
  actions: number;
  minHealth: number;
  closed: boolean;
}

/** Protocol liquidation: repay up to closeFactor × debt, seize repay × (1 + bonus) of collateral, until healthy. */
function liquidate(s: State, p: number, pair: MultiplyPairInput) {
  for (let k = 0; k < 200 && s.d > 1e-12 && s.c * p > 0 && s.d / (s.c * p) >= pair.liqLtv; k++) {
    s.liquidated = true;
    const repay = Math.max(s.d * pair.closeFactor, 1e-9);
    const seize = (repay * (1 + pair.liqBonus)) / p;
    if (seize >= s.c) {
      // Not enough collateral: everything goes, the rest is bad debt (not the user's).
      s.liquidationLoss += s.c * p - Math.min(s.d, s.c * p);
      s.c = 0;
      s.d = 0;
      return;
    }
    s.liquidationLoss += repay * pair.liqBonus;
    s.c -= seize;
    s.d -= repay;
  }
}

/** Swap `x` collateral units to repay debt (or, x < 0, borrow and buy). */
function rebalance(s: State, p: number, targetLtv: number, swap: number) {
  const value = s.c * p;
  const equity = value - s.d;
  if (equity <= 0) return;
  // After the swap: value' = equity ÷ (1 − target), debt' = value' × target (swap cost from the collateral).
  const newValue = equity / (1 - targetLtv);
  const delta = newValue - value; // > 0: borrow and buy
  const cost = Math.abs(delta) * swap;
  s.c += (delta - cost) / p;
  s.d += delta;
  s.swapCost += cost;
  s.actions++;
}

function close(s: State, p: number, swap: number) {
  const value = s.c * p;
  const cost = value * swap;
  s.cash += Math.max(0, value - cost - s.d);
  s.swapCost += cost;
  s.c = 0;
  s.d = 0;
  s.actions++;
  s.closed = true;
}

export function simulate(pair: MultiplyPairInput, set: MultiplySettings, strategy: StrategyId, path: number[]): StrategyResult {
  const E = set.capital;
  // Each swap also pays the flash-loan fee on the amount moved (one-click Multiply).
  const swap = Math.max(0, set.swapPct) / 100 + Math.max(0, pair.flashFee ?? 0);
  const L = strategy === 'spot' ? 1 : leverageOf(pair, set);
  // Opening: the borrowed part is swapped into collateral (one swap of E × (L − 1)).
  const openCost = E * (L - 1) * swap;
  const s: State = { c: E * L - openCost, d: E * (L - 1), cash: 0, liquidated: false, liquidationLoss: 0, swapCost: openCost, actions: 0, minHealth: Infinity, closed: false };
  const targetLtv = L > 1 ? (L - 1) / L : 0;
  const yDay = Math.pow(1 + fin(pair.collateralYieldPct) / 100, 1 / 365) - 1;
  const rDay = Math.pow(1 + fin(pair.borrowPct) / 100, 1 / 365) - 1;
  const health = (p: number) => (s.d > 0 ? pair.liqLtv / (s.d / (s.c * p)) : Infinity);

  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    if (s.closed || (s.c === 0 && s.d === 0)) break;
    s.c *= 1 + yDay;
    s.d *= 1 + rDay;
    liquidate(s, p, pair);
    if (s.c === 0) break;
    s.minHealth = Math.min(s.minHealth, health(p));
    if (strategy === 'guard' && s.d > 0 && health(p) < GUARD_TRIGGER) rebalance(s, p, Math.min(targetLtv, pair.liqLtv / GUARD_TARGET), swap);
    if (strategy === 'constant' && L > 1) {
      const lev = (s.c * p) / (s.c * p - s.d);
      if (s.c * p > s.d && Math.abs(lev - L) / L > CONSTANT_BAND) rebalance(s, p, Math.min(targetLtv, pair.maxLtv), swap);
    }
    if (strategy === 'stop' && s.c * p - s.d <= E * (1 - STOP_LOSS)) close(s, p, swap);
  }
  const pEnd = path[path.length - 1];
  const equity = s.cash + Math.max(0, s.c * pEnd - s.d);
  return {
    strategy,
    equity,
    pnl: equity - E,
    pnlPct: E > 0 ? ((equity - E) / E) * 100 : 0,
    liquidated: s.liquidated,
    liquidationLoss: s.liquidationLoss,
    swapCost: s.swapCost,
    actions: s.actions,
    minHealth: s.minHealth,
    closedEarly: s.closed,
  };
}

const fin = (x: number) => (Number.isFinite(x) ? x : 0);

/** The leverage asked for, within what the protocol lets one borrow (max LTV). */
export const leverageOf = (pair: Pick<MultiplyPairInput, 'maxLtv'>, set: Pick<MultiplySettings, 'leverage'>) =>
  Math.min(Math.max(1, Number.isFinite(set.leverage) ? set.leverage : 1), maxLeverageOf(pair.maxLtv));

export function analyzeMultiply(pair: MultiplyPairInput, set: MultiplySettings): MultiplyAnalysis {
  const L = leverageOf(pair, set);
  const ltv = L > 1 ? (L - 1) / L : 0;
  const liqPrice = L > 1 ? ltv / pair.liqLtv : 0;
  const grow = (pct: number) => Math.pow(1 + fin(pct) / 100, Math.max(0, set.days) / 365);
  const liqPriceEnd = L > 1 ? (ltv * grow(pair.borrowPct)) / (pair.liqLtv * grow(pair.collateralYieldPct)) : 0;
  const amplitude = amplitudeOf(pair.volPct, set.days);
  const scenarios = SCENARIOS.map((sc) => {
    const path = pathOf(sc, amplitude, set.days);
    const results = STRATEGIES.map((st) => simulate(pair, set, st.id, path));
    const levered = results.filter((r) => r.strategy !== 'spot');
    const best = levered.reduce((a, b) => (b.equity > a.equity + 1e-9 ? b : a), levered[0]).strategy;
    return { scenario: sc.id, endPrice: path[path.length - 1], lowPrice: Math.min(...path), path, results, best };
  });
  return {
    leverage: L,
    amplitude,
    maxLeverage: maxLeverageOf(pair.maxLtv),
    ltv,
    health: ltv > 0 ? pair.liqLtv / ltv : Infinity,
    liqPrice,
    liqDrop: L > 1 ? 1 - liqPrice : 1,
    liqPriceEnd,
    carryPct: L * fin(pair.collateralYieldPct) - (L - 1) * fin(pair.borrowPct),
    scenarios,
  };
}

/** Annualised volatility (%) of a daily price-ratio series; null with fewer than 20 returns. */
export function realizedVol(prices: number[]): number | null {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) if (prices[i] > 0 && prices[i - 1] > 0) r.push(Math.log(prices[i] / prices[i - 1]));
  if (r.length < 20) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 365) * 100;
}
