import type { CostItem, DataQuality, Estimate, Opportunity, OpportunityFamily, Placement, RewardStream } from '../../types/opportunity';
import { maturityState } from '../protocols/lifecycle';
import { DAY_MS } from '../utils/math';
import { formatNumber, formatPercent } from '../utils/formatting';
import { askDepth, fillAsks, impliedApy, sellIntoBids, settlementFeeAt } from './book';
import { rateAfterDeposit } from './curve';
import { leverageEstimate, type LeverageInput } from './leverage';
import { MAX_POOL_SHARE_WITHOUT_QUOTE, MAX_RATE_AGE_HOURS } from './policy';
import { periodGrowth, simpleIncome } from './rates';

/**
 * «سود خالص قابل برآورد در این دوره» — the one number every family is ranked by:
 * what the user's capital earns in this opportunity over the user's period, at
 * today's rates, prices and known costs.
 *
 *   allocatable  A = min(capital − entry costs, capacity left)
 *   net = base income(A, earning days) + priced rewards(A, each to its own end)
 *         − debt cost − fees not already inside the rate − exit costs
 *
 * Rules that hold for every family:
 * - APR and APY are read the way the source publishes them (see rates.ts).
 * - Capital that does not fit is «unallocated», earns 0 and is shown apart.
 * - Fees already inside a rate or price are never deducted again; rewards already
 *   inside a rate are never added again; one campaign counts once.
 * - A reward counts until its own end, never past the period; without an end date
 *   it is not counted (a renewal is never assumed).
 * - Anything unknown is listed in `unknown`, never set to 0.
 * - Prices are held at today's reference; price moves are scenarios, kept out of net.
 */

export interface EstimateInput {
  capital: number;
  days: number;
  /** Known entry costs (gas, swap fee) — paid out of the capital before it is deployed. */
  entryCosts?: CostItem[];
  /** Known exit and claim costs. */
  exitCosts?: CostItem[];
  /** Costs that exist but could not be measured. */
  unknownCosts?: string[];
  /** Rate data older than this is stale. */
  maxAgeHours?: number;
  /** Leverage policy; without it a loop is not estimated. */
  leverage?: LeverageInput;
  now?: number;
}

/** Families whose value depends on more than a rate (price paths, points, debt) — no dollar estimate without their own model. */
export const SPECIALIST_FAMILIES = new Set<OpportunityFamily>(['yt', 'lp', 'leverage', 'borrow']);

export const DEFAULT_MAX_AGE_HOURS = MAX_RATE_AGE_HOURS;

const QUALITY_ORDER: DataQuality[] = ['current', 'partial', 'stale', 'insufficient'];
export const worseQuality = (a: DataQuality, b: DataQuality): DataQuality =>
  QUALITY_ORDER.indexOf(a) >= QUALITY_ORDER.indexOf(b) ? a : b;
export const qualityRank = (q: DataQuality) => QUALITY_ORDER.indexOf(q);

const sum = (items: CostItem[]) => items.reduce((a, c) => a + c.usd, 0);

/** How a reward is named on screen: its token, never the internal campaign key. */
export const rewardName = (r: RewardStream) => (r.kind === 'points' ? 'پوینت' : r.token?.symbol ? `پاداش ${r.token.symbol}` : 'پاداش');

/** Priced rewards for `amount` over `days`, each campaign once and only until its own end. */
export function rewardIncome(
  streams: RewardStream[],
  amount: number,
  days: number,
  now = Date.now(),
): { usd: number; lines: Estimate['rewardLines']; unknown: string[]; notes: string[] } {
  const lines: Estimate['rewardLines'] = [];
  const unknown: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const r of streams) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if (r.kind === 'points') continue; // points never enter the dollar sum
    if (r.conditional) {
      notes.push(`${rewardName(r)} شرط دریافت دارد؛ در برآورد لحاظ نشد.`);
      continue;
    }
    if (r.vesting) {
      notes.push(`${rewardName(r)} به‌تدریج آزاد می‌شود (vesting)؛ در برآورد لحاظ نشد.`);
      continue;
    }
    if (r.endsAt === null) {
      unknown.push(`تاریخ پایان ${rewardName(r)} نامعلوم است؛ لحاظ نشد.`);
      continue;
    }
    const left = (new Date(r.endsAt).getTime() - now) / DAY_MS;
    if (!Number.isFinite(left)) {
      unknown.push(`تاریخ پایان ${rewardName(r)} نامعتبر است؛ لحاظ نشد.`);
      continue;
    }
    const d = Math.max(0, Math.min(days, left));
    if (d === 0) continue;
    let usd: number | null = null;
    if (r.dailyUsd != null && r.eligibleTvlUsd != null && r.dailyUsd >= 0 && r.eligibleTvlUsd >= 0 && amount > 0) {
      usd = r.dailyUsd * (amount / (r.eligibleTvlUsd + amount)) * d;
    } else if (r.aprUsd !== null && Number.isFinite(r.aprUsd)) {
      usd = simpleIncome(amount, r.aprUsd, d);
      notes.push(`${rewardName(r)} با نرخ امروز حساب شد؛ رقیق‌شدن آن با ورود سرمایه‌ی شما داده نشده بود.`);
    }
    if (usd === null) {
      unknown.push(`ارزش دلاری ${rewardName(r)} معلوم نیست؛ لحاظ نشد.`);
      continue;
    }
    lines.push({ key: r.key, label: rewardName(r), usd, days: d, source: r.source });
  }
  return { usd: lines.reduce((a, l) => a + l.usd, 0), lines, unknown, notes };
}

export function estimate(o: Opportunity, input: EstimateInput): Estimate {
  const now = input.now ?? Date.now();
  const { capital, days } = input;
  const assumptions: string[] = ['همه‌ی قیمت‌ها با قیمت مرجع امروز ثابت فرض شده‌اند؛ تغییر قیمت فقط در سناریو می‌آید.', ...(o.notes ?? [])];
  const unknown: string[] = [...(input.unknownCosts ?? [])];
  let quality: DataQuality = o.quality;

  const base: Estimate = {
    key: o.key,
    capital,
    days,
    earningDays: days,
    allocatable: 0,
    unallocated: capital,
    unallocatedReason: null,
    rateNow: o.rate.value,
    rateAfterEntry: null,
    baseIncome: null,
    rewards: 0,
    rewardLines: [],
    debtCost: 0,
    costs: [],
    unknown,
    net: null,
    netPct: null,
    assumptions,
    quality,
    placement: 'insufficient',
  };
  const stop = (p: Placement, why: string): Estimate => ({ ...base, quality, placement: p, reason: why, assumptions: [...assumptions, why] });

  if (!(capital > 0) || !(days > 0)) return stop('insufficient', 'مبلغ و مدت باید بزرگ‌تر از صفر باشند.');
  if (o.quality === 'insufficient') return stop('insufficient', 'داده‌ی منبع برای برآورد کافی نیست.');
  if (o.risk?.paused) return stop('inactive', 'بازار متوقف یا منجمد است.');
  if (o.family === 'leverage' && o.loop && input.leverage) return leverageEstimate(o, input, input.leverage, base, now);
  if (SPECIALIST_FAMILIES.has(o.family)) return stop('needs-model', o.family === 'lp' ? 'نقدینگی: سود به مسیر قیمت بستگی دارد.' : o.family === 'yt' ? 'YT: ارزش خروج مدل قابل اتکا ندارد.' : 'به مدل جدا نیاز دارد.');

  // Horizon: a maturity inside it ends the earning there (cash earns nothing after, no
  // reinvestment); one after it would need an exit price at the horizon, which is not modelled.
  let earningDays = days;
  const m = maturityState(o.maturity, now);
  if (m.state === 'invalid') return stop('insufficient', 'تاریخ سررسید نامعتبر است.');
  if (m.state === 'matured') return stop('inactive', 'سررسید گذشته است.');
  if (m.state === 'active' && m.days !== null) {
    if (m.days > days) return stop('needs-model', `سررسید ${formatNumber(Math.ceil(m.days), 0)} روز دیگر؛ خروج پیش از آن مدل ندارد.`);
    earningDays = m.days;
    if (m.days < days) assumptions.push(`سررسید روز ${formatNumber(Math.ceil(m.days), 0)}؛ پس از آن نقد و بی‌درآمد.`);
  }

  // An AMM entry without an executable quote: only for amounts small against the pool.
  if (o.family === 'pt') {
    const liq = o.poolLiquidityUsd ?? null;
    if (liq === null || !(liq > 0)) return stop('needs-model', 'نقدینگی استخر گزارش نشده؛ بدون quote برآورد نمی‌شود.');
    if (capital > liq * MAX_POOL_SHARE_WITHOUT_QUOTE) return stop('needs-model', 'مبلغ نسبت به نقدینگی استخر بزرگ است؛ quote لازم است.');
    quality = worseQuality(quality, 'partial');
  }

  // Capital that fits.
  const entry = input.entryCosts ?? [];
  const spendable = Math.max(0, capital - sum(entry));
  if (o.book) return fixedFromBook(o, input, { base, assumptions, unknown, quality, entry, spendable, earningDays, now });
  if (o.family === 'pt') assumptions.push('Implied APY امروز تا سررسید؛ PT در سررسید یک واحد دارایی پایه می‌شود.');
  const cap = o.capacity.depositRemainingUsd;
  if (cap === null && !o.capacity.uncapped) unknown.push('ظرفیت باقی‌مانده‌ی سپرده گزارش نشده است.');
  const allocatable = cap === null ? spendable : Math.max(0, Math.min(spendable, cap));
  const unallocated = Math.max(0, capital - sum(entry) - allocatable);
  const unallocatedReason = unallocated > 0 ? 'ظرفیت باقی‌مانده کمتر از مبلغ شماست؛ این بخش درآمدی ندارد.' : null;
  if (!(allocatable > 0)) return { ...stop('no-capacity', 'ظرفیت سپرده پر است.'), unallocated, unallocatedReason };

  // The rate after the user's own deposit moves utilization, when the curve is known.
  let rateAfterEntry = o.rate.value;
  if (o.rate.value !== null && o.supplyCurve) {
    const r = rateAfterDeposit(o.supplyCurve, allocatable, o.rate.value);
    if (r === null) unknown.push('نرخ پس از ورود سرمایه‌ی شما قابل محاسبه نبود؛ نرخ فعلی به کار رفت.');
    else {
      rateAfterEntry = r;
      assumptions.push(`نرخ پس از ورود سرمایه‌ی شما از منحنی نرخ (${o.supplyCurve.source}) حساب و برای کل دوره ثابت فرض شد.`);
    }
  } else if (o.rate.value !== null && (o.family === 'lend' || o.family === 'vault')) {
    unknown.push('اثر ورود سرمایه‌ی شما بر نرخ مدل نشده است؛ نرخ فعلی به کار رفت.');
  }

  // Base income at that rate, read as published.
  const growth = periodGrowth({ ...o.rate, value: rateAfterEntry }, earningDays);
  if (o.rate.kind === 'unknown') {
    assumptions.push('نوع نرخ (APR یا APY) اعلام نشده؛ به‌صورت ساده و محافظه‌کارانه حساب شد.');
    quality = worseQuality(quality, 'partial');
  }
  if (growth === null) {
    return {
      ...stop('insufficient', o.rate.kind === 'quote' ? 'درآمد این فرصت از قیمت قابل اجرا برای مبلغ شما می‌آید و به مدل همان خانواده نیاز دارد.' : 'نرخ پایه در دسترس نیست.'),
      earningDays,
      allocatable,
      unallocated,
      unallocatedReason,
      rateAfterEntry,
    };
  }
  const baseIncome = allocatable * growth;

  // Fees: only those not already inside the rate.
  const costs: CostItem[] = [...entry];
  const fees = o.rate.fees;
  if (o.rate.feesIncluded === false) {
    const perf = fees?.performancePct;
    const mgmt = fees?.managementPct;
    if (perf == null && mgmt == null) {
      unknown.push('کارمزد عملکرد یا مدیریت از نرخ کم نشده و مقدارش مشخص نیست.');
      quality = worseQuality(quality, 'partial');
    }
    if (perf != null && perf > 0 && baseIncome > 0) costs.push({ key: 'performance-fee', label: 'کارمزد عملکرد', usd: (baseIncome * perf) / 100, basis: 'model' });
    if (mgmt != null && mgmt > 0) costs.push({ key: 'management-fee', label: 'کارمزد مدیریت', usd: simpleIncome(allocatable, mgmt, earningDays), basis: 'model' });
  } else if (o.rate.feesIncluded === 'unknown') {
    unknown.push('معلوم نیست نرخ اعلامی پیش یا پس از کارمزد است.');
    quality = worseQuality(quality, 'partial');
  }

  // Rewards: once per campaign, never on top of a rate that already contains them.
  let rewards = 0;
  let rewardLines: Estimate['rewardLines'] = [];
  const priced = o.rewards.filter((r) => r.kind === 'token');
  if (priced.length && o.rate.rewardsIncluded === true) {
    assumptions.push('پاداش‌ها در نرخ اعلامی هستند؛ برای جلوگیری از دوباره‌شماری جدا اضافه نشدند.');
  } else if (priced.length && o.rate.rewardsIncluded === 'unknown') {
    unknown.push('معلوم نیست نرخ اعلامی پاداش را شامل می‌شود یا نه؛ پاداش جدا اضافه نشد.');
    quality = worseQuality(quality, 'partial');
  } else if (priced.length) {
    const r = rewardIncome(o.rewards, allocatable, earningDays, now);
    rewards = r.usd;
    rewardLines = r.lines;
    unknown.push(...r.unknown);
    assumptions.push(...r.notes);
    if (r.lines.length) assumptions.push('هر پاداش فقط تا پایان کمپین خودش شمرده شد؛ تمدید کمپین فرض نشده.');
  }

  // Exit.
  const exitCosts = [...(input.exitCosts ?? [])];
  if (o.exit.feePct != null && o.exit.feePct > 0) {
    exitCosts.push({ key: 'exit-fee', label: 'کارمزد برداشت', usd: ((allocatable + baseIncome) * o.exit.feePct) / 100, basis: 'model' });
  }
  if (o.exit.type === 'unknown') unknown.push('شرایط خروج گزارش نشده است.');
  const w = o.capacity.withdrawableNowUsd;
  if (w === null && o.exit.type !== 'maturity') unknown.push('نقدینگی قابل برداشت فوری گزارش نشده است.');
  else if (w < allocatable) assumptions.push('خروج فوری کل مبلغ ممکن نیست؛ نقدینگی قابل برداشت کمتر از مبلغ شماست.');
  costs.push(...exitCosts);

  // Staleness of the rate.
  const at = o.rate.at ? new Date(o.rate.at).getTime() : NaN;
  const maxAge = (input.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3_600_000;
  if (Number.isFinite(at) && now - at > maxAge) quality = worseQuality(quality, 'stale');
  if (!Number.isFinite(at)) unknown.push('زمان به‌روزرسانی نرخ در منبع گزارش نشده است.');

  const debtCost = 0;
  const net = baseIncome + rewards - debtCost - sum(costs);
  const netPct = (net / capital) * 100;

  const placement = placeOf(quality, net, allocatable, capital);

  return {
    reason: reasonOf(placement),
    key: o.key,
    capital,
    days,
    earningDays,
    allocatable,
    unallocated,
    unallocatedReason,
    rateNow: o.rate.value,
    rateAfterEntry,
    baseIncome,
    rewards,
    rewardLines,
    debtCost,
    costs,
    unknown,
    net,
    netPct,
    assumptions,
    quality,
    placement,
  };
}

/**
 * Placement from quality and the result. Capital that does not fit already earns
 * nothing in `net`, so a partly-filled opportunity still competes on its dollars.
 */
export const placeOf = (quality: DataQuality, net: number, allocatable: number, capital: number): Placement =>
  quality === 'insufficient'
    ? 'insufficient'
    : quality === 'stale'
      ? 'stale'
      : !(allocatable > 0) || !(capital > 0)
        ? 'no-capacity'
        : !(net > 0)
          ? 'unprofitable'
          : 'ranked';

/** A short default reason for a placement that has no specific one. */
export const reasonOf = (p: Placement): string | null =>
  p === 'ranked' ? null : p === 'unprofitable' ? 'هزینه‌ها از درآمد این دوره بیشترند.' : p === 'stale' ? 'داده‌ی منبع قدیمی است.' : p === 'no-capacity' ? 'ظرفیت ندارد.' : p === 'insufficient' ? 'داده‌ی کافی نیست.' : null;

/**
 * Fixed rate held to maturity, priced from the order book for the user's own
 * amount (see book.ts). Only reached when the maturity falls inside the horizon:
 * the units redeem at maturity and the cash earns nothing after it.
 */
function fixedFromBook(
  o: Opportunity,
  input: EstimateInput,
  ctx: { base: Estimate; assumptions: string[]; unknown: string[]; quality: DataQuality; entry: CostItem[]; spendable: number; earningDays: number; now: number },
): Estimate {
  const b = o.book!;
  const { assumptions, unknown, entry, spendable, earningDays, now } = ctx;
  let quality = ctx.quality;
  const maturityMs = o.maturity ? new Date(o.maturity).getTime() : NaN;
  const secLeft = (maturityMs - now) / 1000;
  const daysLeft = secLeft / 86_400;
  if (!(secLeft > 0) || !(b.unitUsd > 0)) return { ...ctx.base, quality: 'insufficient', placement: 'insufficient', assumptions: [...assumptions, !(b.unitUsd > 0) ? 'قیمت دلاری توکن وام معلوم نیست.' : 'سررسید معتبر نیست.'] };

  const sf = settlementFeeAt(b.settlementFee, secLeft);
  const cf = b.continuousFeePerYear.value;
  const fill = fillAsks(b.asks, spendable / b.unitUsd, sf);
  const allocatable = fill.spent * b.unitUsd;
  const unallocated = Math.max(0, input.capital - sum(entry) - allocatable);
  const cfTokens = fill.units * cf * (daysLeft / 365);
  const baseIncome = (fill.units - fill.spent) * b.unitUsd;
  const costs: CostItem[] = [...entry];
  if (cfTokens > 0) costs.push({ key: 'continuous-fee', label: b.continuousFeePerYear.basis === 'max' ? 'کارمزد پیوسته (بیشینه‌ی مجاز)' : 'کارمزد پیوسته', usd: cfTokens * b.unitUsd, basis: 'model' });
  costs.push(...(input.exitCosts ?? []));

  const best = [...b.asks].filter((l) => l.units > 0).sort((x, y) => x.price - y.price)[0];
  const rateNow = best ? impliedApy(best.price + sf, 1, daysLeft) : null;
  const rateAfterEntry = impliedApy(fill.spent, fill.units - cfTokens, daysLeft);
  const exit = sellIntoBids(b.bids, fill.units, sf);

  const feeWord = b.settlementFee.basis === 'max' ? 'بیشینه‌ی مجاز پروتکل (محافظه‌کارانه؛ مقدار واقعی بازار خوانده نشد)' : 'مقدار همین بازار';
  assumptions.push(
    `مبلغ شما در دفتر فروش پر شد، سطح به سطح؛ میانگین قیمت ${fill.averagePrice === null ? '—' : formatNumber(fill.averagePrice, 4)} به‌جای بهترین قیمت ${best ? formatNumber(best.price + sf, 4) : '—'}.`,
    `کارمزد تسویه ${formatPercent(sf * 100, 3)} از هر واحد، در قیمت خرید لحاظ شده و جدا کم نمی‌شود؛ ${feeWord}.`,
    `کارمزد پیوسته ${formatPercent(cf * 100, 2)} در سال روی واحدها تا سررسید؛ ${b.continuousFeePerYear.basis === 'max' ? 'بیشینه‌ی مجاز پروتکل' : 'مقدار همین بازار'}.`,
    'نرخ ثابت یعنی قیمت خرید ثابت است، نه تضمین بازگشت اصل سرمایه؛ نکول وام‌گیرنده و لیکوییدیشن ناکافی وثیقه ممکن است.',
  );
  if (b.gated) {
    quality = worseQuality(quality, 'partial');
    assumptions.push('ورود به این بازار ممکن است به نشانی‌های مجاز محدود باشد (gate)؛ خروج همیشه ممکن است.');
  }
  if (b.bids.length === 0) unknown.push('خریداری در دفتر خرید نیست؛ خروج پیش از سررسید فعلاً ممکن نیست.');
  if (fill.units === 0) unknown.push('دفتر فروش برای این بازار خالی است.');

  const net = baseIncome - sum(costs);
  const unallocatedReason = unallocated > 0 ? `عمق دفتر فروش فقط ${formatNumber(askDepth(b.asks, sf) * b.unitUsd, 0)} دلار را جذب می‌کند؛ بقیه درآمدی ندارد.` : null;
  return {
    ...ctx.base,
    earningDays,
    allocatable,
    unallocated,
    unallocatedReason,
    rateNow,
    rateAfterEntry,
    baseIncome,
    costs,
    unknown,
    net,
    netPct: (net / input.capital) * 100,
    assumptions,
    quality,
    placement: fill.units === 0 ? 'no-capacity' : placeOf(quality, net, allocatable, input.capital),
    reason: fill.units === 0 ? 'دفتر فروش خالی است.' : reasonOf(placeOf(quality, net, allocatable, input.capital)),
    exitToday: fill.units > 0 ? { usd: exit.sold > 0 ? exit.proceeds * b.unitUsd : null, complete: exit.sold >= fill.units * 0.999 } : null,
  };
}
