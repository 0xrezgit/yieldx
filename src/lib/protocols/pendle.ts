import protocols from '../../config/protocols.json';
import type { MarketData, MarketSummary } from '../../types/market';
import { daysUntil } from '../utils/math';
import { BaseAdapter, MarketNotFoundError, UpstreamError, fetchJson, plausibleAPY, toPercent } from './base';

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
  underlyingApy?: number;
  liquidity?: { usd: number } | number;
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
  accountingAsset?: { symbol?: string; price?: { usd: number } };
}

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
    }));
  }

  /**
   * Every chain Pendle currently supports, read from its API so newly launched chains
   * show up without a code change. Falls back to the configured list if the call fails.
   */
  private async chains(): Promise<number[]> {
    try {
      const { chainIds } = await fetchJson<{ chainIds: number[] }>(this.name, `${this.base}/v1/chains`);
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
      m = await fetchJson<PendleMarket>(this.name, `${this.base}/v1/${chainId}/markets/${address}`);
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
    };
  }

  async getHistoricalAPY(marketId: string, days: number): Promise<number[]> {
    const { chainId, address } = parsePendleMarketId(marketId);
    const h = await fetchJson<PendleHistory>(
      this.name,
      `${this.base}/v1/${chainId}/markets/${address}/historical-data?time_frame=day`,
    );
    return (h.underlyingApy ?? [])
      .slice(-Math.max(1, days))
      .map(toPercent)
      .filter(Number.isFinite);
  }
}
