import type { CostItem, DataQuality, Estimate, LeverageResult, Opportunity } from '../../types/opportunity';
import { tokenClass } from '../merkl/vetting';
import { maxLoopLeverage } from '../calculators/trade';
import { formatNumber, formatPercent } from '../utils/formatting';
import { rateAfterBorrow } from './curve';
import { periodGrowth } from './rates';
import { placeOf } from './estimate';

/**
 * Loops (leverage on a yield-bearing asset) — report §4-6.
 *
 *   own money     E  (capital − entry costs)
 *   leverage      L  (default: the highest that keeps health at the user's minimum,
 *                     never the protocol maximum)
 *   collateral    G = E × L        debt  B = E × (L − 1)
 *   ΔG = G × growth(collateral yield, d)
 *   ΔB = B × growth(borrow rate after the user's own borrow, d)
 *   net on own money = ΔG − ΔB − costs
 *
 * Prices are held constant, so only pairs that move together are built (USD/USD,
 * ETH/ETH, BTC/BTC). Two risks are always shown apart: liquidation if the
 * collateral falls against the debt, and a variable borrow rate that can rise.
 * The portfolio counts E + net, never G.
 */

export interface LeverageInput {
  /** Leverage is only estimated when the user allows it. */
  allow: boolean;
  /** Lowest health the user accepts: HF (Aave) or LLTV ÷ LTV (Morpho), e.g. 1.3. */
  minHealth: number;
  /** A chosen leverage; null → the highest that keeps `minHealth`. */
  target: number | null;
}

export const defaultLeverageInput: LeverageInput = { allow: false, minHealth: 1.3, target: null };

const CLASSES = new Set(['usd', 'eth', 'btc']);

/** Loops that can be built from the lending markets' borrow sides. */
export function buildLoops(opps: Opportunity[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const o of opps) {
    const side = o.borrow;
    const debt = o.assets.deposit[0];
    if (!side || !debt?.symbol || !debt.address || side.ratePct === null) continue;
    const debtClass = tokenClass({ symbol: debt.symbol });
    if (!CLASSES.has(debtClass)) continue;
    for (const c of side.collateral) {
      if (!c.token.symbol || !c.token.address || !c.yield || !(c.yield.pct > 0)) continue;
      if (tokenClass({ symbol: c.token.symbol }) !== debtClass) continue;
      const quality: DataQuality = side.premiumUnknown ? (o.quality === 'current' ? 'partial' : o.quality) : o.quality;
      out.push({
        ...o,
        key: `${o.key}:loop:${c.token.address.toLowerCase()}`,
        family: 'leverage',
        market: { ...o.market, name: `${c.token.symbol} با وام ${debt.symbol} · ${o.market.name}` },
        assets: { deposit: [c.token], collateral: [c.token], debt: [debt] },
        rate: { value: null, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: o.rate.at },
        capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
        exit: { type: 'instant', note: 'باز کردن اهرم: بازپرداخت وام و فروش وثیقه؛ اسلیپیج سواپ در حجم بالا بیشتر است.' },
        rewards: [],
        supplyCurve: null,
        book: null,
        borrow: null,
        loop: { collateral: { token: c.token, yield: c.yield, supplyPct: c.supplyPct ?? null }, debt: { token: debt, side }, maxLtv: c.maxLtv, pairClass: debtClass as 'usd' | 'eth' | 'btc' },
        quality,
        notes: [...(o.notes ?? []).filter((n) => !n.startsWith('Hub:')), ...(side.premiumUnknown ? ['Aave V4: نرخ وام پایه به کار رفت؛ صرف ریسک کاربر (User Risk Premium) که به ترکیب وثیقه‌ی شما بستگی دارد لحاظ نشده و نرخ واقعی می‌تواند بالاتر باشد.'] : [])],
        icon: null,
      });
    }
  }
  return out;
}

/** Health for a given LTV, in the protocol's own measure. */
export const healthOf = (metric: 'ltv' | 'hf', ltv: number, maxLtv: number) => (ltv > 0 ? maxLtv / ltv : Infinity);

export function leverageEstimate(
  o: Opportunity,
  input: { capital: number; days: number; entryCosts?: CostItem[]; exitCosts?: CostItem[]; unknownCosts?: string[] },
  lev: LeverageInput,
  base: Estimate,
): Estimate {
  const l = o.loop!;
  const assumptions = [...base.assumptions];
  // base.unknown already carries the caller's unknown costs.
  const unknown = [...base.unknown, 'اسلیپیج سواپ ورود و خروج و کارمزد flash loan، در صورت وجود'];
  let quality = o.quality;
  const entry = input.entryCosts ?? [];
  const E0 = Math.max(0, input.capital - entry.reduce((a, c) => a + c.usd, 0));
  const maxSafe = maxLoopLeverage(l.maxLtv * 100, Math.max(1, lev.minHealth));
  let L = lev.target !== null && lev.target >= 1 ? Math.min(lev.target, maxSafe) : maxSafe;
  if (lev.target !== null && lev.target > maxSafe) assumptions.push(`اهرم درخواستی بیش از حد ایمن شما بود؛ ${formatNumber(maxSafe, 2)}× به کار رفت.`);
  if (!Number.isFinite(L) || L < 1) L = 1;

  // Borrow capacity: the market cannot lend more than it has.
  let E = E0;
  const avail = l.debt.side.availableUsd;
  if (avail !== null && L > 1 && E * (L - 1) > avail) {
    E = avail / (L - 1);
    assumptions.push('نقدینگی قابل وام کمتر از نیاز این اهرم است؛ بخشی از سرمایه بی‌استفاده می‌ماند.');
  }
  if (avail === null) unknown.push('نقدینگی قابل وام گزارش نشده است.');
  const G = E * L;
  const B = E * (L - 1);

  const r0 = l.debt.side.ratePct as number;
  let r = r0;
  if (l.debt.side.curve) {
    const after = rateAfterBorrow(l.debt.side.curve, B, r0);
    if (after === null) unknown.push('نرخ وام پس از وام شما قابل محاسبه نبود؛ نرخ فعلی به کار رفت.');
    else r = after;
  } else unknown.push('اثر وام شما بر نرخ وام مدل نشده است.');

  const y = l.collateral.yield.pct + (l.collateral.supplyPct ?? 0);
  const gG = periodGrowth({ value: l.collateral.yield.pct, kind: l.collateral.yield.kind }, input.days) ?? 0;
  const gS = l.collateral.supplyPct ? (periodGrowth({ value: l.collateral.supplyPct, kind: 'apy' }, input.days) ?? 0) : 0;
  const gB = periodGrowth({ value: r, kind: 'apy' }, input.days) ?? 0;
  const dG = G * (gG + gS);
  const dB = B * gB;

  const costs = [...entry, ...(input.exitCosts ?? [])];
  // Entry costs already reduced E; they are still money spent, so they stay in the sum.
  const net = dG - dB - costs.reduce((a, c) => a + c.usd, 0);
  const ltv = G > 0 ? B / G : 0;
  const health = healthOf(l.debt.side.metric, ltv, l.maxLtv);
  const liquidationDrop = G > 0 && B > 0 ? Math.max(0, 1 - B / (G * l.maxLtv)) : 1;
  const carryPct = L * y - (L - 1) * r;

  const result: LeverageResult = {
    leverage: L,
    maxSafe,
    equity: E,
    gross: G,
    debt: B,
    yieldPct: y,
    borrowPct: r,
    ltv,
    maxLtv: l.maxLtv,
    health: { metric: l.debt.side.metric, value: health, min: lev.minHealth },
    liquidationDrop,
    carryPct,
  };

  assumptions.push(
    `اهرم ${formatNumber(L, 2)}× (بیشترین اهرمی که سلامت را دست‌کم ${formatNumber(lev.minHealth, 2)} نگه می‌دارد، نه حداکثر مجاز پروتکل).`,
    `بازده وثیقه ${formatPercent(y, 2)} (${l.collateral.yield.source}${l.collateral.supplyPct ? ' + نرخ سپرده‌ی وثیقه' : ''}) و نرخ وام ${formatPercent(r, 2)} پس از وام شما؛ هر دو متغیرند و برای کل دوره ثابت فرض شدند.`,
    `ریسک ۱ — لیکوییدشدن: اگر ارزش ${l.collateral.token.symbol} نسبت به ${l.debt.token.symbol} حدود ${formatPercent(liquidationDrop * 100, 1)} کم شود (مثلاً جدا شدن از برابری).`,
    'ریسک ۲ — نرخ: نرخ وام متغیر است و اگر از بازده وثیقه بالاتر برود، لوپ زیان می‌دهد و با اهرم بزرگ‌تر می‌شود.',
    'در پرتفوی فقط آورده‌ی شما و سود آن حساب می‌شود، نه ارزش ناخالص وثیقه.',
  );
  if (carryPct <= 0) assumptions.push('با نرخ‌های امروز بازده وثیقه از هزینه‌ی وام کمتر است (carry منفی).');
  if (o.loop?.debt.side.premiumUnknown) quality = quality === 'current' ? 'partial' : quality;

  const unallocated = Math.max(0, E0 - E);
  return {
    ...base,
    allocatable: E,
    unallocated,
    unallocatedReason: unallocated > 0 ? 'نقدینگی قابل وام بازار کمتر از نیاز این اهرم است.' : null,
    rateNow: y,
    rateAfterEntry: E > 0 ? ((dG - dB) / E) * (365 / input.days) * 100 : null,
    baseIncome: dG,
    debtCost: dB,
    costs,
    unknown,
    net,
    netPct: (net / input.capital) * 100,
    assumptions,
    quality,
    placement: E > 0 ? placeOf(quality, net, E, input.capital) : 'insufficient',
    leverage: result,
  };
}
