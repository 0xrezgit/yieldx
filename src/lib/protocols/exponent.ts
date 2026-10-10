import protocols from '../../config/protocols.json';
import type { MarketData, MarketPointsProgram, MarketSummary } from '../../types/market';
import { daysUntil } from '../utils/math';
import { BaseAdapter, LiveDataUnavailableError, MarketNotFoundError, fetchJson, isArrayOf, plausibleAPY, toPercent } from './base';
import { fetchSolanaTokens, type SolanaToken } from './jupiter';

/** Subset of https://api.exponent.finance/markets that YieldX uses. */
interface ExponentMarket {
  vaultAddress: string;
  tokenName: string;
  platformName?: string;
  underlyingAsset?: { mint: string; ticker?: string };
  /** The unit PT redeems into and YT pays yield in; «USD» on dollar-quoted markets (ONyc). */
  quoteAsset?: { ticker?: string };
  categories?: string[];
  ptPriceInAsset: number;
  ytPriceInAsset: number;
  impliedApy: number;
  underlyingApy: number;
  /** Base yield averaged over the last 7 and 30 epochs (days), fractions. */
  underlyingApy7Epoch?: number;
  underlyingApy30Epoch?: number;
  maturityDateUnixTs: number;
  startDateUnixTs?: number;
  marketStatus: string;
  /** Market size in underlying-asset units. */
  totalMarketSize?: number;
  pointsBoost: {
    points_name: string;
    points_per_day: number;
    yt_multiplier: number;
    lp_multiplier: number;
    is_active: boolean;
    /** "usd": points_per_day is per $1 of exposure; "sy": per SY unit. */
    type?: 'usd' | 'sy';
    season?: number | null;
  } | null;
}

/** A market counts as new for two weeks after it opens. */
const NEW_WINDOW_MS = 14 * 86_400_000;

const activeProgram = (m: ExponentMarket) => (m.pointsBoost?.is_active ? m.pointsBoost : null);

const program = (pb: NonNullable<ExponentMarket['pointsBoost']>): MarketPointsProgram => ({
  name: pb.points_name,
  pointsPerDay: pb.points_per_day,
  basis: pb.type === 'usd' ? 'usd' : 'unit',
  ytMultiplier: pb.yt_multiplier,
  lpMultiplier: pb.lp_multiplier,
  season: pb.season ?? null,
});

const fraction = (x: number | undefined) => (typeof x === 'number' && Number.isFinite(x) ? toPercent(x) : null);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The market's own pages: /en/market/{farm|fixed}/{name}-{DDMONYY}, the name lower-cased with
 * «+» as «plus» (hyloSOL+ → hylosolplus) and the maturity day in UTC. Checked on all 18 active
 * markets of 2026-10-11 by loading each page (a wrong name or date shows a 404).
 */
export function exponentLinks(m: Pick<ExponentMarket, 'tokenName' | 'maturityDateUnixTs'>): { pt: string; yt: string } | null {
  const name = (m.tokenName ?? '').toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
  const d = new Date(m.maturityDateUnixTs * 1000);
  if (!name || Number.isNaN(d.getTime())) return null;
  const slug = `${name}-${String(d.getUTCDate()).padStart(2, '0')}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
  return { pt: `https://app.exponent.finance/en/market/fixed/${slug}`, yt: `https://app.exponent.finance/en/market/farm/${slug}` };
}

/** The base yield's 7- and 30-day levels, as Exponent publishes them. */
const levels = (m: ExponentMarket) => {
  const d7 = fraction(m.underlyingApy7Epoch);
  const d30 = fraction(m.underlyingApy30Epoch);
  return d7 === null && d30 === null ? null : { d7, d30, d90: null };
};

const marketSizeUnits = (m: ExponentMarket) =>
  Number.isFinite(m.totalMarketSize) ? (m.totalMarketSize as number) : null;

/** Market size in USD from the unit size and Jupiter's price. */
function marketSizeUsd(m: ExponentMarket, token: SolanaToken | undefined): number | null {
  const units = marketSizeUnits(m);
  return units !== null && token?.usdPrice ? units * token.usdPrice : null;
}

export class ExponentAdapter extends BaseAdapter {
  id = 'exponent' as const;
  name = 'Exponent';
  liveData = true;
  private base = protocols.exponent.apiBase;

  private async all(): Promise<ExponentMarket[]> {
    return fetchJson<ExponentMarket[]>(this.name, `${this.base}/markets`, isArrayOf<ExponentMarket>);
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const markets = (await this.all()).filter((m) => m.marketStatus === 'active');
    const tokens = await fetchSolanaTokens(markets.map((m) => m.underlyingAsset?.mint ?? ''));
    return markets.map((m) => {
      const token = tokens.get(m.underlyingAsset?.mint ?? '');
      const pb = activeProgram(m);
      return {
        id: m.vaultAddress,
        name: m.tokenName,
        platform: m.platformName ?? null,
        icon: token?.icon ?? null,
        chain: 'Solana',
        maturity: new Date(m.maturityDateUnixTs * 1000).toISOString(),
        impliedAPY: toPercent(m.impliedApy),
        baseAPY: plausibleAPY(toPercent(m.underlyingApy)),
        baseLevels: levels(m),
        unitUsd: token?.usdPrice ?? null,
        links: exponentLinks(m),
        liquidity: marketSizeUsd(m, token),
        hasPoints: !!pb,
        ytMultiplier: pb?.yt_multiplier ?? null,
        points: pb ? program(pb) : null,
        categories: (m.categories ?? []).map((c) => c.toLowerCase()),
        isNew: !!m.startDateUnixTs && Date.now() - m.startDateUnixTs * 1000 < NEW_WINDOW_MS,
        // Solana mints are case-sensitive: kept exactly as the API gives them.
        asset: { symbol: m.underlyingAsset?.ticker ?? m.tokenName ?? null, address: m.underlyingAsset?.mint ?? null },
        accountingSymbol: m.tokenName ?? null,
      };
    });
  }

  async fetchMarketData(marketId: string): Promise<MarketData> {
    const m = (await this.all()).find((x) => x.vaultAddress === marketId);
    if (!m) throw new MarketNotFoundError(this.name, marketId);
    const token = (await fetchSolanaTokens([m.underlyingAsset?.mint ?? ''])).get(m.underlyingAsset?.mint ?? '');
    const maturity = new Date(m.maturityDateUnixTs * 1000).toISOString();
    const pb = activeProgram(m);

    return {
      protocol: this.id,
      marketId,
      name: m.tokenName,
      // Exponent quotes prices in the asset; the USD price comes from Jupiter when available.
      underlyingPrice: token?.usdPrice ?? null,
      assetSymbol: m.tokenName ?? null,
      // A USD-quoted market's YT pays the yield of $1, not of one asset unit.
      ytUnit: m.quoteAsset?.ticker === 'USD' ? 'usd' : 'asset',
      ptPrice: m.ptPriceInAsset,
      ytPrice: m.ytPriceInAsset,
      impliedAPY: toPercent(m.impliedApy),
      baseAPY: plausibleAPY(toPercent(m.underlyingApy)) ?? NaN,
      maturity,
      daysToMaturity: daysUntil(maturity),
      liquidity: marketSizeUsd(m, token),
      marketSizeUnits: marketSizeUnits(m),
      volume24h: null,
      // Exponent lists every points campaign it tracks, so no entry means no program.
      pointsStatus: pb ? 'active' : 'none',
      points: pb ? program(pb) : null,
      platform: m.platformName ?? null,
      icon: token?.icon ?? null,
      chain: 'Solana',
      fetchedAt: new Date().toISOString(),
      asset: { symbol: m.underlyingAsset?.ticker ?? m.tokenName ?? null, address: m.underlyingAsset?.mint ?? null },
      accountingSymbol: m.tokenName ?? null,
    };
  }

  async getHistoricalAPY(): Promise<number[]> {
    // The public API exposes only rolling averages, not a daily series.
    throw new LiveDataUnavailableError(this.name, 'APY history');
  }
}
