import { afterAmmFee } from '../opportunity/pt-price';
import { baseScenarios } from '../opportunity/base-scenarios';
import type { BaseLevels } from '../../types/market';

/**
 * The calculator, modelled on Pendle's own Yield Calculator and its trade page: PT, YT and
 * LP positions, Mint / Redeem, the strategies side by side and a date × exit-rate map.
 *
 * Units. PT redeems into the market's accounting asset and YT pays its yield in it; the user
 * pays with the market's token (sUSDfr), worth `tokenUsd ÷ accountingUsd` accounting units
 * (1 sUSDfr = 1.0195 USDfr: Pendle's Mint gives 1,019.5 PT + 1,019.5 YT for 1,000 sUSDfr).
 * Everything is worked out in accounting units, then shown in dollars and in the token.
 *
 * Fees, as close to the protocol as the data allows:
 * - Pendle AMM fee (`feeRate`, a log-rate a year): buying PT pays the implied rate − fee,
 *   selling it implied + fee; YT the other way round. A YT trade moves the whole exposure
 *   through the pool, so its fee is ≈ feeRate ÷ implied of the capital (Pendle's own trade
 *   page: $0.48 on $25.11, 1.93%). Exponent ~0.05%; elsewhere the assumed fee.
 * - The protocol's share of the YT's yield (Pendle 5%, Exponent 5.5%).
 * - Network gas per transaction (approve + trade in, trade or redeem out).
 * Mint and redeem pay no AMM fee.
 */

export interface CalcMarket {
  protocol: string;
  daysToMaturity: number;
  impliedPct: number;
  basePct: number;
  baseLevels?: BaseLevels | null;
  ammFeeLn?: number | null;
  /** Share of the YT's yield the protocol keeps, %. */
  yieldFeePct: number;
  rateKind?: 'apy' | 'apr';
  /** USD of one accounting unit (what PT redeems into). */
  accountingUsd: number;
  /** USD of one unit of the token paid in; defaults to the accounting unit. */
  tokenUsd?: number | null;
  tokenSymbol: string;
  /** LP: the pool's PT share by value, swap-fee and reward APYs (%). */
  lp?: { ptShare: number; swapFeeApyPct: number; rewardApyPct: number } | null;
}

export interface CalcInput {
  /** Capital in the market's token. */
  capitalTokens: number;
  holdDays: number;
  /** Implied rate on the exit day, % (ignored at maturity). */
  exitImpliedPct: number;
  /** Underlying APY over the hold, %. */
  basePct: number;
  /** Fee where the protocol's own is unknown, % a trade. */
  assumedFeePct: number;
  /** Gas of one transaction, USD. */
  txUsd: number;
  /** Move of the asset's USD price by the exit, % (USD figures only). */
  priceMovePct?: number;
  /** LP: count the incentive rewards (PENDLE …). */
  withRewards?: boolean;
}

export type Strategy = 'hold' | 'pt' | 'yt' | 'lp';

export interface CalcResult {
  strategy: Strategy;
  days: number;
  toMaturity: boolean;
  /** In accounting units. */
  capital: number;
  gross: number;
  net: number;
  fees: { entry: number; exit: number; protocol: number; gas: number; total: number };
  /** Per USD and per token: net, and the holding-period / yearly return. */
  netUsd: number;
  netTokens: number;
  hprPct: number;
  /** Yearly; null for holds under 7 days (it would only magnify noise). */
  annualPct: number | null;
  /** Units bought (PT or YT; LP: its PT part). */
  units: number;
  /** YT: dollars of yield exposure; others null. */
  exposureUsd: number | null;
  /** Days for the result (market rate unchanged) to cover the fees; null if never within the term. */
  breakEvenDays: number | null;
  /** YT: underlying APY at which the result is zero; null otherwise. */
  breakEvenBasePct: number | null;
  /** The parts of the result, in accounting units, for the details list. */
  lines: { label: string; value: number }[];
}

const DAY = 1 / 365;
const growth = (pct: number, days: number, kind: 'apy' | 'apr' = 'apy') => (kind === 'apr' ? (pct / 100) * days * DAY : Math.pow(1 + pct / 100, days * DAY) - 1);
const ptPrice = (pct: number, days: number) => (days > 0 ? Math.pow(1 + pct / 100, -days * DAY) : 1);

/** Price paid buying (or got selling) PT and YT, with the protocol's fee. */
function prices(m: CalcMarket, pct: number, days: number, assumedFeePct: number) {
  const mid = ptPrice(pct, days);
  if (m.protocol === 'pendle' && m.ammFeeLn && m.ammFeeLn > 0) {
    const cheap = ptPrice(afterAmmFee(pct, m.ammFeeLn, 'yt'), days); // PT price when selling PT / buying YT
    const dear = ptPrice(afterAmmFee(pct, m.ammFeeLn, 'pt'), days); // PT price when buying PT / selling YT
    return { ptMid: mid, ptBuy: dear, ptSell: cheap, ytMid: 1 - mid, ytBuy: 1 - cheap, ytSell: 1 - dear };
  }
  const f = (m.protocol === 'exponent' ? 0.05 : assumedFeePct) / 100;
  return { ptMid: mid, ptBuy: mid * (1 + f), ptSell: mid * (1 - f), ytMid: 1 - mid, ytBuy: (1 - mid) * (1 + f), ytSell: (1 - mid) * (1 - f) };
}

/** Accounting units per token. */
export const tokenRate = (m: CalcMarket) => (m.tokenUsd && m.tokenUsd > 0 && m.accountingUsd > 0 ? m.tokenUsd / m.accountingUsd : 1);

function finish(m: CalcMarket, i: CalcInput, r: Omit<CalcResult, 'netUsd' | 'netTokens' | 'hprPct' | 'annualPct' | 'breakEvenDays' | 'breakEvenBasePct'>): CalcResult {
  const move = 1 + (i.priceMovePct ?? 0) / 100;
  // USD: the end value at the moved price, less the capital at today's price.
  const endUsd = (r.capital + r.net) * m.accountingUsd * move;
  const netUsd = endUsd - r.capital * m.accountingUsd;
  const netTokens = r.net / tokenRate(m);
  const hprPct = (r.net / r.capital) * 100;
  const annualPct = r.days >= 7 && r.capital + r.net > 0 ? (Math.pow(1 + r.net / r.capital, 365 / r.days) - 1) * 100 : null;
  return { ...r, netUsd, netTokens, hprPct, annualPct, breakEvenDays: null, breakEvenBasePct: null };
}

const gasUnits = (m: CalcMarket, i: CalcInput) => i.txUsd / (m.accountingUsd || 1);

/** PT bought now, sold on the exit day at its implied rate or redeemed at maturity. */
export function ptCalc(m: CalcMarket, i: CalcInput): CalcResult {
  const D = Math.max(1, m.daysToMaturity);
  const h = Math.min(Math.max(1, i.holdDays), D);
  const end = h >= D;
  const C = i.capitalTokens * tokenRate(m);
  const p = prices(m, m.impliedPct, D, i.assumedFeePct);
  const units = C / p.ptBuy;
  const out = end ? null : prices(m, i.exitImpliedPct, D - h, i.assumedFeePct);
  const value = end ? units : units * out!.ptSell;
  const midValue = end ? C / p.ptMid : (C / p.ptMid) * out!.ptMid;
  const gas = gasUnits(m, i) * 3;
  const entry = midValue - (C / p.ptBuy) * (end ? 1 : out!.ptMid);
  const exit = end ? 0 : units * (out!.ptMid - out!.ptSell);
  const net = value - C - gas;
  return finish(m, i, {
    strategy: 'pt', days: h, toMaturity: end, capital: C, gross: midValue - C, net, units, exposureUsd: null,
    fees: { entry, exit, protocol: 0, gas, total: entry + exit + gas },
    lines: [
      { label: end ? 'بازخرید PT در سررسید' : 'فروش PT', value },
      { label: 'سرمایه', value: -C },
    ],
  });
}

/** YT bought now: the yield over the hold (less the protocol's share), sold on the exit day or worth 0 at maturity. */
export function ytCalc(m: CalcMarket, i: CalcInput): CalcResult {
  const D = Math.max(1, m.daysToMaturity);
  const h = Math.min(Math.max(1, i.holdDays), D);
  const end = h >= D;
  const C = i.capitalTokens * tokenRate(m);
  const p = prices(m, m.impliedPct, D, i.assumedFeePct);
  const units = C / p.ytBuy;
  const g = growth(i.basePct, h, m.rateKind);
  const yieldGross = units * Math.max(0, g);
  const protocol = yieldGross * (m.yieldFeePct / 100);
  const out = end ? null : prices(m, i.exitImpliedPct, D - h, i.assumedFeePct);
  const sale = end ? 0 : units * out!.ytSell;
  const gas = gasUnits(m, i) * 3;
  const midUnits = C / p.ytMid;
  const gross = midUnits * Math.max(0, g) + (end ? 0 : midUnits * out!.ytMid) - C;
  const entry = (midUnits - units) * (Math.max(0, g) + (end ? 0 : out!.ytMid));
  const exit = end ? 0 : units * (out!.ytMid - out!.ytSell);
  const net = yieldGross - protocol + sale - C - gas;
  const r = finish(m, i, {
    strategy: 'yt', days: h, toMaturity: end, capital: C, gross, net, units, exposureUsd: units * m.accountingUsd,
    fees: { entry, exit, protocol, gas, total: entry + exit + protocol + gas },
    lines: [
      { label: 'بازده دریافتی (پس از سهم پروتکل)', value: yieldGross - protocol },
      ...(end ? [] : [{ label: 'فروش YT', value: sale }]),
      { label: 'بهای YT (می‌سوزد)', value: -C },
    ],
  });
  // The underlying APY at which the result is zero (bisection on the same model).
  let lo = -50;
  let hi = 1000;
  const at = (b: number) => ytCalc0(m, { ...i, basePct: b });
  if (at(hi) < 0) r.breakEvenBasePct = null;
  else {
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (at(mid) >= 0) hi = mid;
      else lo = mid;
    }
    r.breakEvenBasePct = hi;
  }
  return r;
}
/** Net only, for the break-even search. */
const ytCalc0 = (m: CalcMarket, i: CalcInput) => {
  const D = Math.max(1, m.daysToMaturity);
  const h = Math.min(Math.max(1, i.holdDays), D);
  const C = i.capitalTokens * tokenRate(m);
  const p = prices(m, m.impliedPct, D, i.assumedFeePct);
  const units = C / p.ytBuy;
  const y = units * Math.max(0, growth(i.basePct, h, m.rateKind)) * (1 - m.yieldFeePct / 100);
  const sale = h >= D ? 0 : units * prices(m, i.exitImpliedPct, D - h, i.assumedFeePct).ytSell;
  return y + sale - C - gasUnits(m, i) * 3;
};

/**
 * LP: the pool's PT part (bought with the AMM fee, sold back on exit or redeemed at maturity)
 * and its SY part (earning the underlying APY), plus swap fees and, optionally, incentive
 * rewards. The pool's mix is held at today's: a simplification, stated on screen.
 */
export function lpCalc(m: CalcMarket, i: CalcInput): CalcResult | null {
  if (!m.lp) return null;
  const D = Math.max(1, m.daysToMaturity);
  const h = Math.min(Math.max(1, i.holdDays), D);
  const end = h >= D;
  const C = i.capitalTokens * tokenRate(m);
  const w = Math.min(1, Math.max(0, m.lp.ptShare));
  const p = prices(m, m.impliedPct, D, i.assumedFeePct);
  const ptUnits = (C * w) / p.ptBuy;
  const out = end ? null : prices(m, i.exitImpliedPct, D - h, i.assumedFeePct);
  const ptValue = end ? ptUnits : ptUnits * out!.ptSell;
  const syValue = C * (1 - w) * (1 + growth(i.basePct, h, m.rateKind));
  const swap = C * (m.lp.swapFeeApyPct / 100) * h * DAY;
  const rewards = i.withRewards ? C * (m.lp.rewardApyPct / 100) * h * DAY : 0;
  const gas = gasUnits(m, i) * 3;
  const midPt = ((C * w) / p.ptMid) * (end ? 1 : out!.ptMid);
  const entry = midPt - ptUnits * (end ? 1 : out!.ptMid);
  const exit = end ? 0 : ptUnits * (out!.ptMid - out!.ptSell);
  const gross = midPt + syValue + swap + rewards - C;
  const net = ptValue + syValue + swap + rewards - C - gas;
  return finish(m, i, {
    strategy: 'lp', days: h, toMaturity: end, capital: C, gross, net, units: ptUnits, exposureUsd: null,
    fees: { entry, exit, protocol: 0, gas, total: entry + exit + gas },
    lines: [
      { label: `بخش PT استخر (${Math.round(w * 100)}٪)`, value: ptValue - C * w },
      { label: `بخش SY استخر (${Math.round((1 - w) * 100)}٪)، بازده پایه`, value: syValue - C * (1 - w) },
      { label: 'کارمزد سواپ استخر', value: swap },
      ...(i.withRewards ? [{ label: 'پاداش استخر (مثلاً PENDLE)', value: rewards }] : []),
    ],
  });
}

/** Holding the token itself: the underlying APY, no trade. */
export function holdCalc(m: CalcMarket, i: CalcInput): CalcResult {
  const h = Math.max(1, Math.min(i.holdDays, Math.max(1, m.daysToMaturity)));
  const C = i.capitalTokens * tokenRate(m);
  const net = C * growth(i.basePct, h, m.rateKind);
  return finish(m, i, {
    strategy: 'hold', days: h, toMaturity: h >= m.daysToMaturity, capital: C, gross: net, net, units: 0, exposureUsd: null,
    fees: { entry: 0, exit: 0, protocol: 0, gas: 0, total: 0 },
    lines: [{ label: 'بازده پایه‌ی دارایی', value: net }],
  });
}

export const calcFor = (s: Strategy) => (s === 'pt' ? ptCalc : s === 'yt' ? ytCalc : s === 'lp' ? lpCalc : holdCalc);

/** Days until the result at an unchanged market rate covers the fees; null if never within the term. */
export function breakEvenDays(m: CalcMarket, i: CalcInput, s: Strategy): number | null {
  const f = calcFor(s);
  const D = Math.max(1, m.daysToMaturity);
  for (let d = 1; d <= D; d++) {
    const r = f(m, { ...i, holdDays: d, exitImpliedPct: m.impliedPct });
    if (r && r.net >= 0) return d;
  }
  return null;
}

/** Date × exit-rate grid like Pendle's: four exit days (the last one maturity) × five rates around today's. */
export function exitMap(m: CalcMarket, i: CalcInput, s: Strategy) {
  const D = Math.max(1, Math.round(m.daysToMaturity));
  const days = [...new Set([Math.round(D / 4), Math.round(D / 2), Math.round((3 * D) / 4), D].filter((d) => d >= 1))];
  const step = Math.max(0.5, Math.round(m.impliedPct * 0.1 * 100) / 100);
  const rates = [-2, -1, 0, 1, 2].map((k) => Math.max(0.01, m.impliedPct + k * step));
  const f = calcFor(s);
  return { days, rates, cells: rates.map((r) => days.map((d) => f(m, { ...i, holdDays: d, exitImpliedPct: r })?.net ?? null)) };
}

/** Every strategy for the same capital and exit, under the low / likely / high underlying APY. */
export function compareStrategies(m: CalcMarket, i: CalcInput) {
  const sc = baseScenarios(m.basePct, m.baseLevels, Math.min(i.holdDays, m.daysToMaturity));
  const readings = { low: sc.low, likely: sc.likely, high: sc.high };
  const list: Strategy[] = ['hold', 'pt', 'yt', ...(m.lp ? (['lp'] as Strategy[]) : [])];
  return {
    readings,
    rows: list.map((s) => ({
      strategy: s,
      byReading: Object.fromEntries((Object.keys(readings) as (keyof typeof readings)[]).map((k) => [k, calcFor(s)(m, { ...i, basePct: readings[k] })])) as Record<'low' | 'likely' | 'high', CalcResult | null>,
    })),
  };
}

/** Mint: the token into equal PT and YT (no AMM fee), and what each is worth at today's prices. */
export function mintPreview(m: CalcMarket, tokens: number) {
  const units = tokens * tokenRate(m);
  const pt = ptPrice(m.impliedPct, m.daysToMaturity);
  return { pt: units, yt: units, ptUsd: units * pt * m.accountingUsd, ytUsd: units * (1 - pt) * m.accountingUsd, inUsd: units * m.accountingUsd };
}

/** Redeem: before maturity equal PT and YT; after it PT alone — back into the token. */
export function redeemPreview(m: CalcMarket, pt: number, yt: number) {
  const matured = m.daysToMaturity <= 0;
  const units = matured ? pt : Math.min(pt, yt);
  return { matured, units, tokens: units / tokenRate(m), usd: units * m.accountingUsd, leftover: matured ? { pt: 0, yt } : { pt: pt - units, yt: yt - units } };
}
