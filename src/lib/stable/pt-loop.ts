import type { MarketListing } from '../../types/market';
import type { CostItem, Estimate, Opportunity, Placement } from '../../types/opportunity';
import type { ProtocolId } from '../../types/protocol';
import { isLoopable, isStable } from '../risk/opportunities';
import { ptOpportunity } from '../opportunity/from-market';
import { estimate } from '../opportunity/estimate';
import { rankEstimates, type Ranking } from '../opportunity/rank';
import { maxLoopLeverage } from '../calculators/trade';
import { formatNumber } from '../utils/formatting';

/**
 * «پیشنهادها برای استیبل‌کوین‌ها» — PT Loop on every stablecoin PT market, ranked
 * by dollar profit for the user's money, with the borrow rate the user enters.
 *
 * A PT loop: buy PT, post it as collateral, borrow the stablecoin it redeems
 * into, buy more PT, repeat to leverage L. Held to maturity, each PT redeems one
 * unit, so the collateral's yield is the PT's implied APY — fixed for the PT
 * bought today. The debt pays the user's borrow rate (variable in practice).
 *
 *   own money E, collateral G = E × L in PT, debt B = E × (L − 1)
 *   net to maturity = G × ((1 + implied)^(D/365) − 1) − B × ((1 + r)^(D/365) − 1) − costs
 *
 * Assumptions stated with every row: the debt is in the same unit the PT redeems
 * into (no currency gap), the stablecoin holds its peg, the money market accepts
 * this PT at the LLTV the user entered, and the borrow rate stays where it is.
 */

export interface PtLoopSettings {
  capital: number;
  days: number;
  leverage: number;
  /** The user's borrow rate, % per year (APY); null → not entered yet. */
  borrowRate: number | null;
  /** Liquidation LTV of the money market for this PT, %. */
  lltv: number;
  /** Lowest health accepted (LLTV ÷ LTV); leverage above it is capped. */
  minHealth: number;
  needsEarlyExit: boolean;
  sort: 'total' | 'daily';
  txEthereum: number;
  txOther: number;
  /** Only markets Pendle lists on its PT-looping page (a money market accepts the PT). */
  loopListedOnly: boolean;
}

export const defaultPtLoopSettings: PtLoopSettings = { capital: 1000, days: 30, leverage: 3, borrowRate: null, lltv: 86, minHealth: 1.05, needsEarlyExit: false, sort: 'total', txEthereum: 1, txOther: 0.05, loopListedOnly: false };

/** Loops need a buy, a supply and a borrow in, a repay and a sale or redeem out. */
export const LOOP_TX_ENTRY = 3;
export const LOOP_TX_EXIT = 2;

export const isStableMarket = (m: MarketListing) => isStable(m);

/** The loop as a shared-model opportunity, from a PT listing and the user's borrow terms. */
export function ptLoopOpportunity(protocol: ProtocolId, m: MarketListing, s: PtLoopSettings, fetchedAt: string, now = Date.now()): Opportunity {
  const pt = ptOpportunity(protocol, m, fetchedAt, now);
  const unit = m.accountingSymbol ?? m.asset?.symbol ?? m.name;
  const token = { symbol: `PT-${m.name}`, address: pt.market.address };
  const debt = { symbol: unit, address: null };
  return {
    ...pt,
    key: `${pt.key}:loop`,
    family: 'leverage',
    market: { ...pt.market, name: `PT ${m.name} با وام ${unit}` },
    assets: { deposit: [token], collateral: [token], debt: [debt] },
    // Kept for display; the period rules are applied by rankPtLoops (the leverage engine ignores maturity).
    maturity: m.maturity,
    loop: {
      collateral: { token, yield: { pct: m.impliedAPY, kind: 'apy', source: 'Implied APY امروزِ PT، ثابت تا سررسید برای PT خریده‌شده' }, supplyPct: null },
      debt: { token: debt, side: { ratePct: s.borrowRate, curve: null, availableUsd: null, collateral: [], metric: 'ltv' } },
      maxLtv: s.lltv / 100,
      pairClass: 'usd',
    },
    notes: [
      `وام به همان واحدی گرفته می‌شود که PT در سررسید به آن بازخرید می‌شود (${unit})؛ اختلاف قیمت دو واحد فرض نشده.`,
      `نرخ وام ${s.borrowRate === null ? '—' : formatNumber(s.borrowRate, 2)}٪ و LLTV ${formatNumber(s.lltv, 1)}٪ را شما وارد کرده‌اید؛ بازار وام واقعی و پذیرش این PT به‌عنوان وثیقه را در همان پلتفرم بررسی کنید.`,
      'ریسک PT: پیش از سررسید قیمت PT با Implied APY بازار تغییر می‌کند؛ اگر اوراکل وام قیمت بازار PT را بخواند، بالا رفتن نرخ می‌تواند به لیکوییدشدن برسد.',
      ...(isLoopable(m) ? ['Pendle این بازار را در فهرست PT Looping آورده است.'] : ['این بازار در فهرست PT Looping پندل نیست؛ پذیرش PT به‌عنوان وثیقه تأیید نشده.']),
    ],
  };
}

function gas(o: Opportunity, s: PtLoopSettings): { entry: CostItem[]; exit: CostItem[] } {
  const tx = o.chain === 'eip155:1' ? s.txEthereum : s.txOther;
  return {
    entry: [{ key: 'gas-entry', label: `گس ورود لوپ (${formatNumber(LOOP_TX_ENTRY, 0)} تراکنش، فرض شما)`, usd: tx * LOOP_TX_ENTRY, basis: 'assumed' }],
    exit: [{ key: 'gas-exit', label: `گس خروج (${formatNumber(LOOP_TX_EXIT, 0)} تراکنش، فرض شما)`, usd: tx * LOOP_TX_EXIT, basis: 'assumed' }],
  };
}

export interface PtLoopResult {
  ranking: Ranking;
  byKey: Map<string, Opportunity>;
  total: number;
  /** The highest leverage the LLTV and minimum health allow. */
  maxSafe: number;
}

/** Every stablecoin PT market as a loop, estimated for this money, period and borrow rate. */
export function rankPtLoops(markets: (MarketListing & { protocol: ProtocolId })[], s: PtLoopSettings, now = Date.now(), fetchedAt = new Date(now).toISOString()): PtLoopResult {
  const maxSafe = maxLoopLeverage(s.lltv, Math.max(1, s.minHealth));
  const list = markets.filter((m) => !m.expired && isStableMarket(m) && Number.isFinite(m.impliedAPY) && (!s.loopListedOnly || isLoopable(m)));
  const byKey = new Map<string, Opportunity>();
  const estimates: Estimate[] = [];
  for (const m of list) {
    const o = ptLoopOpportunity(m.protocol, m, s, fetchedAt, now);
    byKey.set(o.key, o);
    const dMat = (new Date(m.maturity).getTime() - now) / 86_400_000;
    if (!(dMat > 0)) continue;
    if (s.borrowRate === null) {
      estimates.push({ ...emptyEstimate(o.key, s), placement: 'insufficient', assumptions: ['نرخ وام را وارد کنید.'] });
      continue;
    }
    // Held to maturity: a maturity inside the period ends the loop there; one after it
    // is either set aside (the user may need the money) or compared over its own term.
    const beyond = dMat > s.days;
    const days = dMat;
    const g = gas(o, s);
    let e = estimate(o, { capital: s.capital, days, needsEarlyExit: false, entryCosts: g.entry, exitCosts: g.exit, unknownCosts: ['اثر قیمت خرید PT در استخر برای حجم لوپ', 'کارمزد flash loan یا تجمیع‌کننده، در صورت وجود'], now, leverage: { allow: true, minHealth: s.minHealth, target: s.leverage } });
    e = { ...e, days: s.days, earningDays: days };
    if (beyond) {
      e.assumptions = [...e.assumptions, `سررسید ${formatNumber(days, 0)} روز دیگر است، بعد از مدت شما؛ سود تا سررسید حساب شد.`];
      if (s.needsEarlyExit && e.placement !== 'insufficient') e.placement = 'beyond-horizon' as Placement;
    } else if (days < s.days) e.assumptions = [...e.assumptions, 'سررسید پیش از پایان مدت شماست؛ بعد از آن سرمایه‌گذاری مجدد فرض نشده.'];
    estimates.push(e);
  }
  // Sort the whole qualifying list first, then keep thirty.
  const ranking = rankEstimates(estimates, Infinity);
  if (s.sort === 'daily') ranking.top.sort((a, b) => (b.net ?? 0) / b.earningDays - (a.net ?? 0) / a.earningDays);
  ranking.top = ranking.top.slice(0, 30);
  return { ranking, byKey, total: list.length, maxSafe };
}

function emptyEstimate(key: string, s: PtLoopSettings): Estimate {
  return {
    key,
    capital: s.capital,
    days: s.days,
    earningDays: s.days,
    allocatable: 0,
    unallocated: s.capital,
    unallocatedReason: null,
    rateNow: null,
    rateAfterEntry: null,
    baseIncome: null,
    rewards: 0,
    rewardLines: [],
    debtCost: 0,
    costs: [],
    unknown: [],
    net: null,
    netPct: null,
    assumptions: [],
    quality: 'insufficient',
    placement: 'insufficient',
  };
}
