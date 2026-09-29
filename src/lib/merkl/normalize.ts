import type { MerklAction, MerklCampaign, MerklHook, MerklOpportunity, MerklProgram, MerklProgramRef, MerklProtocol, MerklRateKind, MerklToken, MerklTokenType } from './types';

/**
 * Raw Merkl API v4 shapes — only the fields YieldX reads. Everything is optional
 * because the API adds and drops fields between campaign types.
 */
export interface RawToken {
  name?: string;
  symbol?: string;
  displaySymbol?: string;
  address?: string;
  chainId?: number;
  decimals?: number;
  icon?: string;
  price?: number | null;
  updatedAt?: number | string;
  priceSource?: string | null;
  verified?: boolean;
  isTest?: boolean;
  type?: string;
}

interface RawDistribution {
  distributionMethod?: string;
  distributionSettings?: Record<string, unknown> | null;
}

export interface RawCampaign {
  id?: string;
  campaignId?: string;
  distributionChainId?: number;
  startTimestamp?: number | string;
  endTimestamp?: number | string;
  distributionType?: string;
  apr?: number;
  dailyRewards?: number;
  amount?: string;
  rewardToken?: RawToken;
  params?: {
    hooks?: Record<string, unknown>[];
    whitelist?: unknown[];
    blacklist?: unknown[];
    weightFees?: number;
    isOutOfRangeIncentivized?: boolean;
    distributionMethodParameters?: RawDistribution;
  } & Record<string, unknown>;
  dailyRewardsBreakdown?: { amount?: string; token?: RawToken }[];
}

export interface RawOpportunity {
  id?: string;
  name?: string;
  action?: string;
  type?: string;
  identifier?: string;
  explorerAddress?: string | null;
  tags?: string[];
  activePrograms?: { slug?: string; name?: string; icon?: string }[];
  totalApr?: number | null;
  tvlRecord?: { timestamp?: string | number } | null;
  chainId?: number;
  chain?: { id?: number; name?: string; icon?: string };
  protocol?: { id?: string; name?: string; icon?: string; url?: string; trustData?: { audits?: string | number | null; hacks?: unknown[] } | null } | null;
  tokens?: RawToken[];
  apr?: number;
  nativeApr?: number | null;
  nativeAprRecord?: { value?: number; timestamp?: string | number; description?: string | null } | null;
  tvl?: number;
  dailyRewards?: number;
  aprRecord?: { timestamp?: string | number } | null;
  depositUrl?: string | null;
  howToSteps?: string[];
  campaigns?: RawCampaign[];
}

const ACTIONS = new Set<MerklAction>(['LEND', 'POOL', 'HOLD', 'BORROW', 'DROP', 'SWAP', 'STAKE', 'LONG', 'SHORT']);
const TARGET_METHODS = new Set(['AAVE_NET_APR', 'AAVE_V4_NET_APR', 'ERC4626_APR', 'NET_APR', 'TARGET_APR_WITH_MERKL', 'ERC4626_TARGET_APR_WITH_MERKL', 'BORROW_SUBSIDY']);

const finite = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);

/** Big-integer token amount (string) → token units. */
export function units(amount: string | undefined, decimals: number | undefined): number | null {
  const n = finite(amount);
  if (n === null) return null;
  return n / 10 ** (decimals ?? 18);
}

export function normalizeToken(t: RawToken | undefined, fallbackChainId = 0): MerklToken {
  const type = (t?.type === 'POINT' || t?.type === 'PRETGE' ? t.type : 'TOKEN') as MerklTokenType;
  const price = finite(t?.price);
  return {
    symbol: text(t?.displaySymbol) ?? text(t?.symbol) ?? '?',
    name: text(t?.name) ?? text(t?.symbol) ?? '',
    address: t?.address ?? '',
    chainId: finite(t?.chainId) ?? fallbackChainId,
    icon: text(t?.icon),
    // Points never carry a dollar value, even if the API sends 0 or a number.
    price: type === 'POINT' || price === null || price <= 0 ? null : price,
    priceAt: finite(t?.updatedAt),
    priceSource: text(t?.priceSource),
    verified: t?.verified === true,
    type,
  };
}

/** Which rate mechanism a campaign uses, and its parameters. */
export function classifyRate(c: RawCampaign): { rateKind: MerklRateKind; rate: number | null; capApr: number | null; method: string | null } {
  const dm = c.params?.distributionMethodParameters;
  const method = text(dm?.distributionMethod);
  const s = (dm?.distributionSettings ?? {}) as Record<string, unknown>;
  const out = (rateKind: MerklRateKind, rate: number | null = null, capApr: number | null = null) => ({ rateKind, rate, capApr, method });

  if (method === 'AIRDROP') return out('airdrop');
  if (method === 'DUTCH_AUCTION' || (!method && c.distributionType === 'DUTCH_AUCTION')) return out('pool');
  if (method === 'MAX_APR') {
    const cap = finite(s.apr);
    // Merkl stores the cap as a fraction (0.05 = 5%).
    return cap !== null && cap > 0 ? out('capped', null, cap * 100) : out('other');
  }
  if (method === 'FIX_APR') {
    const rate = finite(s.apr);
    if (rate === null || rate <= 0) return out('other');
    const rewardPriced = s.rewardTokenPricing !== false;
    const targetPriced = s.targetTokenPricing !== false;
    if (rewardPriced && targetPriced) return out('fixedValue', rate);
    if (!rewardPriced && targetPriced) return out('fixedAmount', rate);
    if (!rewardPriced && !targetPriced) return out('fixedPerUnit', rate);
    return out('other');
  }
  if (method && TARGET_METHODS.has(method)) return out('target');
  if (method === 'COMPOSED' && typeof s.computeExpression === 'string' && s.computeExpression.includes('nativeApr')) return out('target');
  return out('other');
}

function normalizeHooks(raw: Record<string, unknown>[] | undefined): MerklHook[] {
  return (raw ?? [])
    .map((h): MerklHook | null => {
      const type = finite(h.hookType);
      if (type === null) return null;
      const threshold = finite(h.healthFactorThreshold);
      return threshold === null ? { type } : { type, threshold };
    })
    .filter((h): h is MerklHook => h !== null);
}

export function normalizeCampaign(c: RawCampaign, chainId: number): MerklCampaign | null {
  const start = finite(c.startTimestamp);
  const end = finite(c.endTimestamp);
  // Test reward tokens are Merkl's own fixtures, never a real reward.
  if (start === null || end === null || !c.id || c.rewardToken?.isTest) return null;
  const rewardToken = normalizeToken(c.rewardToken, chainId);
  const decimals = c.rewardToken?.decimals;
  const perDay = (c.dailyRewardsBreakdown ?? []).map((b) => units(b.amount, b.token?.decimals ?? decimals)).filter((x): x is number => x !== null);
  const params = c.params ?? {};
  return {
    id: String(c.id),
    campaignId: text(c.campaignId) ?? String(c.id),
    start,
    end,
    distributionType: c.distributionType ?? '',
    ...classifyRate(c),
    apr: finite(c.apr) ?? 0,
    dailyUsd: Math.max(0, finite(c.dailyRewards) ?? 0),
    dailyUnits: perDay.length ? perDay.reduce((a, b) => a + b, 0) : null,
    budget: units(c.amount, decimals),
    rewardToken,
    distributionChainId: finite(c.distributionChainId) ?? rewardToken.chainId ?? chainId,
    hooks: normalizeHooks(params.hooks),
    whitelistCount: Array.isArray(params.whitelist) ? params.whitelist.length : 0,
    blacklistCount: Array.isArray(params.blacklist) ? params.blacklist.length : 0,
    clmm: 'weightFees' in params || 'isOutOfRangeIncentivized' in params,
  };
}

function normalizeProtocol(p: RawOpportunity['protocol']): MerklProtocol | null {
  if (!p?.id) return null;
  const audits = finite(p.trustData?.audits);
  return {
    id: p.id,
    name: text(p.name) ?? p.id,
    icon: text(p.icon),
    url: text(p.url),
    audits,
    hacks: Array.isArray(p.trustData?.hacks) ? p.trustData.hacks.length : 0,
  };
}

function normalizePrograms(raw: RawOpportunity['activePrograms']): MerklProgramRef[] {
  const seen = new Set<string>();
  const out: MerklProgramRef[] = [];
  for (const p of raw ?? []) {
    const slug = text(p?.slug);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, name: text(p.name) ?? slug, icon: text(p.icon) });
  }
  return out;
}

export interface RawProgram {
  slug?: string;
  name?: string;
  icon?: string;
  description?: string;
}

export function normalizeProgram(p: RawProgram): MerklProgram | null {
  const slug = text(p.slug);
  if (!slug) return null;
  return { slug, name: text(p.name) ?? slug, icon: text(p.icon), description: text(p.description) };
}

/** One raw opportunity → the slim shape sent to the browser; campaigns outside [start, end) at `now` are dropped. */
export function normalizeOpportunity(o: RawOpportunity, nowSec = Date.now() / 1000): MerklOpportunity | null {
  if (!o.id || !o.name) return null;
  const chainId = finite(o.chain?.id) ?? finite(o.chainId) ?? 0;
  const action = (ACTIONS.has(o.action as MerklAction) ? o.action : 'OTHER') as MerklAction;
  const native = finite(o.nativeApr) ?? finite(o.nativeAprRecord?.value);
  const seen = new Set<string>();
  const tokens = (o.tokens ?? [])
    .filter((t) => !t.isTest)
    .map((t) => normalizeToken(t, chainId))
    .filter((t) => {
      const k = `${t.chainId}:${t.address.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return {
    id: String(o.id),
    name: o.name,
    action,
    type: o.type ?? '',
    identifier: o.identifier ?? '',
    explorerAddress: text(o.explorerAddress),
    chain: { id: chainId, name: text(o.chain?.name) ?? `Chain ${chainId}`, icon: text(o.chain?.icon) },
    protocol: normalizeProtocol(o.protocol),
    programs: normalizePrograms(o.activePrograms),
    tags: (o.tags ?? []).filter((t): t is string => typeof t === 'string'),
    tokens,
    apr: finite(o.apr) ?? 0,
    totalApr: finite(o.totalApr),
    nativeApr: native,
    nativeAt: finite(o.nativeAprRecord?.timestamp),
    nativeSource: text(o.nativeAprRecord?.description),
    tvl: Math.max(0, finite(o.tvl) ?? 0),
    dailyUsd: Math.max(0, finite(o.dailyRewards) ?? 0),
    aprAt: finite(o.aprRecord?.timestamp),
    tvlAt: finite(o.tvlRecord?.timestamp),
    depositUrl: text(o.depositUrl),
    howTo: (o.howToSteps ?? []).filter((s) => typeof s === 'string' && s.trim()),
    campaigns: (o.campaigns ?? [])
      .map((c) => normalizeCampaign(c, chainId))
      .filter((c): c is MerklCampaign => c !== null && c.start <= nowSec && c.end > nowSec),
  };
}
