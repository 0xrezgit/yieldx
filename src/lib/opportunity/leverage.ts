import type { CostItem, DataQuality, Estimate, LeverageResult, Opportunity } from '../../types/opportunity';
import { tokenClass } from '../merkl/vetting';
import { maxLoopLeverage, simulateLoop } from '../calculators/trade';
import { formatNumber, formatPercent } from '../utils/formatting';
import { rateAfterBorrow } from './curve';
import { periodGrowth } from './rates';
import { placeOf, reasonOf, worseQuality } from './estimate';
import { LEVERAGE_POLICY, MAX_POOL_SHARE_WITHOUT_QUOTE, PT_LOOP_POLICY } from './policy';
import { maturityState } from '../protocols/lifecycle';
import { evmChainId } from './costs';
import { afterAmmFee, afterRedeem, quoteCheck } from './pt-price';

/**
 * Loops (leverage on a yield-bearing asset) — report §4-6.
 *
 *   own money     E  (capital − entry costs)
 *   leverage      L  (the versioned policy: the highest that keeps health at its
 *                     minimum, capped; never the protocol maximum)
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

/** The leverage policy applied to every loop (see policy.ts); never the protocol maximum. */
export interface LeverageInput {
  version: string;
  /** Lowest health kept: HF (Aave) or LLTV ÷ LTV (Morpho). */
  minHealth: number;
  /** Upper bound on leverage whatever the health allows. */
  maxLeverage: number;
}

export const defaultLeverageInput: LeverageInput = { ...LEVERAGE_POLICY };

const CLASSES = new Set(['usd', 'eth', 'btc']);

const addrKey = (chain: string, address: string | null | undefined) => (address ? `${chain}:${address.toLowerCase()}` : null);

/** Loops that can be built from the lending markets' borrow sides (PT collaterals are left to `buildPtLoops`). */
export function buildLoops(opps: Opportunity[]): Opportunity[] {
  const out: Opportunity[] = [];
  const pts = new Set(opps.filter((o) => o.family === 'pt').map((o) => addrKey(o.chain, o.ptToken?.address)).filter(Boolean));
  for (const o of opps) {
    const side = o.borrow;
    const debt = o.assets.deposit[0];
    if (!side || !debt?.symbol || !debt.address || side.ratePct === null) continue;
    const debtClass = tokenClass({ symbol: debt.symbol });
    if (!CLASSES.has(debtClass)) continue;
    for (const c of side.collateral) {
      if (!c.token.symbol || !c.token.address || !c.yield || !(c.yield.pct > 0)) continue;
      if (pts.has(addrKey(o.chain, c.token.address))) continue;
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

/** The borrow rate a loop is costed at: today's or the 7-day average, whichever is higher. */
export const loopBorrowPct = (side: { ratePct: number | null; ratePct7d?: number | null }) =>
  side.ratePct === null ? null : Math.max(side.ratePct, side.ratePct7d ?? -Infinity);

/** Why a PT loop gets its leverage; shown with the row. */
export type PtLeverageReason = 'full' | 'peg' | 'spread' | 'long' | 'health' | 'rate';

export const PT_LEVERAGE_REASON: Record<PtLeverageReason, string> = {
  full: 'سررسید کوتاه و فاصله‌ی نرخ کافی',
  peg: 'برابری با دلار تأیید نشده',
  spread: 'فاصله‌ی کم نرخ PT و بهره‌ی وام',
  long: 'سررسید طولانی',
  health: 'LLTV پایین؛ برای حفظ سلامت',
  rate: 'برای تحمل جهش نرخ PT',
};

/**
 * The PT loop policy's leverage for one market (PT_LOOP_POLICY): 3×, 2.5× when the peg is
 * unverified, the spread is under `minSpreadPp` or the maturity is past `longDays`; then
 * lowered only as far as health `minHealth` (after the entry fee) and surviving a
 * `rateBufferPp` rise of the implied rate (market-priced PT) need.
 */
export function ptLoopLeverage(p: { impliedPct: number; borrowPct: number; days: number; lltvPct: number; pegVerified: boolean; feePercent: number }): { leverage: number; reason: PtLeverageReason } {
  const P = PT_LOOP_POLICY;
  const spread = p.impliedPct - p.borrowPct;
  const cautious: PtLeverageReason | null = !p.pegVerified ? 'peg' : spread < P.minSpreadPp ? 'spread' : p.days > P.longDays ? 'long' : null;
  let L: number = cautious ? P.cautiousLeverage : P.maxLeverage;
  let reason: PtLeverageReason = cautious ?? 'full';
  const byHealth = maxLoopLeverage(p.lltvPct, P.minHealth, p.feePercent);
  if (byHealth < L) {
    L = byHealth;
    reason = 'health';
  }
  const survives = (x: number) => {
    const r = simulateLoop({ capital: 1, daysToMaturity: p.days, entryAPY: p.impliedPct, leverage: x, borrowAPY: p.borrowPct, lltv: p.lltvPct, feePercent: p.feePercent });
    return r.liquidationAPY - p.impliedPct >= P.rateBufferPp;
  };
  if (L > 1 && !survives(L)) {
    let lo = 1;
    let hi = L;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (survives(mid)) lo = mid;
      else hi = mid;
    }
    L = lo;
    reason = 'rate';
  }
  return { leverage: Math.max(1, L), reason };
}

/**
 * The lending markets that take this PT as collateral: same network, the PT's exact
 * token address (never a symbol), a published borrow rate, and a debt of the same
 * class as the PT's underlying (USD/ETH/BTC, see `ptClassOf`) so a constant price is a fair assumption.
 * Shared by the market analysis and the Loop PT dollar ranking.
 */
export function ptLenders(pt: Pick<Opportunity, 'chain' | 'ptToken' | 'assets' | 'ptClass'>, lending: Opportunity[]) {
  const key = addrKey(pt.chain, pt.ptToken?.address);
  const unitClass = pt.ptClass?.class ?? tokenClass({ symbol: pt.assets.deposit[0]?.symbol ?? '' });
  const out: { lender: Opportunity; collateral: NonNullable<Opportunity['borrow']>['collateral'][number]; debt: NonNullable<Opportunity['assets']['deposit'][number]> }[] = [];
  if (!key || !CLASSES.has(unitClass)) return out;
  for (const o of lending) {
    const side = o.borrow;
    const debt = o.assets.deposit[0];
    if (!side || !debt?.symbol || !debt.address || side.ratePct === null) continue;
    if (tokenClass({ symbol: debt.symbol }) !== unitClass) continue;
    for (const c of side.collateral) if (addrKey(o.chain, c.token.address) === key) out.push({ lender: o, collateral: c, debt });
  }
  return out;
}

/**
 * PT loops: a lending market that accepts this exact PT as collateral (same network,
 * same token address — never a symbol), borrowing an asset of the same class. The
 * collateral earns the PT's implied APY until maturity; the loop closes at maturity.
 */
export function buildPtLoops(opps: Opportunity[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const p of opps) {
    if (p.family !== 'pt' || p.rate.value === null || !p.ptToken) continue;
    const unit = p.assets.deposit[0];
    for (const { lender: o, collateral: c, debt } of ptLenders(p, opps)) {
      const side = o.borrow!;
      const debtClass = tokenClass({ symbol: debt.symbol ?? '' });
      const unverified = p.ptClass?.pegVerified === false;
      const token = { symbol: p.ptToken.symbol ?? `PT-${unit?.symbol ?? ''}`, address: p.ptToken.address };
      const worst = worseQuality(o.quality, p.quality);
      out.push({
        ...o,
        key: `${o.key}:ptloop:${(p.ptToken.address ?? '').toLowerCase()}`,
        family: 'leverage',
        market: { ...o.market, name: `${token.symbol} با وام ${debt.symbol} · ${p.protocol.name}` },
        assets: { deposit: [token], collateral: [token], debt: [debt] },
        rate: { value: null, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: o.rate.at },
        maturity: p.maturity,
        capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
        exit: { type: 'maturity', note: 'در سررسید PT بازخرید و وام بازپرداخت می‌شود؛ بستن زودتر یعنی فروش PT در استخر.' },
        rewards: [],
        supplyCurve: null,
        book: null,
        borrow: null,
        // The PT is bought in the AMM: its fee comes out of the rate (a quote for the whole position replaces it when asked).
        loop: {
          collateral: { token, yield: { pct: afterAmmFee(p.rate.value as number, p.ammFeeLn, 'pt'), kind: 'apy', source: p.ammFeeLn ? `Implied APY امروز ${p.protocol.name} تا سررسید، پس از کارمزد AMM` : `Implied APY امروز ${p.protocol.name} تا سررسید` } },
          debt: { token: debt, side },
          maxLtv: c.maxLtv,
          pairClass: debtClass as 'usd' | 'eth' | 'btc',
          pegVerified: !unverified,
          entryUrl: p.url ?? null,
        },
        ammFeeLn: p.ammFeeLn ?? null,
        ptRedeemFactor: p.ptRedeemFactor ?? null,
        ptQuotes: p.ptQuotes ?? null,
        ptMarket: p.protocol.id === 'pendle' && p.market.address && evmChainId(p.chain) !== null ? { key: p.key, chainId: evmChainId(p.chain) as number, address: p.market.address } : null,
        poolLiquidityUsd: p.poolLiquidityUsd ?? null,
        impliedHealth: p.impliedHealth ?? null,
        quality: worst,
        sources: [...o.sources, ...p.sources],
        notes: [
          ...(unverified ? [`برابری ${unit?.symbol ?? 'دارایی پایه'} با دلار فقط از نامش برداشته شده؛ پروتکل آن را استیبل‌کوین علامت نزده است.`] : []),
          ...(debt.symbol !== unit?.symbol ? [`PT به ${unit?.symbol ?? '—'} بازخرید می‌شود و وام ${debt.symbol} است؛ برابری این دو فرض شده.`] : []),
          'اوراکل وام ممکن است قیمت بازار PT را بخواند؛ بالا رفتن نرخ بازار پیش از سررسید سلامت را کم می‌کند.',
        ],
        icon: p.icon ?? null,
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
  now = Date.now(),
): Estimate {
  const l = o.loop!;
  const assumptions = [...base.assumptions];
  const stop = (p: Estimate['placement'], why: string): Estimate => ({ ...base, placement: p, reason: why, assumptions: [...assumptions, why] });
  // base.unknown already carries the caller's unknown costs.
  const unknown = [...base.unknown];
  // Unwinding costs are not measured, so a loop is never a complete estimate.
  let quality: DataQuality = o.quality === 'current' ? 'partial' : o.quality;
  if (l.debt.side.ratePct === null) return stop('insufficient', 'نرخ وام گزارش نشده است.');
  // A PT loop earns the PT's implied APY: it must be believable.
  if (o.impliedHealth && o.impliedHealth.status !== 'ok') return stop('needs-model', `نرخ بازار PT مشکوک است؛ لوپ برآورد نمی‌شود. ${o.impliedHealth.reasons.join(' ')}`);
  if (!(l.maxLtv > 0 && l.maxLtv < 1)) return stop('insufficient', 'حد لیکوییدشدن معتبر نیست.');

  // A collateral with a maturity (PT): the loop closes at maturity — PT redeems, the debt is repaid.
  let days = input.days;
  const m = maturityState(o.maturity, now);
  if (m.state === 'invalid') return stop('insufficient', 'تاریخ سررسید نامعتبر است.');
  if (m.state === 'matured') return stop('inactive', 'سررسید گذشته است.');
  if (m.state === 'active' && m.days !== null) {
    if (m.days > input.days) return stop('needs-model', `سررسید ${formatNumber(Math.ceil(m.days), 0)} روز دیگر؛ بستن لوپ پیش از آن مدل ندارد.`);
    days = m.days;
    if (m.days < input.days) assumptions.push(`لوپ در سررسید روز ${formatNumber(Math.ceil(m.days), 0)} بسته می‌شود؛ پس از آن نقد و بی‌درآمد.`);
  }

  const entry = input.entryCosts ?? [];
  const E0 = Math.max(0, input.capital - entry.reduce((a, c) => a + c.usd, 0));
  const maxSafe = maxLoopLeverage(l.maxLtv * 100, Math.max(1, lev.minHealth));
  let L = Math.min(maxSafe, lev.maxLeverage);
  // A PT loop (it has a maturity): the PT loop policy picks 3× or 2.5× for this market.
  const pt = m.state === 'active' && m.days !== null ? ptLoopLeverage({ impliedPct: l.collateral.yield.pct, borrowPct: loopBorrowPct(l.debt.side) as number, days: m.days, lltvPct: l.maxLtv * 100, pegVerified: l.pegVerified !== false, feePercent: 0 }) : null;
  if (pt) L = pt.leverage;
  if (!Number.isFinite(L) || L < 1) L = 1;
  if (!(L > 1)) return stop('needs-model', 'حد سلامت اجازه‌ی اهرم نمی‌دهد.');

  // Borrow capacity: the market cannot lend more than it has.
  let E = E0;
  const avail = l.debt.side.availableUsd;
  if (avail !== null && E * (L - 1) > avail) {
    E = avail / (L - 1);
    assumptions.push('نقدینگی قابل وام کمتر از نیاز این اهرم است؛ بخشی از سرمایه بی‌استفاده می‌ماند.');
  }
  if (avail === null) unknown.push('نقدینگی قابل وام گزارش نشده است.');
  if (!(E > 0)) return stop('no-capacity', 'نقدینگی قابل وام ندارد.');
  const G = E * L;
  const B = E * (L - 1);
  // A PT loop buys PT for the whole position (G), not just the capital. An executable quote at that
  // size, once it agrees with the market's rate, gives the rate actually paid (fee, conversion from
  // the debt asset and price impact included).
  let ptYield = l.collateral.yield.pct;
  let quoted = false;
  const q = pt ? (o.ptQuotes ?? []).find((x) => x.side === 'pt' && Math.abs(x.usd - G) <= G * 0.05) : undefined;
  if (q && m.days !== null) {
    const chk = quoteCheck(q, l.collateral.yield.pct, m.days);
    if (chk.ok && chk.quotePct !== null) {
      ptYield = chk.quotePct;
      quoted = true;
      assumptions.push(`نرخ PT از quote اجرایی پندل برای کل موقعیت (${formatNumber(G, 0)} دلار): ${formatPercent(chk.quotePct, 2)}؛ کارمزد، تبدیل دارایی و اثر قیمت در آن است.`);
    } else assumptions.push('quote اجرایی کل موقعیت با نرخ بازار نمی‌خواند و کنار گذاشته شد.');
  }
  if (pt && !quoted) unknown.push(o.ammFeeLn ? 'هزینه‌ی تبدیل دارایی وام به دارایی بازار و اثر قیمت خرید PT برای کل موقعیت (کارمزد AMM کم شد؛ quote اجرایی نگرفته)' : 'کارمزد و اثر قیمت خرید PT برای کل موقعیت (quote اجرایی نگرفته)');
  if (pt) unknown.push('هزینه‌ی بستن: تبدیل دارایی بازخریدشده به دارایی وام');
  // A PT collateral is bought in an AMM without a quote: keep the whole position small against it.
  if (o.poolLiquidityUsd !== undefined && !quoted) {
    const liq = o.poolLiquidityUsd;
    if (liq === null || !(liq > 0)) return stop('needs-model', 'نقدینگی استخر PT گزارش نشده؛ بدون quote برآورد نمی‌شود.');
    if (G > liq * MAX_POOL_SHARE_WITHOUT_QUOTE) return { ...stop('needs-model', 'حجم لوپ نسبت به نقدینگی استخر PT بزرگ است؛ quote لازم است.'), ...(o.ptMarket ? { quoteUsd: G } : {}) };
  }

  const r0 = loopBorrowPct(l.debt.side) as number;
  if (l.debt.side.ratePct7d != null && l.debt.side.ratePct7d > (l.debt.side.ratePct ?? 0)) assumptions.push(`بهره‌ی وام با میانگین ۷ روز (${formatPercent(l.debt.side.ratePct7d, 2)}) حساب شد، که از نرخ امروز بالاتر است.`);
  let r = r0;
  if (l.debt.side.curve) {
    const after = rateAfterBorrow(l.debt.side.curve, B, r0);
    if (after === null) unknown.push('نرخ وام پس از وام شما قابل محاسبه نبود؛ نرخ فعلی به کار رفت.');
    else r = after;
  } else unknown.push('اثر وام شما بر نرخ وام مدل نشده است.');

  const y = ptYield + (l.collateral.supplyPct ?? 0);
  const g0 = periodGrowth({ value: ptYield, kind: l.collateral.yield.kind }, days) ?? 0;
  // A PT whose SY fell under the PY index redeems for less than one unit.
  const gG = pt ? afterRedeem(g0, o.ptRedeemFactor) : g0;
  if (gG !== g0) assumptions.push(`نرخ تبدیل SY زیر شاخص PY است: هر PT در سررسید ${formatPercent((o.ptRedeemFactor as number) * 100, 2)} یک واحد را پس می‌دهد و همین حساب شد.`);
  const gS = l.collateral.supplyPct ? (periodGrowth({ value: l.collateral.supplyPct, kind: 'apy' }, days) ?? 0) : 0;
  const gB = periodGrowth({ value: r, kind: 'apy' }, days) ?? 0;
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
    policy: pt ? PT_LOOP_POLICY.version : lev.version,
    ...(pt ? { reason: PT_LEVERAGE_REASON[pt.reason] } : {}),
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
    pt
      ? `اهرم ${formatNumber(L, 2)}× طبق سیاست لوپ PT (${PT_LEVERAGE_REASON[pt.reason]}): ۳× یا ۲٫۵×، سلامت دست‌کم ${formatNumber(PT_LOOP_POLICY.minHealth, 2)} و تحمل جهش ${formatNumber(PT_LOOP_POLICY.rateBufferPp, 0)} واحد درصدی نرخ PT.`
      : `اهرم ${formatNumber(L, 2)}× طبق سیاست اهرم: سلامت دست‌کم ${formatNumber(lev.minHealth, 2)} و حداکثر ${formatNumber(lev.maxLeverage, 0)}×.`,
    `بازده وثیقه ${formatPercent(y, 2)} (${l.collateral.yield.source}) و نرخ وام ${formatPercent(r, 2)} برای کل دوره ثابت فرض شدند.`,
    `لیکوییدشدن اگر ارزش ${l.collateral.token.symbol} نسبت به ${l.debt.token.symbol} حدود ${formatPercent(liquidationDrop * 100, 1)} کم شود.`,
  );
  if (carryPct <= 0) assumptions.push('با نرخ‌های امروز هزینه‌ی وام از بازده وثیقه بیشتر است.');

  const unallocated = Math.max(0, E0 - E);
  const placement = placeOf(quality, net, E, input.capital);
  return {
    ...base,
    earningDays: days,
    allocatable: E,
    unallocated,
    unallocatedReason: unallocated > 0 ? 'نقدینگی قابل وام بازار کمتر از نیاز این اهرم است.' : null,
    rateNow: y,
    rateAfterEntry: E > 0 && days > 0 ? ((dG - dB) / E) * (365 / days) * 100 : null,
    baseIncome: dG,
    debtCost: dB,
    costs,
    unknown,
    net,
    netPct: (net / input.capital) * 100,
    assumptions,
    quality,
    placement,
    reason: reasonOf(placement),
    leverage: result,
  };
}
