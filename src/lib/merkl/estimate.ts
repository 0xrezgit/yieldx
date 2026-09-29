import { normalizeSearch } from '../utils/formatting';
import { ACTION, hasBoost, merklNetwork, restrictions } from './rules';
import type { MerklAction, MerklCampaign, MerklOpportunity, MerklToken, MerklTokenType } from './types';

/**
 * Two separate views of Merkl data, never mixed with the PT/YT/Loop calculations:
 *
 * 1. Discovery: what Merkl reports (APR, whole-campaign daily rewards, TVL), with
 *    risk flags. No personal numbers.
 * 2. For my capital: a personal estimate only where the mechanism allows one —
 *    capital maps 1:1 to an eligible position, the reward rule is modelled, no
 *    condition can zero it for a plain wallet. Everything else is excluded with
 *    its reason. Points and pre-TGE tokens are counted in units, never dollars.
 *
 * Every estimate assumes today's TVL and prices hold until each campaign ends.
 */

const DAY = 86_400;

/** Native APR above this is treated as a data error and hidden. */
export const NATIVE_APR_MAX = 200;
/** Below this TVL an APR swings with every deposit. */
export const LOW_TVL = 50_000;
/** Target top-up campaigns are only estimated while the capital barely moves the pool. */
const TARGET_MAX_SHARE = 0.01;
/** Activities where capital becomes an eligible position one-to-one. */
const CAPITAL_ACTIONS = new Set<MerklAction>(['HOLD', 'LEND', 'POOL', 'STAKE']);

export const nativeApr = (o: MerklOpportunity) => (o.nativeApr !== null && o.nativeApr >= 0 && o.nativeApr <= NATIVE_APR_MAX ? o.nativeApr : null);
export const daysLeft = (c: MerklCampaign, now: number) => Math.max(0, (c.end - now) / DAY);
export const lastEnd = (o: MerklOpportunity) => (o.campaigns.length ? Math.max(...o.campaigns.map((c) => c.end)) : 0);
export const firstEnd = (o: MerklOpportunity) => (o.campaigns.length ? Math.min(...o.campaigns.map((c) => c.end)) : 0);
export const rewardTypes = (o: MerklOpportunity) => new Set(o.campaigns.map((c) => c.rewardToken.type));

/** The token that stands for the opportunity (deposit token with a logo first). */
export function leadToken(o: MerklOpportunity): MerklToken | null {
  return o.tokens.find((t) => t.icon) ?? o.tokens[0] ?? null;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type RewardFilter = 'all' | MerklTokenType;

export interface MerklFilters {
  q: string;
  chain: number | 'all';
  protocol: string | 'all';
  action: MerklAction | 'all';
  reward: RewardFilter;
  stable: boolean;
  minTvl: number;
  /** Minimum days until the last campaign ends. */
  minDays: number;
  hideRestricted: boolean;
}

export const defaultMerklFilters: MerklFilters = {
  q: '',
  chain: 'all',
  protocol: 'all',
  action: 'all',
  reward: 'all',
  stable: false,
  minTvl: 100_000,
  minDays: 1,
  hideRestricted: false,
};

const STABLE = /usd|dai|gho|frax|eur|usde|usdc|usdt|usdg|bold|pyusd|rlusd|ausd/i;
export const isStableOpp = (o: MerklOpportunity) => o.tokens.length > 0 && o.tokens.filter((t) => t.type === 'TOKEN').every((t) => STABLE.test(t.symbol));
export const isRestricted = (o: MerklOpportunity) => o.campaigns.some((c) => restrictions(c).length > 0);

export function searchText(o: MerklOpportunity): string {
  const net = merklNetwork(o.chain);
  return normalizeSearch(
    [o.name, o.protocol?.name, o.protocol?.id, net.name, net.nameFa, ACTION[o.action].label, o.identifier, ...o.tokens.map((t) => t.symbol), ...o.campaigns.map((c) => c.rewardToken.symbol)]
      .filter(Boolean)
      .join(' '),
  );
}

export function applyMerklFilters(list: MerklOpportunity[], f: MerklFilters, now = Date.now() / 1000): MerklOpportunity[] {
  const q = normalizeSearch(f.q);
  return list.filter(
    (o) =>
      o.campaigns.length > 0 &&
      (f.chain === 'all' || o.chain.id === f.chain) &&
      (f.protocol === 'all' || o.protocol?.id === f.protocol) &&
      (f.action === 'all' || o.action === f.action) &&
      (f.reward === 'all' || rewardTypes(o).has(f.reward)) &&
      (!f.stable || isStableOpp(o)) &&
      o.tvl >= f.minTvl &&
      (lastEnd(o) - now) / DAY >= f.minDays &&
      (!f.hideRestricted || !isRestricted(o)) &&
      (!q || q.split(' ').every((w) => searchText(o).includes(w))),
  );
}

// ─── Flags ───────────────────────────────────────────────────────────────────

export interface Flag {
  tone: 'warning' | 'danger' | 'info';
  label: string;
}

/** Risks and caveats in words, most serious first. */
export function flags(o: MerklOpportunity, now = Date.now() / 1000): Flag[] {
  const out: Flag[] = [];
  const types = rewardTypes(o);
  if (o.protocol && o.protocol.hacks > 0) out.push({ tone: 'warning', label: 'سابقه‌ی هک در پروتکل' });
  if (isRestricted(o)) out.push({ tone: 'danger', label: 'شرط دسترسی دارد' });
  if (o.tvl < LOW_TVL) out.push({ tone: 'warning', label: 'TVL کم؛ APR ناپایدار' });
  if (o.apr > 100) out.push({ tone: 'warning', label: 'APR بسیار بالا' });
  if (o.campaigns.length && (firstEnd(o) - now) / DAY < 3) out.push({ tone: 'warning', label: 'پایان کمتر از ۳ روز' });
  if (types.has('PRETGE')) out.push({ tone: 'warning', label: 'قیمت فرضی پیش از TGE' });
  if (o.campaigns.some((c) => c.clmm)) out.push({ tone: 'info', label: 'وابسته به بازه‌ی قیمت' });
  if (types.has('POINT')) out.push({ tone: 'info', label: 'پوینت بدون قیمت' });
  if (o.campaigns.some((c) => c.rewardToken.type === 'TOKEN' && !c.rewardToken.verified)) out.push({ tone: 'info', label: 'توکن پاداش تأییدنشده' });
  if (o.nativeApr !== null && nativeApr(o) === null) out.push({ tone: 'info', label: 'بازده بومی نامعتبر' });
  return out;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export type DiscoverSort = 'apr' | 'daily' | 'tvl' | 'ending';

/** Discovery order. Opportunities with zero incentive APR (points only) go last unless points are the filter. */
export function discover(list: MerklOpportunity[], by: DiscoverSort, now = Date.now() / 1000): MerklOpportunity[] {
  const key: Record<DiscoverSort, (o: MerklOpportunity) => number> = {
    apr: (o) => o.apr,
    daily: (o) => o.dailyUsd,
    tvl: (o) => o.tvl,
    ending: (o) => -(firstEnd(o) - now),
  };
  return [...list].sort((a, b) => key[by](b) - key[by](a));
}

// ─── Personal estimate ───────────────────────────────────────────────────────

export interface CampaignEstimate {
  c: MerklCampaign;
  daysLeft: number;
  /** ok: modelled; approx: modelled with a stated simplification; none: not estimable. */
  status: 'ok' | 'approx' | 'none';
  /** Why it is approximate or not estimable. */
  note: string | null;
  /** Reward-token units per day for the capital. */
  unitsPerDay: number | null;
  /** USD per day — only for market-priced TOKEN rewards. */
  usdPerDay: number | null;
  /** PRETGE only: USD per day at Merkl's assumed price (never added to real dollars). */
  assumedUsdPerDay: number | null;
}

/** Eligible TVL of one campaign — the opportunity TVL is the maximum across campaigns, not this. */
export function campaignTvl(c: MerklCampaign, o: MerklOpportunity): { tvl: number; derived: boolean } {
  if (c.apr > 0 && c.dailyUsd > 0) return { tvl: (c.dailyUsd * 365) / (c.apr / 100), derived: true };
  return { tvl: o.tvl, derived: false };
}

function depositPrice(o: MerklOpportunity): number | null {
  const priced = o.tokens.filter((t) => t.type === 'TOKEN' && t.price !== null);
  return priced.length === 1 ? (priced[0].price as number) : null;
}

export function estimateCampaign(c: MerklCampaign, o: MerklOpportunity, capital: number, now = Date.now() / 1000): CampaignEstimate {
  const dl = daysLeft(c, now);
  const t = c.rewardToken;
  const base = { c, daysLeft: dl, unitsPerDay: null, usdPerDay: null, assumedUsdPerDay: null };
  const none = (note: string): CampaignEstimate => ({ ...base, status: 'none', note });
  const r = restrictions(c);
  if (r.length) return none(`شرط ویژه: ${r.join('، ')}`);
  if (c.clmm) return none('نقدینگی متمرکز: پاداش به بازه‌ی قیمت و کارمزد بستگی دارد');

  const { tvl, derived } = campaignTvl(c, o);
  let usd: number | null = null;
  let units: number | null = null;
  let note: string | null = null;

  switch (c.rateKind) {
    case 'pool': {
      const share = capital / (tvl + capital);
      if (c.dailyUnits !== null) units = c.dailyUnits * share;
      if (c.dailyUsd > 0) usd = c.dailyUsd * share;
      if (!derived) note = 'سهم از TVL کل فرصت حساب شد (TVL این کمپین جدا گزارش نشده)';
      break;
    }
    case 'capped': {
      const days = (c.end - c.start) / DAY;
      const budgetDaily = c.budget !== null && t.price !== null && days > 0 ? (c.budget * t.price) / days : null;
      const apr = budgetDaily !== null ? Math.min(c.capApr as number, ((budgetDaily * 365) / (tvl + capital)) * 100) : Math.min(c.capApr as number, (c.apr * tvl) / (tvl + capital));
      usd = (capital * apr) / 100 / 365;
      if (t.price !== null) units = usd / t.price;
      if (budgetDaily === null) note = 'بودجه‌ی روزانه معلوم نیست؛ با APR فعلی و رقیق‌شدن حساب شد';
      break;
    }
    case 'fixedValue':
      usd = (capital * (c.rate as number)) / 365;
      if (t.price !== null) units = usd / t.price;
      break;
    case 'fixedAmount':
      units = (capital * (c.rate as number)) / 365;
      if (t.price !== null) usd = units * t.price;
      break;
    case 'fixedPerUnit': {
      const p = depositPrice(o);
      if (p === null) return none('قیمت توکن سپرده برای تبدیل دلار به واحد معلوم نیست');
      units = ((capital / p) * (c.rate as number)) / 365;
      if (t.price !== null) usd = units * t.price;
      break;
    }
    case 'target':
      if (!(tvl > 0) || capital / tvl > TARGET_MAX_SHARE) return none('کمپین هدف‌محور: با این سرمایه نسبت به TVL قابل برآورد نیست');
      usd = (capital * c.apr) / 100 / 365;
      if (t.price !== null) units = usd / t.price;
      note = 'نرخ کمپین با بازده بومی تغییر می‌کند؛ با نرخ فعلی حساب شد';
      break;
    case 'airdrop':
      return none('پاداش بیرون از Merkl محاسبه می‌شود');
    default:
      return none('سازوکار این کمپین مدل نشده است');
  }

  if (hasBoost(c)) note = [note, 'دیگران ممکن است ضریب بگیرند؛ سهم کیف‌پول عادی کمتر است'].filter(Boolean).join(' · ');
  const status = note ? 'approx' : 'ok';
  if (t.type === 'POINT') return { ...base, status, note, unitsPerDay: units };
  if (t.type === 'PRETGE') return { ...base, status, note, unitsPerDay: units, assumedUsdPerDay: usd };
  if (t.price === null) return { ...base, status, note: [note, 'توکن پاداش قیمت ندارد'].filter(Boolean).join(' · '), unitsPerDay: units };
  return { ...base, status, note, unitsPerDay: units, usdPerDay: usd };
}

export interface UnitReward {
  token: MerklToken;
  perDay: number;
  toEnd: number;
  /** PRETGE only: at Merkl's assumed price. */
  assumedUsdToEnd: number | null;
}

export interface MineRow {
  o: MerklOpportunity;
  estimates: CampaignEstimate[];
  /** Dollar rewards (market-priced tokens only). */
  usdPerDay: number;
  usdToEnd: number;
  /** Entry + exit cost the user entered for this network. */
  cost: number;
  net: number;
  /** Days of rewards that pay back the cost; null when rewards are zero. */
  breakEvenDays: number | null;
  /** Incentive APR for this capital after it joins the pool, %. */
  aprAfter: number;
  points: UnitReward[];
  pretge: UnitReward[];
  /** Days until the last counted campaign ends. */
  days: number;
  approx: boolean;
  /** Capital is a large share of the campaign TVL. */
  large: boolean;
}

export interface Excluded {
  o: MerklOpportunity;
  reason: string;
}

export interface MineSettings {
  capital: number;
  /** Entry + exit cost on Ethereum and on other networks, USD. */
  costEthereum: number;
  costOther: number;
  by: 'net' | 'perDay';
}

export const defaultMineSettings: MineSettings = { capital: 1000, costEthereum: 20, costOther: 1, by: 'net' };

export const entryCost = (o: MerklOpportunity, s: Pick<MineSettings, 'costEthereum' | 'costOther'>) => (o.chain.id === 1 ? s.costEthereum : s.costOther);

function merge(list: UnitReward[], token: MerklToken, perDay: number, days: number, assumedUsdPerDay: number | null) {
  const hit = list.find((x) => x.token.address.toLowerCase() === token.address.toLowerCase() && x.token.chainId === token.chainId);
  const toEnd = perDay * days;
  const assumed = assumedUsdPerDay === null ? null : assumedUsdPerDay * days;
  if (hit) {
    hit.perDay += perDay;
    hit.toEnd += toEnd;
    hit.assumedUsdToEnd = hit.assumedUsdToEnd === null || assumed === null ? hit.assumedUsdToEnd ?? assumed : hit.assumedUsdToEnd + assumed;
  } else list.push({ token, perDay, toEnd, assumedUsdToEnd: assumed });
}

/** Personal estimate for one opportunity, or why there is none. */
export function estimateOpportunity(o: MerklOpportunity, s: MineSettings, minDays: number, now = Date.now() / 1000): MineRow | Excluded {
  if (!o.campaigns.length) return { o, reason: 'کمپین زنده‌ای ندارد' };
  if (!CAPITAL_ACTIONS.has(o.action)) {
    const why: Partial<Record<MerklAction, string>> = {
      BORROW: 'وام‌گیری: پاداش روی مبلغ وام است، نه سرمایه',
      SWAP: 'سواپ: پاداش بر حسب حجم معامله است، نه سرمایه',
      DROP: 'توزیع خارجی: محاسبه بیرون از Merkl است',
    };
    return { o, reason: why[o.action] ?? `فعالیت «${ACTION[o.action].label}» با سرمایه‌ی ساده برآورد نمی‌شود` };
  }

  const estimates = o.campaigns.map((c) => estimateCampaign(c, o, s.capital, now));
  // A campaign that pays real value but cannot be modelled makes the total misleading.
  const blocking = estimates.find((e) => e.status === 'none' && (e.c.dailyUsd > 0 || e.c.rewardToken.type !== 'TOKEN'));
  if (blocking) return { o, reason: blocking.note ?? 'قابل برآورد نیست' };

  const counted = estimates.filter((e) => e.status !== 'none');
  if (!counted.length) return { o, reason: 'کمپین قابل برآوردی ندارد' };
  const days = Math.max(...counted.map((e) => e.daysLeft));
  if (days < minDays) return { o, reason: 'زمان باقی‌مانده‌ی کمپین‌ها کمتر از حداقل است' };

  let usdPerDay = 0;
  let usdToEnd = 0;
  const points: UnitReward[] = [];
  const pretge: UnitReward[] = [];
  for (const e of counted) {
    if (e.usdPerDay !== null) {
      usdPerDay += e.usdPerDay;
      usdToEnd += e.usdPerDay * e.daysLeft;
    }
    if (e.unitsPerDay !== null && e.c.rewardToken.type === 'POINT') merge(points, e.c.rewardToken, e.unitsPerDay, e.daysLeft, null);
    if (e.unitsPerDay !== null && e.c.rewardToken.type === 'PRETGE') merge(pretge, e.c.rewardToken, e.unitsPerDay, e.daysLeft, e.assumedUsdPerDay);
  }
  if (usdPerDay <= 0) return { o, reason: points.length || pretge.length ? 'فقط پوینت یا توکن پیش از TGE؛ ارزش دلاری واقعی ندارد' : 'پاداش قیمت‌داری ندارد' };

  const cost = entryCost(o, s);
  const large = counted.some((e) => s.capital / (campaignTvl(e.c, o).tvl || Infinity) > 0.05);
  return {
    o,
    estimates,
    usdPerDay,
    usdToEnd,
    cost,
    net: usdToEnd - cost,
    breakEvenDays: usdPerDay > 0 ? cost / usdPerDay : null,
    aprAfter: ((usdPerDay * 365) / s.capital) * 100,
    points,
    pretge,
    days,
    approx: counted.some((e) => e.status === 'approx'),
    large,
  };
}

export const isRow = (x: MineRow | Excluded): x is MineRow => 'estimates' in x;

/** The personal ranking: up to `n` estimable opportunities, plus everything left out and why. */
export function rankMine(list: MerklOpportunity[], s: MineSettings, minDays: number, n = 15, now = Date.now() / 1000): { rows: MineRow[]; excluded: Excluded[]; total: number } {
  if (!(s.capital > 0)) return { rows: [], excluded: [], total: 0 };
  const all = list.map((o) => estimateOpportunity(o, s, minDays, now));
  const rows = all.filter(isRow).sort((a, b) => (s.by === 'net' ? b.net - a.net : b.usdPerDay - a.usdPerDay));
  return { rows: rows.slice(0, n), excluded: all.filter((x): x is Excluded => !isRow(x)), total: rows.length };
}

/** Exclusion reasons grouped by how often they occur. */
export function reasonCounts(excluded: Excluded[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of excluded) {
    const key = e.reason.startsWith('شرط ویژه') ? 'شرط ویژه (فهرست سفید، اهرم، هویت…)' : e.reason;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}
