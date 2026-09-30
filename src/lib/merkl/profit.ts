import { hasBoost, restrictions } from './rules';
import { checkRewardPrice, gate, isDollarLike, isMeme, isYieldToken, allowedMemes, type PriceCheck, type Reason, type VetContext } from './vetting';
import type { GasQuote, MerklAction, MerklCampaign, MerklOpportunity, MerklToken } from './types';
import { formatPercent } from '../utils/formatting';
import type { CostItem } from '../../types/opportunity';

/**
 * «سود خالص برآوردی» — the estimated net profit of putting the user's capital into
 * one Merkl opportunity for a common horizon, at today's rates, prices and costs.
 *
 *   net = Σ incentive_c + native − known costs
 *
 * - incentive_c: each live campaign on its own — its rate rule, the user's diluted
 *   share, its own end date clipped to the horizon, valued at the reward token's
 *   current price. Points and pre-TGE tokens never enter the dollar sum.
 * - native: the activity's own yield when Merkl reports a credible one and it is
 *   not already inside a campaign's APR (target / net-APR campaigns include it).
 * - known costs: gas (measured on Ethereum, the user's assumption elsewhere),
 *   claim gas on the reward chain, a pool's swap fee, and the price impact of
 *   selling the rewards into the DEX liquidity that exists today.
 * Costs that cannot be measured are listed, never guessed; the number is then
 * «net of the costs counted».
 *
 * A conservative scenario beside it: competing TVL 25% higher, reward prices 20%
 * lower, no native yield.
 */

const DAY = 86_400;

/** Any whole number of days from 1 to 365; the presets are shortcuts only. */
export type Horizon = number;
export const HORIZONS = [7, 30, 90] as const;
export const MIN_HORIZON = 1;
export const MAX_HORIZON = 365;
export const clampHorizon = (d: number) => (Number.isFinite(d) ? Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.round(d))) : 30);

export interface EstimateSettings {
  capital: number;
  horizon: Horizon;
  /** USD per transaction on Ethereum when the gas price could not be measured. */
  txEthereum: number;
  /** USD per transaction on every other network (assumption). */
  txOther: number;
}

export const defaultEstimateSettings: EstimateSettings = { capital: 1000, horizon: 30, txEthereum: 1, txOther: 0.05 };

export const CONSERVATIVE = { tvlUp: 0.25, priceDown: 0.2 } as const;

/** Native APR above this is not trusted. */
export const NATIVE_APR_MAX = 100;
/** Activities where capital becomes an eligible position one-to-one. */
export const CAPITAL_ACTIONS = new Set<MerklAction>(['HOLD', 'LEND', 'POOL', 'STAKE']);

// ─── Gas ─────────────────────────────────────────────────────────────────────

/** Typical gas units per step (EVM). */
export const GAS_UNITS = { approve: 50_000, deposit: 200_000, withdraw: 180_000, swap: 180_000, addLiquidity: 300_000, removeLiquidity: 250_000, claim: 150_000 } as const;
type Step = keyof typeof GAS_UNITS;

const STEPS: Record<'HOLD' | 'LEND' | 'POOL' | 'STAKE', { entry: Step[]; exit: Step[] }> = {
  HOLD: { entry: ['approve', 'swap'], exit: ['swap'] },
  LEND: { entry: ['approve', 'deposit'], exit: ['withdraw'] },
  STAKE: { entry: ['approve', 'deposit'], exit: ['withdraw'] },
  POOL: { entry: ['approve', 'approve', 'addLiquidity'], exit: ['removeLiquidity'] },
};

/** Shared with the protocol-independent estimate engine. */
export type { CostItem };

function gasCost(chainId: number, steps: Step[], s: EstimateSettings, gas: GasQuote[]): { usd: number; basis: 'measured' | 'assumed' } {
  const q = gas.find((g) => g.chainId === chainId);
  if (q && q.gwei > 0 && q.nativeUsd > 0) {
    const units = steps.reduce((a, st) => a + GAS_UNITS[st], 0);
    return { usd: units * q.gwei * 1e-9 * q.nativeUsd, basis: 'measured' };
  }
  return { usd: steps.length * (chainId === 1 ? s.txEthereum : s.txOther), basis: 'assumed' };
}

/** Swap fee tier written in a pool's name («… 0.05%»), as a fraction. */
export function poolFeeTier(o: MerklOpportunity): number | null {
  if (o.action !== 'POOL') return null;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(o.name);
  if (!m) return null;
  const f = Number(m[1]) / 100;
  return f > 0 && f <= 0.03 ? f : null;
}

/** Loss from selling `v` dollars into a constant-product pool holding `liquidity` dollars in total. */
export const sellImpact = (v: number, liquidity: number) => (liquidity > 0 && v > 0 ? (v * v) / (liquidity / 2 + v) : 0);

// ─── Native yield ────────────────────────────────────────────────────────────

export interface NativeYield {
  /** % per year counted in the estimate; 0 when not counted. */
  apr: number;
  counted: boolean;
  note: string;
}

/** Merkl reports the campaign APR as already containing the native yield (net-APR / target campaigns). */
export const nativeInsideCampaign = (o: MerklOpportunity) =>
  o.campaigns.some((c) => c.rateKind === 'target') || (o.nativeApr !== null && o.nativeApr > 0 && o.totalApr !== null && Math.abs(o.totalApr - o.apr) < 1e-6);

/** Native yield measured longer ago than this is not counted. */
export const NATIVE_MAX_AGE_H = 48;

export function nativeYield(o: MerklOpportunity, now = Date.now() / 1000): NativeYield {
  const n = o.nativeApr;
  if (n === null) return { apr: 0, counted: false, note: 'بازده بومی گزارش نشده؛ صفر در نظر گرفته شد' };
  if (o.nativeAt === null || now - o.nativeAt > NATIVE_MAX_AGE_H * 3600) return { apr: 0, counted: false, note: 'بازده بومی گزارش‌شده قدیمی است؛ لحاظ نشد' };
  if (o.nativeSource === null) return { apr: 0, counted: false, note: `بازده بومی ${formatPercent(n, 1)} فقط اعلامی است و Merkl روش اندازه‌گیری‌اش را نداده؛ لحاظ نشد` };
  if (!(n >= 0 && n <= NATIVE_APR_MAX) || o.tokens.some(isYieldToken)) return { apr: 0, counted: false, note: 'بازده بومی گزارش‌شده نامعتبر است؛ لحاظ نشد' };
  if (o.action === 'BORROW') return { apr: 0, counted: false, note: 'بازده سپرده، نه هزینه‌ی وام؛ لحاظ نشد' };
  const target = o.campaigns.some((c) => c.rateKind === 'target');
  if (!target && nativeInsideCampaign(o)) return { apr: 0, counted: false, note: 'Merkl این بازده را درون APR کمپین گزارش کرده؛ برای جلوگیری از دوباره‌شماری جدا اضافه نشد' };
  return { apr: n, counted: n > 0, note: o.action === 'POOL' ? 'کارمزد معاملات استخر به نرخ فعلی؛ با حجم معاملات تغییر می‌کند' : 'بازده بومی پروتکل به نرخ فعلی (گزارش Merkl)' };
}

// ─── One campaign ────────────────────────────────────────────────────────────

export interface CampaignCalc {
  c: MerklCampaign;
  /** Days counted inside the horizon, and days until the campaign ends. */
  days: number;
  daysToEnd: number;
  status: 'ok' | 'approx' | 'none';
  note: string | null;
  /** Reward units per day for the deployed capital. */
  unitsPerDay: number | null;
  /** Incentive APR for this capital, % (in dollars at today's price when priced). */
  apr: number | null;
  /** Dollar value per day at today's (validated) price; null when not priced. */
  usdPerDay: number | null;
  price: PriceCheck;
  /** Conservative USD per day. */
  usdPerDayLow: number | null;
}

/** Eligible TVL of one campaign — the opportunity TVL is the maximum across campaigns, not this. */
export function campaignTvl(c: MerklCampaign, o: MerklOpportunity): { tvl: number; derived: boolean } {
  if (c.apr > 0 && c.dailyUsd > 0 && c.rateKind !== 'target') return { tvl: (c.dailyUsd * 365) / (c.apr / 100), derived: true };
  return { tvl: o.tvl, derived: false };
}

function depositPrice(o: MerklOpportunity): number | null {
  const priced = o.tokens.filter((t) => t.type === 'TOKEN' && t.price !== null);
  return priced.length === 1 ? (priced[0].price as number) : null;
}

export function calcCampaign(c: MerklCampaign, o: MerklOpportunity, deployed: number, horizon: number, ctx: VetContext): CampaignCalc {
  const now = ctx.now;
  const daysToEnd = Math.max(0, (c.end - now) / DAY);
  const days = Math.min(horizon, daysToEnd);
  const t = c.rewardToken;
  const price = checkRewardPrice(t, ctx);
  const base = { c, days, daysToEnd, unitsPerDay: null, apr: null, usdPerDay: null, usdPerDayLow: null, price };
  const none = (note: string): CampaignCalc => ({ ...base, status: 'none', note });
  const r = restrictions(c);
  if (r.length) return none(`شرط دسترسی: ${r.join('، ')}`);
  if (c.clmm) return none('نقدینگی متمرکز: پاداش به بازه‌ی قیمت و کارمزد بستگی دارد؛ مقدار واجد شرایط معلوم نیست');
  if (!(deployed > 0)) return none('سرمایه‌ی مؤثر صفر است');

  const { tvl, derived } = campaignTvl(c, o);
  // Merkl's price is used for the rate arithmetic (fixed-value campaigns are defined in it); dollars only when validated.
  const p = t.price;
  let usdRaw: number | null = null; // USD/day at Merkl's price, before validation
  let usdLowRaw: number | null = null;
  let units: number | null = null;
  const notes: string[] = [];

  switch (c.rateKind) {
    case 'pool': {
      if (!(tvl > 0)) return none('TVL واجد شرایط نامعلوم است');
      const share = deployed / (tvl + deployed);
      const shareLow = deployed / (tvl * (1 + CONSERVATIVE.tvlUp) + deployed);
      if (c.dailyUnits !== null) units = c.dailyUnits * share;
      if (c.dailyUsd > 0) {
        usdRaw = c.dailyUsd * share;
        usdLowRaw = c.dailyUsd * shareLow;
      } else if (units !== null && p !== null) {
        usdRaw = units * p;
        usdLowRaw = c.dailyUnits! * shareLow * p;
      }
      if (!derived) notes.push('TVL این کمپین جدا گزارش نشده؛ از TVL کل فرصت استفاده شد');
      break;
    }
    case 'capped': {
      const cap = c.capApr as number;
      const len = (c.end - c.start) / DAY;
      const budgetDaily = c.budget !== null && p !== null && len > 0 ? (c.budget * p) / len : null;
      const aprAt = (tv: number) => (budgetDaily !== null ? Math.min(cap, ((budgetDaily * 365) / (tv + deployed)) * 100) : Math.min(cap, (c.apr * tv) / (tv + deployed)));
      usdRaw = (deployed * aprAt(tvl)) / 100 / 365;
      usdLowRaw = (deployed * aprAt(tvl * (1 + CONSERVATIVE.tvlUp))) / 100 / 365;
      if (p !== null) units = usdRaw / p;
      if (budgetDaily === null) notes.push('بودجه‌ی روزانه معلوم نیست؛ با APR فعلی و رقیق‌شدن حساب شد');
      break;
    }
    case 'fixedValue':
      usdRaw = usdLowRaw = (deployed * (c.rate as number)) / 365;
      if (p !== null) units = usdRaw / p;
      notes.push('نرخ ثابت؛ اگر بودجه‌ی کمپین تمام شود زودتر پایان می‌یابد');
      break;
    case 'fixedAmount':
      units = (deployed * (c.rate as number)) / 365;
      if (p !== null) usdRaw = usdLowRaw = units * p;
      break;
    case 'fixedPerUnit': {
      const dp = depositPrice(o);
      if (dp === null) return none('قیمت توکن سپرده برای تبدیل دلار به واحد معلوم نیست');
      units = ((deployed / dp) * (c.rate as number)) / 365;
      if (p !== null) usdRaw = usdLowRaw = units * p;
      break;
    }
    case 'target': {
      // The campaign APR is a target that includes the native yield; Merkl pays only the gap.
      const rewardApr = c.dailyUsd > 0 && o.tvl > 0 ? ((c.dailyUsd * 365) / o.tvl) * 100 : Math.max(0, c.apr - Math.max(0, o.nativeApr ?? 0));
      if (!(o.tvl > 0) || deployed / o.tvl > 0.01) return none('کمپین هدف‌محور: با این سرمایه نسبت به TVL قابل برآورد نیست');
      usdRaw = usdLowRaw = (deployed * rewardApr) / 100 / 365;
      if (p !== null) units = usdRaw / p;
      notes.push('تکمیل تا نرخ هدف: فقط فاصله‌ی هدف تا بازده بومی پرداخت می‌شود');
      break;
    }
    case 'airdrop':
      return none('پاداش بیرون از Merkl محاسبه می‌شود');
    default:
      return none('سازوکار این کمپین مدل نشده است');
  }

  if (hasBoost(c)) notes.push('دیگران ممکن است ضریب بگیرند؛ سهم کیف‌پول عادی می‌تواند کمتر باشد');
  const status = notes.some((n) => !n.startsWith('نرخ ثابت') && !n.startsWith('تکمیل تا')) ? 'approx' : 'ok';
  const note = notes.join(' · ') || null;
  if (t.type !== 'TOKEN' || !price.ok) return { ...base, status, note, unitsPerDay: units };
  const apr = usdRaw !== null ? ((usdRaw * 365) / deployed) * 100 : null;
  return { ...base, status, note, unitsPerDay: units, apr, usdPerDay: usdRaw, usdPerDayLow: usdLowRaw === null ? null : usdLowRaw * (1 - CONSERVATIVE.priceDown) };
}

// ─── One opportunity ─────────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low';

export interface Estimate {
  ok: true;
  o: MerklOpportunity;
  capital: number;
  horizon: number;
  /** Capital that ends up in the position after entry costs. */
  deployed: number;
  campaigns: CampaignCalc[];
  incentiveUsd: number;
  native: NativeYield;
  nativeUsd: number;
  costs: CostItem[];
  knownCostUsd: number;
  unknownCosts: string[];
  /** Base scenario over the horizon. */
  net: number;
  /** Conservative scenario over the horizon. */
  netLow: number;
  /** Each campaign to its own end (native over the longest one). */
  netToEnd: number;
  daysToEnd: number;
  /** Incentive APR for this capital in dollars, %; Merkl's pool APR is o.apr. */
  incentiveApr: number;
  confidence: Confidence;
  why: string[];
  risks: string[];
  /** A Robinhood-Chain memecoin is involved (very high risk). */
  meme: boolean;
  /** Oldest timestamp the number depends on (seconds). */
  dataAt: number;
}

export interface NoEstimate {
  ok: false;
  o: MerklOpportunity;
  reason: Reason;
}

const no = (o: MerklOpportunity, code: string, label: string): NoEstimate => ({ ok: false, o, reason: { code, label } });

const ACTION_REASON: Partial<Record<MerklAction, [string, string]>> = {
  BORROW: ['borrow', 'وام‌گیری: نرخ وام و نسبت وام به وثیقه در داده‌ی Merkl نیست؛ سود خالص قابل برآورد نیست'],
  SWAP: ['swap', 'سواپ: پاداش به حجم معامله بستگی دارد، نه سرمایه'],
  DROP: ['drop', 'توزیع خارجی: قاعده‌ی پاداش بیرون از Merkl است'],
  LONG: ['leverage', 'موقعیت اهرمی: به قیمت و نقدشدن بستگی دارد'],
  SHORT: ['leverage', 'موقعیت اهرمی: به قیمت و نقدشدن بستگی دارد'],
  OTHER: ['action', 'نوع فعالیت روشن نیست'],
};

export const needsLoop = (o: MerklOpportunity) => /loop/i.test(o.name) || o.campaigns.some((c) => c.hooks.some((h) => h.type === 17));

function risksOf(o: MerklOpportunity, meme: boolean): string[] {
  const out: string[] = [];
  const volatile = o.tokens.filter((t) => t.type === 'TOKEN' && !isDollarLike(t));
  if (o.action === 'POOL') {
    out.push(volatile.length ? 'زیان ناپایدار: با تغییر نسبت قیمت دو دارایی، ارزش سهم شما از نگه‌داشتن ساده کمتر می‌شود؛ بدون پیش‌بینی قیمت به دلار تبدیل نشده' : 'استخر استیبل: زیان ناپایدار کم است ولی در صورت جدا شدن از دلار (depeg) صفر نیست');
  } else if (volatile.length) out.push(`نوسان قیمت ${volatile.map((t) => t.symbol).join('، ')}: سود دلاری بالا شامل تغییر ارزش خود دارایی نیست`);
  if (o.action === 'LEND') out.push('ریسک قرارداد و بازار وام: برداشت ممکن است هنگام بهره‌وری بالا موقتاً ممکن نباشد');
  if (o.protocol && o.protocol.hacks > 0) out.push('سابقه‌ی هک در پروتکل');
  if (meme) out.push('میم‌کوین Robinhood Chain: ریسک بسیار بالا — قیمت می‌تواند در مدت کوتاه چند برابر یا نزدیک صفر شود');
  return out;
}

/** Personal estimate for one opportunity, or the reason there is none. Assumes `gate` already passed. */
export function estimate(o: MerklOpportunity, s: EstimateSettings, ctx: VetContext, gas: GasQuote[] = []): Estimate | NoEstimate {
  const now = ctx.now;
  if (!(s.capital > 0)) return no(o, 'capital', 'سرمایه وارد نشده');
  const actionWhy = ACTION_REASON[o.action];
  if (!CAPITAL_ACTIONS.has(o.action) && actionWhy) return no(o, actionWhy[0], actionWhy[1]);
  if (needsLoop(o)) return no(o, 'loop', 'نیاز به لوپ/اهرم: به نرخ وام و ریسک نقدشدن بستگی دارد؛ عدد دلاری ساخته نشد');
  if (o.tokens.some(isYieldToken)) return no(o, 'yt', 'نگه‌داری YT: ارزش خود YT تا سررسید کم می‌شود؛ برای برآورد از بخش YT یلدایکس استفاده کنید');

  const kind = o.action as keyof typeof STEPS;
  const live = o.campaigns.filter((c) => c.start <= now && c.end > now);

  // Entry costs come out of the capital before it earns anything.
  const costs: CostItem[] = [];
  const entryGas = gasCost(o.chain.id, STEPS[kind].entry, s, gas);
  const exitGas = gasCost(o.chain.id, STEPS[kind].exit, s, gas);
  costs.push({ key: 'gas-entry', label: 'گس ورود', usd: entryGas.usd, basis: entryGas.basis });
  const fee = poolFeeTier(o);
  const poolFeeEntry = fee !== null ? (s.capital / 2) * fee : 0;
  if (fee !== null) costs.push({ key: 'pool-fee', label: `کارمزد سواپ نیمی از سرمایه در استخر (${formatPercent(fee * 100, 3)}) در ورود و خروج`, usd: poolFeeEntry * 2, basis: 'model' });
  const deployed = s.capital - entryGas.usd - poolFeeEntry;
  if (!(deployed > 0)) return no(o, 'cost', 'هزینه‌ی ورود از سرمایه بیشتر است');

  const campaigns = live.map((c) => calcCampaign(c, o, deployed, s.horizon, ctx));
  const tokenCampaigns = campaigns.filter((x) => x.c.rewardToken.type === 'TOKEN');
  // A campaign that pays real value but cannot be modelled would make the total misleading.
  const blocking = campaigns.find((x) => x.status === 'none' && !restrictions(x.c).length && (x.c.dailyUsd > 0 || x.c.rewardToken.type !== 'TOKEN'));
  if (blocking) return no(o, 'model', blocking.note ?? 'قابل برآورد نیست');
  const priced = tokenCampaigns.filter((x) => x.usdPerDay !== null && x.usdPerDay > 0);
  if (!priced.length) {
    const failed = tokenCampaigns.find((x) => x.status !== 'none' && !x.price.ok);
    if (failed?.price.reason) return no(o, failed.price.reason.code, failed.price.reason.label);
    if (campaigns.some((x) => x.status !== 'none' && x.c.rewardToken.type !== 'TOKEN')) return no(o, 'units-only', 'فقط پوینت یا توکن عرضه‌نشده؛ در بخش «رتبه‌بندی توکن و پوینت» ببینید');
    return no(o, 'no-reward', 'پاداش قیمت‌دار قابل برآوردی ندارد');
  }

  const incentiveUsd = priced.reduce((a, x) => a + (x.usdPerDay as number) * x.days, 0);
  const incentiveLow = priced.reduce((a, x) => a + (x.usdPerDayLow ?? 0) * x.days, 0);
  const incentiveToEnd = priced.reduce((a, x) => a + (x.usdPerDay as number) * x.daysToEnd, 0);
  const daysToEnd = Math.max(...priced.map((x) => x.daysToEnd));

  const native = nativeYield(o, now);
  const nativePerDay = native.counted ? (deployed * native.apr) / 100 / 365 : 0;

  costs.push({ key: 'gas-exit', label: 'گس خروج', usd: exitGas.usd, basis: exitGas.basis });
  const claimChains = [...new Set(priced.map((x) => x.c.distributionChainId))];
  for (const chainId of claimChains) {
    const g = gasCost(chainId, ['claim'], s, gas);
    costs.push({ key: `claim-${chainId}`, label: chainId === o.chain.id ? 'گس دریافت (claim) پاداش' : 'گس دریافت پاداش در شبکه‌ی توزیع', usd: g.usd, basis: g.basis });
  }

  // Selling the rewards: price impact where DEX depth is known; per token, summed over the horizon.
  const unknownCosts: string[] = [];
  const byToken = new Map<string, { t: MerklToken; usd: number; usdToEnd: number; liq: number | null; deep: boolean }>();
  for (const x of priced) {
    const k = `${x.c.rewardToken.chainId}:${x.c.rewardToken.address.toLowerCase()}`;
    const e = byToken.get(k) ?? { t: x.c.rewardToken, usd: 0, usdToEnd: 0, liq: x.price.market?.liquidityUsd ?? null, deep: x.price.depth === 'deep' };
    e.usd += (x.usdPerDay as number) * x.days;
    e.usdToEnd += (x.usdPerDay as number) * x.daysToEnd;
    byToken.set(k, e);
  }
  let impact = 0;
  let impactToEnd = 0;
  for (const e of byToken.values()) {
    if (e.deep) continue;
    if (e.liq === null) {
      unknownCosts.push(`اثر قیمت فروش ${e.t.symbol} (نقدشوندگی نامعلوم)`);
      continue;
    }
    impact += sellImpact(e.usd, e.liq);
    impactToEnd += sellImpact(e.usdToEnd, e.liq);
  }
  if (impact > 0) costs.push({ key: 'sell-impact', label: 'اثر قیمت فروش پاداش در نقدشوندگی فعلی DEX', usd: impact, basis: 'model' });

  const depositStable = o.tokens.filter((t) => t.type === 'TOKEN').every(isDollarLike);
  if (o.action === 'HOLD' || !depositStable) unknownCosts.push('اسپرد و اسلیپیج تبدیل دلار به دارایی ورودی و برگشت');
  if (o.action === 'POOL' && fee === null) unknownCosts.push('کارمزد سواپ برای متوازن‌کردن دو دارایی استخر');
  if (o.action === 'LEND' || o.action === 'STAKE') unknownCosts.push('کارمزد سپرده/برداشت یا عملکرد vault، در صورت وجود');

  const knownCostUsd = costs.reduce((a, c) => a + c.usd, 0);
  const knownToEnd = knownCostUsd - impact + impactToEnd;
  const net = incentiveUsd + nativePerDay * s.horizon - knownCostUsd;
  const netLow = incentiveLow - knownCostUsd;
  const netToEnd = incentiveToEnd + nativePerDay * daysToEnd - knownToEnd;
  const incentiveApr = (priced.reduce((a, x) => a + (x.usdPerDay as number), 0) * 365 * 100) / deployed;

  // ─── Confidence ───
  const why: string[] = [];
  let score = 0;
  const minor = (label: string) => {
    score += 1;
    why.push(label);
  };
  const major = (label: string) => {
    score += 2;
    why.push(label);
  };
  if (o.tvl < 100_000) major('TVL کمتر از ۱۰۰ هزار دلار');
  else if (o.tvl < 1_000_000) minor('TVL کمتر از ۱ میلیون دلار');
  if (o.apr > 200) major('APR گزارش‌شده بیش از ۲۰۰٪');
  else if (o.apr > 50) minor('APR گزارش‌شده بیش از ۵۰٪');
  const shareBig = priced.some((x) => deployed / (campaignTvl(x.c, o).tvl || Infinity) > 0.05);
  if (shareBig) major('سرمایه‌ی شما سهم بزرگی از TVL کمپین است');
  if (priced.some((x) => x.daysToEnd < 3)) major('کمپین کمتر از ۳ روز دیگر تمام می‌شود');
  if (priced.some((x) => x.c.rateKind === 'target' || x.c.rateKind === 'capped')) minor('سقف یا نرخ هدف: پاداش با TVL و بازده بومی تغییر می‌کند');
  if (priced.some((x) => hasBoost(x.c))) minor('ضریب (boost) برای برخی کاربران');
  if (campaigns.some((x) => x.status === 'none')) minor('بخشی از کمپین‌ها برای شما قابل برآورد نیست');
  for (const e of byToken.values()) {
    if (e.deep) continue;
    // Unknown liquidity is already a caveat of the price check.
    if (e.liq !== null && e.usd > e.liq * 0.02) major(`پاداش ${e.t.symbol} نسبت به نقدشوندگی آن زیاد است`);
  }
  for (const x of priced) for (const c of x.price.caveats) if (!why.includes(c)) minor(c);
  for (const x of tokenCampaigns) if (x.status !== 'none' && !x.price.ok && x.price.reason) minor(`پاداش ${x.c.rewardToken.symbol} به دلار حساب نشد: ${x.price.reason.label}`);
  if (native.counted && o.action === 'POOL') minor('کارمزد استخر متغیر است');
  if (native.counted && native.apr > 15) minor('بازده بومی بالا؛ با بهره‌وری بازار سریع تغییر می‌کند');
  if (!depositStable) minor('دارایی ورودی نوسانی است');
  const meme = allowedMemes(o, ctx).length > 0 || o.tokens.some(isMeme);
  if (meme) major('میم‌کوین Robinhood Chain');
  const confidence: Confidence = score === 0 ? 'high' : score <= 2 ? 'medium' : 'low';

  const priceTimes = priced.map((x) => x.c.rewardToken.priceAt ?? now);
  const dataAt = Math.min(o.aprAt ?? now, o.tvlAt ?? now, ...priceTimes);

  return {
    ok: true,
    o,
    capital: s.capital,
    horizon: s.horizon,
    deployed,
    campaigns,
    incentiveUsd,
    native,
    nativeUsd: nativePerDay * s.horizon,
    costs,
    knownCostUsd,
    unknownCosts,
    net,
    netLow,
    netToEnd,
    daysToEnd,
    incentiveApr,
    confidence,
    why,
    risks: risksOf(o, meme),
    meme,
    dataAt,
  };
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

export interface Ranking {
  rows: Estimate[];
  /**
   * Pools with an estimate, kept out of the general ranking: their fee income and
   * rewards are counted but the change in value of the two assets (impermanent
   * loss) is not — «تحلیل تخصصی».
   */
  pools: Estimate[];
  /** Admissible but without a dollar estimate, with the reason. */
  noEstimate: NoEstimate[];
  /** Left out by the listing gates. */
  excluded: NoEstimate[];
  /** Estimable rows before the cut to `n`. */
  total: number;
}

export const TOP_N = 30;

/** The «top 30» list: gate → estimate → positive net only → sorted by net over the common horizon. */
export function rankTop(list: MerklOpportunity[], s: EstimateSettings, ctx: VetContext, gas: GasQuote[] = [], n = TOP_N): Ranking {
  const rows: Estimate[] = [];
  const pools: Estimate[] = [];
  const noEstimate: NoEstimate[] = [];
  const excluded: NoEstimate[] = [];
  const s1 = { ...s, horizon: clampHorizon(s.horizon) };
  for (const o of list) {
    const g = gate(o, ctx);
    if (g) {
      excluded.push({ ok: false, o, reason: g });
      continue;
    }
    const e = estimate(o, s1, ctx, gas);
    if (e.ok === false) noEstimate.push(e);
    else if (e.net <= 0) noEstimate.push(no(o, 'net-negative', 'هزینه‌های لحاظ‌شده از پاداش این افق بیشتر است'));
    else if (o.action === 'POOL') pools.push(e);
    else rows.push(e);
  }
  const byNet = (a: Estimate, b: Estimate) => b.net - a.net || b.netLow - a.netLow;
  rows.sort(byNet);
  pools.sort(byNet);
  return { rows: rows.slice(0, n), pools, noEstimate, excluded, total: rows.length };
}

/** Reasons grouped by how often they occur. */
export function reasonCounts(items: NoEstimate[]): { code: string; label: string; count: number }[] {
  const m = new Map<string, { code: string; label: string; count: number }>();
  for (const e of items) {
    const key = e.reason.code;
    const hit = m.get(key);
    if (hit) hit.count++;
    else m.set(key, { code: key, label: GROUP_LABEL[key] ?? e.reason.label, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

const GROUP_LABEL: Record<string, string> = {
  restricted: 'شرط دسترسی (فهرست سفید، هویت، کاربران یک اپ…)',
  model: 'سازوکار پاداش برای سرمایه‌ی شما قابل مدل نیست (نقدینگی متمرکز، ایردراپ…)',
  'fake-price': 'توکن با قیمت ناهمخوان با نامش',
  lookalike: 'توکن هم‌نام با دارایی معتبر',
  meme: 'میم‌کوین (خارج از Robinhood Chain)',
  'meme-unverified': 'میم‌کوین Robinhood Chain بدون تأیید',
  'meme-liquidity': 'میم‌کوین Robinhood Chain با نقدشوندگی ناکافی',
  'meme-price': 'میم‌کوین Robinhood Chain بدون قیمت تازه',
  'meme-price-gap': 'میم‌کوین Robinhood Chain با قیمت ناهمخوان',
  'no-price': 'توکن پاداش بدون قیمت معتبر',
  thin: 'نقدشوندگی توکن پاداش ناکافی',
  'price-gap': 'قیمت Merkl و بازار DEX ناهمخوان',
  unverified: 'توکن پاداش تأییدنشده و بدون بازار',
  'price-stale': 'قیمت توکن پاداش قدیمی',
  'price-deprecated': 'منبع قیمت منسوخ',
};
