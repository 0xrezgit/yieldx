import protocols from '../../config/protocols.json';
import type { MarketData, MarketSummary } from '../../types/market';
import { daysUntil } from '../utils/math';
import { assessBase, assessImplied, type BaseHistoryPoint } from '../opportunity/health';
import { BaseAdapter, MarketNotFoundError, UpstreamError, fetchJson, isObject, plausibleAPY, toPercent, type Shape } from './base';

/** One row of GET /v1/{chain}/markets (paginated). */
interface PendleListItem {
  address: string;
  expiry: string;
  isActive?: boolean;
  isNew?: boolean;
  proName?: string;
  simpleName?: string;
  name?: string;
  proIcon?: string;
  simpleIcon?: string;
  protocol?: string;
  categoryIds?: string[];
  impliedApy: number;
  /** 1 − PT price, in the accounting asset. */
  ptDiscount?: number;
  underlyingApy?: number;
  underlyingInterestApy?: number;
  underlyingRewardApy?: number;
  /** `yieldRange`: the base-yield range Pendle itself expects for this market (fractions). */
  extendedInfo?: { yieldRange?: { min?: number; max?: number } } | null;
  liquidity?: { usd: number } | number;
  underlyingAsset?: PendleToken;
  accountingAsset?: PendleToken;
  /** The PT token: an object like the others, or an id string "<chainId>-<address>". */
  pt?: PendleToken | string;
  dataUpdatedAt?: string;
}

// ─── Base-yield history (for the health checks) ────────────────────────────────

const HISTORY_TTL_MS = 60 * 60_000;
const historyCache = new Map<string, { h: BaseHistoryPoint[]; at: number }>();
const historyLoading = new Set<string>();

/**
 * Daily base yield of one market over the last 45 days, cached for an hour. Never makes
 * the list wait: a missing or old copy is refreshed in the background (1 computing unit each).
 */
function cachedHistory(base: string, chainId: number, address: string): BaseHistoryPoint[] | null {
  const key = `${chainId}:${address.toLowerCase()}`;
  const hit = historyCache.get(key);
  if ((!hit || Date.now() - hit.at > HISTORY_TTL_MS) && !historyLoading.has(key)) {
    historyLoading.add(key);
    const start = new Date(Date.now() - 45 * 86_400_000).toISOString();
    void fetchJson<{ results?: { timestamp?: string; underlyingApy?: number; impliedApy?: number }[] }>('Pendle', `${base}/v3/${chainId}/markets/${address}/historical-data?time_frame=day&timestamp_start=${start}&fields=underlyingApy,impliedApy`, isObject)
      .then((d) => {
        const h = (d.results ?? [])
          .filter((r) => typeof r.underlyingApy === 'number' && r.timestamp)
          .map((r) => ({ t: r.timestamp as string, basePct: (r.underlyingApy as number) * 100, ...(typeof r.impliedApy === 'number' ? { impliedPct: r.impliedApy * 100 } : {}) }));
        historyCache.set(key, { h, at: Date.now() });
      })
      .catch(() => {})
      .finally(() => historyLoading.delete(key));
  }
  return hit?.h ?? null;
}

function healthOf(m: PendleListItem, chainId: number, base: string, categories: string[]) {
  const r = m.extendedInfo?.yieldRange;
  const range = r && typeof r.min === 'number' && typeof r.max === 'number' ? { min: r.min * 100, max: r.max * 100 } : null;
  return assessBase({
    basePct: m.underlyingApy === undefined ? null : toPercent(m.underlyingApy),
    interestPct: m.underlyingInterestApy === undefined ? null : toPercent(m.underlyingInterestApy),
    rewardPct: m.underlyingRewardApy === undefined ? null : toPercent(m.underlyingRewardApy),
    range,
    history: cachedHistory(base, chainId, m.address),
    categories,
  });
}

interface PendleToken {
  address?: string;
  symbol?: string;
  price?: { usd: number };
}

interface PendlePage {
  total: number;
  results: PendleListItem[];
}

interface PendleMarket {
  expiry: string;
  proIcon?: string;
  simpleIcon?: string;
  protocol?: string;
  categoryIds?: string[];
  proName?: string;
  simpleName?: string;
  ptDiscount: number;
  impliedApy: number;
  underlyingApy: number;
  liquidity?: { usd: number } | number;
  tradingVolume?: { usd: number } | number;
  accountingAsset?: PendleToken;
  underlyingAsset?: PendleToken;
  dataUpdatedAt?: string;
}

const tokenRef = (t: PendleToken | undefined) => (t ? { symbol: t.symbol ?? null, address: t.address ?? null } : null);

/** The PT address from either form Pendle uses; null when absent or malformed. */
export function ptRef(pt: PendleToken | string | undefined): { symbol: string | null; address: string } | null {
  const raw = typeof pt === 'string' ? pt : pt?.address;
  const m = typeof raw === 'string' ? /(0x[0-9a-fA-F]{40})$/.exec(raw) : null;
  return m ? { symbol: typeof pt === 'object' ? (pt.symbol ?? null) : null, address: m[1].toLowerCase() } : null;
}
const isoOrNull = (x: string | undefined) => (x && Number.isFinite(new Date(x).getTime()) ? new Date(x).toISOString() : null);

const isPage: Shape<PendlePage> = (b): b is PendlePage =>
  isObject(b) && Array.isArray((b as PendlePage).results) && typeof (b as PendlePage).total === 'number';
const isMarket: Shape<PendleMarket> = (b): b is PendleMarket => isObject(b) && typeof (b as PendleMarket).expiry === 'string';

interface PendleHistory {
  underlyingApy: string[];
}

const CHAIN_NAMES: Record<string, string> = protocols.pendle.chainNames;

const chainName = (chainId: number) => CHAIN_NAMES[String(chainId)] ?? `Chain ${chainId}`;

const PAGE = 100;
const MAX_PAGES = 5;

const icon = (x: { proIcon?: string; simpleIcon?: string }) => {
  const url = x.proIcon || x.simpleIcon || '';
  return url.startsWith('https://') ? url : null;
};

const usd = (x: { usd: number } | number | undefined): number | null =>
  x === undefined ? null : typeof x === 'number' ? x : Number.isFinite(x.usd) ? x.usd : null;

/**
 * Market ids are "<chainId>-<address>" (e.g. "42161-0xabc…"); a bare address
 * defaults to the configured chain (Ethereum mainnet).
 */
export function parsePendleMarketId(marketId: string): { chainId: number; address: string } {
  const m = /^(?:(\d+)-)?(0x[0-9a-fA-F]{40})$/.exec(marketId.trim());
  if (!m) throw new MarketNotFoundError('Pendle', marketId);
  return { chainId: m[1] ? Number(m[1]) : protocols.pendle.defaultChainId, address: m[2].toLowerCase() };
}

export class PendleAdapter extends BaseAdapter {
  id = 'pendle' as const;
  name = 'Pendle';
  liveData = true;
  private base = protocols.pendle.apiBase;

  /** All active markets of one chain, following pagination so new listings are never cut off. */
  private async chainMarkets(chainId: number): Promise<MarketSummary[]> {
    const items: PendleListItem[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await fetchJson<PendlePage>(
        this.name,
        `${this.base}/v1/${chainId}/markets?is_active=true&limit=${PAGE}&skip=${page * PAGE}`,
        isPage,
      );
      items.push(...data.results);
      if (items.length >= data.total || data.results.length < PAGE) break;
    }
    return items.map((m) => ({
      id: `${chainId}-${m.address}`,
      name: m.proName ?? m.simpleName ?? m.name ?? m.address,
      platform: m.protocol ?? null,
      icon: icon(m),
      chain: chainName(chainId),
      maturity: m.expiry,
      impliedAPY: toPercent(m.impliedApy),
      baseAPY: m.underlyingApy === undefined ? null : plausibleAPY(toPercent(m.underlyingApy)),
      liquidity: usd(m.liquidity),
      hasPoints: m.categoryIds?.includes('points') ?? false,
      ytMultiplier: null,
      points: null,
      categories: (m.categoryIds ?? []).map((c) => c.toLowerCase()),
      isNew: !!m.isNew,
      asset: tokenRef(m.underlyingAsset),
      accountingSymbol: m.accountingAsset?.symbol ?? null,
      sourceUpdatedAt: isoOrNull(m.dataUpdatedAt),
      ptToken: ptRef(m.pt),
      baseHealth: healthOf(m, chainId, this.base, (m.categoryIds ?? []).map((c) => c.toLowerCase())),
      impliedHealth: assessImplied({
        impliedPct: toPercent(m.impliedApy),
        ptPrice: typeof m.ptDiscount === 'number' ? 1 - m.ptDiscount : null,
        days: (new Date(m.expiry).getTime() - Date.now()) / 86_400_000,
        history: cachedHistory(this.base, chainId, m.address),
      }),
    }));
  }

  /**
   * Every chain Pendle currently supports, read from its API so newly launched chains
   * show up without a code change. Falls back to the configured list if the call fails.
   */
  private async chains(): Promise<number[]> {
    try {
      const { chainIds } = await fetchJson<{ chainIds: number[] }>(this.name, `${this.base}/v1/chains`, isObject<{ chainIds: number[] }>);
      const ids = (chainIds ?? []).filter((id) => Number.isInteger(id) && id > 0);
      if (ids.length) return ids;
    } catch {
      /* fall through */
    }
    return protocols.pendle.fallbackChains;
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const lists = await Promise.allSettled((await this.chains()).map((c) => this.chainMarkets(c)));
    const ok = lists.filter((r): r is PromiseFulfilledResult<MarketSummary[]> => r.status === 'fulfilled');
    if (!ok.length) throw new UpstreamError(this.name, 502);
    return ok.flatMap((r) => r.value);
  }

  async fetchMarketData(marketId: string): Promise<MarketData> {
    const { chainId, address } = parsePendleMarketId(marketId);
    let m: PendleMarket;
    try {
      m = await fetchJson<PendleMarket>(this.name, `${this.base}/v1/${chainId}/markets/${address}`, isMarket);
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) throw new MarketNotFoundError(this.name, marketId);
      throw e;
    }

    // ptDiscount = 1 − PT price in accounting-asset units, which is also the YT price.
    const ytPrice = m.ptDiscount;
    return {
      protocol: this.id,
      marketId: `${chainId}-${address}`,
      name: m.proName ?? m.simpleName ?? address,
      underlyingPrice: m.accountingAsset?.price?.usd ?? null,
      assetSymbol: m.accountingAsset?.symbol ?? null,
      ptPrice: 1 - ytPrice,
      ytPrice,
      impliedAPY: toPercent(m.impliedApy),
      baseAPY: plausibleAPY(toPercent(m.underlyingApy)) ?? NaN,
      maturity: m.expiry,
      daysToMaturity: daysUntil(m.expiry),
      liquidity: usd(m.liquidity),
      marketSizeUnits: null,
      volume24h: usd(m.tradingVolume),
      // Pendle tags points markets but doesn't publish multipliers or rates.
      pointsStatus: m.categoryIds ? (m.categoryIds.includes('points') ? 'active' : 'none') : 'unknown',
      points: null,
      platform: m.protocol ?? null,
      icon: icon(m),
      chain: chainName(chainId),
      fetchedAt: new Date().toISOString(),
      asset: tokenRef(m.underlyingAsset),
      accountingSymbol: m.accountingAsset?.symbol ?? null,
      sourceUpdatedAt: isoOrNull(m.dataUpdatedAt),
    };
  }

  async getHistoricalAPY(marketId: string, days: number): Promise<number[]> {
    const { chainId, address } = parsePendleMarketId(marketId);
    const h = await fetchJson<PendleHistory>(
      this.name,
      `${this.base}/v1/${chainId}/markets/${address}/historical-data?time_frame=day`,
      isObject<PendleHistory>,
    );
    return (h.underlyingApy ?? [])
      .slice(-Math.max(1, days))
      .map(toPercent)
      .filter(Number.isFinite);
  }
}
