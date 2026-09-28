import protocols from '../../config/protocols.json';
import type { MarketData, MarketSummary } from '../../types/market';
import { daysUntil } from '../utils/math';
import { BaseAdapter, LiveDataUnavailableError, MarketNotFoundError, fetchJson, toPercent } from './base';

/** Subset of https://api.exponent.finance/markets that YieldX uses. */
interface ExponentMarket {
  vaultAddress: string;
  tokenName: string;
  platformName?: string;
  ptPriceInAsset: number;
  ytPriceInAsset: number;
  impliedApy: number;
  underlyingApy: number;
  maturityDateUnixTs: number;
  marketStatus: string;
  pointsBoost: {
    points_name: string;
    points_per_day: number;
    yt_multiplier: number;
    lp_multiplier: number;
    is_active: boolean;
  } | null;
}

export class ExponentAdapter extends BaseAdapter {
  id = 'exponent' as const;
  name = 'Exponent';
  liveData = true;
  private base = protocols.exponent.apiBase;

  private async all(): Promise<ExponentMarket[]> {
    return fetchJson<ExponentMarket[]>(this.name, `${this.base}/markets`);
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const markets = await this.all();
    return markets
      .filter((m) => m.marketStatus === 'active')
      .map((m) => ({
        id: m.vaultAddress,
        name: m.platformName ? `${m.tokenName} · ${m.platformName}` : m.tokenName,
        maturity: new Date(m.maturityDateUnixTs * 1000).toISOString(),
        impliedAPY: toPercent(m.impliedApy),
        baseAPY: toPercent(m.underlyingApy),
        liquidity: null,
        hasPoints: !!m.pointsBoost?.is_active,
      }));
  }

  async fetchMarketData(marketId: string): Promise<MarketData> {
    const m = (await this.all()).find((x) => x.vaultAddress === marketId);
    if (!m) throw new MarketNotFoundError(this.name, marketId);
    const maturity = new Date(m.maturityDateUnixTs * 1000).toISOString();
    const pb = m.pointsBoost?.is_active ? m.pointsBoost : null;

    return {
      protocol: this.id,
      marketId,
      name: m.tokenName,
      // Exponent quotes prices in the asset; USD price has to come from the user.
      underlyingPrice: null,
      ptPrice: m.ptPriceInAsset,
      ytPrice: m.ytPriceInAsset,
      impliedAPY: toPercent(m.impliedApy),
      baseAPY: toPercent(m.underlyingApy),
      maturity,
      daysToMaturity: daysUntil(maturity),
      liquidity: null,
      volume24h: null,
      points: pb
        ? {
            name: pb.points_name,
            pointsPerDay: pb.points_per_day,
            ytMultiplier: pb.yt_multiplier,
            lpMultiplier: pb.lp_multiplier,
          }
        : null,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getHistoricalAPY(): Promise<number[]> {
    // The public API exposes only rolling averages, not a daily series.
    throw new LiveDataUnavailableError(this.name, 'APY history');
  }
}
