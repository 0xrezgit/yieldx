import protocols from '../../config/protocols.json';
import type { MarketData, MarketSummary } from '../../types/market';
import { daysUntil } from '../utils/math';
import { BaseAdapter, MarketNotFoundError, UpstreamError, fetchJson, toPercent } from './base';

interface PendleActiveList {
  markets: {
    name: string;
    address: string;
    expiry: string;
    categoryIds?: string[];
    details: { liquidity: number; impliedApy: number };
  }[];
}

interface PendleMarket {
  expiry: string;
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

const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB Chain' };

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

  async listMarkets(): Promise<MarketSummary[]> {
    const lists = await Promise.allSettled(
      protocols.pendle.chains.map(async (chainId) => {
        const data = await fetchJson<PendleActiveList>(this.name, `${this.base}/v1/${chainId}/markets/active`);
        return data.markets.map<MarketSummary>((m) => ({
          id: `${chainId}-${m.address}`,
          name: `${m.name} · ${CHAIN_NAMES[chainId] ?? `chain ${chainId}`}`,
          maturity: m.expiry,
          impliedAPY: toPercent(m.details.impliedApy),
          baseAPY: null,
          liquidity: m.details.liquidity ?? null,
          hasPoints: m.categoryIds?.includes('points') ?? false,
        }));
      }),
    );
    const ok = lists.filter((r): r is PromiseFulfilledResult<MarketSummary[]> => r.status === 'fulfilled');
    if (!ok.length) throw new UpstreamError(this.name, 502);
    return ok.flatMap((r) => r.value).sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
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
      ptPrice: 1 - ytPrice,
      ytPrice,
      impliedAPY: toPercent(m.impliedApy),
      baseAPY: toPercent(m.underlyingApy),
      maturity: m.expiry,
      daysToMaturity: daysUntil(m.expiry),
      liquidity: usd(m.liquidity),
      volume24h: usd(m.tradingVolume),
      // Pendle has no unified points API; points programs are per-underlying.
      points: null,
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
