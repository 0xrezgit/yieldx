import protocols from '../../config/protocols.json';
import type { MarketData, MarketSummary } from '../../types/market';
import { DAY_MS, daysUntil } from '../utils/math';
import { BaseAdapter, LiveDataUnavailableError, MarketNotFoundError, UpstreamError, fetchJson } from './base';

/** Subset of https://api.spectra.finance/v1/{network}/pools that YieldX uses. */
interface SpectraToken {
  symbol?: string | null;
  logoURI?: string | null;
  protocol?: string | null;
  price?: { usd?: number | null } | null;
  apr?: { total?: number | null } | null;
}

interface SpectraPool {
  liquidity?: { underlying?: number | null; usd?: number | null } | null;
  impliedApy?: number | null;
  ptPrice?: { underlying?: number | null } | null;
  ytPrice?: { underlying?: number | null } | null;
}

interface SpectraMarket {
  /** PT address — the market id within a network. */
  address: string;
  maturity: number;
  createdAt?: number;
  tags?: string[];
  tvl?: { usd?: number | null } | null;
  ibt: SpectraToken;
  baseIbt?: SpectraToken | null;
  underlying: SpectraToken;
  pools: SpectraPool[];
}

const NETWORKS: Record<string, string> = protocols.spectra.networks;
const NEW_WINDOW_MS = 14 * DAY_MS;

const finite = (x: number | null | undefined): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const https = (url: string | null | undefined) => (url && url.startsWith('https://') ? url : null);

/** Spectra ids are "<network>-<ptAddress>", e.g. "base-0xabc…". */
export function parseSpectraMarketId(marketId: string): { network: string; address: string } {
  const m = /^([a-z]+)-(0x[0-9a-fA-F]{40})$/.exec(marketId.trim());
  if (!m || !(m[1] in NETWORKS)) throw new MarketNotFoundError('Spectra', marketId);
  return { network: m[1], address: m[2].toLowerCase() };
}

/** A PT can trade in several pools; the deepest one sets the price. */
function mainPool(m: SpectraMarket): SpectraPool | null {
  return m.pools.reduce<SpectraPool | null>(
    (best, p) => ((p.liquidity?.underlying ?? 0) > (best?.liquidity?.underlying ?? -1) ? p : best),
    null,
  );
}

const name = (m: SpectraMarket) => m.baseIbt?.symbol || m.ibt.symbol || m.underlying.symbol || m.address;
const icon = (m: SpectraMarket) => https(m.baseIbt?.logoURI) ?? https(m.ibt.logoURI) ?? https(m.underlying.logoURI);
const tags = (m: SpectraMarket) => (m.tags ?? []).map((t) => (t === 'stable' ? 'stables' : t.toLowerCase()));

export class SpectraAdapter extends BaseAdapter {
  id = 'spectra' as const;
  name = 'Spectra';
  liveData = true;
  private base = protocols.spectra.apiBase;

  private network(network: string): Promise<SpectraMarket[]> {
    return fetchJson<SpectraMarket[]>(this.name, `${this.base}/v1/${network}/pools`);
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const results = await Promise.allSettled(
      Object.keys(NETWORKS).map(async (network) => {
        const markets = await this.network(network);
        return markets
          .map((m): MarketSummary | null => {
            const pool = mainPool(m);
            const implied = finite(pool?.impliedApy);
            if (!pool || implied === null) return null;
            return {
              id: `${network}-${m.address.toLowerCase()}`,
              name: name(m),
              platform: m.ibt.protocol ?? null,
              icon: icon(m),
              chain: NETWORKS[network],
              maturity: new Date(m.maturity * 1000).toISOString(),
              impliedAPY: implied,
              baseAPY: finite(m.ibt.apr?.total),
              liquidity: finite(pool.liquidity?.usd) ?? finite(m.tvl?.usd),
              hasPoints: false,
              ytMultiplier: null,
              points: null,
              categories: tags(m),
              isNew: !!m.createdAt && Date.now() - m.createdAt * 1000 < NEW_WINDOW_MS,
            };
          })
          .filter((m): m is MarketSummary => m !== null);
      }),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<MarketSummary[]> => r.status === 'fulfilled');
    if (!ok.length) throw new UpstreamError(this.name, 502);
    return ok.flatMap((r) => r.value);
  }

  async fetchMarketData(marketId: string): Promise<MarketData> {
    const { network, address } = parseSpectraMarketId(marketId);
    const m = (await this.network(network)).find((x) => x.address.toLowerCase() === address);
    const pool = m ? mainPool(m) : null;
    const pt = finite(pool?.ptPrice?.underlying);
    if (!m || !pool || pt === null) throw new MarketNotFoundError(this.name, marketId);
    const maturity = new Date(m.maturity * 1000).toISOString();

    return {
      protocol: this.id,
      marketId: `${network}-${address}`,
      name: name(m),
      underlyingPrice: finite(m.underlying.price?.usd),
      ptPrice: pt,
      ytPrice: finite(pool.ytPrice?.underlying) ?? 1 - pt,
      impliedAPY: finite(pool.impliedApy) ?? NaN,
      // Not every IBT reports an APR; NaN tells the merge step to keep the user's value.
      baseAPY: finite(m.ibt.apr?.total) ?? NaN,
      maturity,
      daysToMaturity: daysUntil(maturity),
      liquidity: finite(pool.liquidity?.usd) ?? finite(m.tvl?.usd),
      marketSizeUnits: finite(pool.liquidity?.underlying),
      volume24h: null,
      // Spectra's API carries no points data.
      pointsStatus: 'unknown',
      points: null,
      platform: m.ibt.protocol ?? null,
      icon: icon(m),
      chain: NETWORKS[network],
      fetchedAt: new Date().toISOString(),
    };
  }

  async getHistoricalAPY(): Promise<number[]> {
    throw new LiveDataUnavailableError(this.name, 'APY history');
  }
}
