import type { MarketData, MarketSummary } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import type { ScenarioParams } from '../../types/scenario';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.message ?? res.statusText);
  return body as T;
}

export function fetchMarkets(protocol: ProtocolId, signal?: AbortSignal) {
  return getJson<{ markets: MarketSummary[] }>(`/api/${protocol}`, signal).then((r) => r.markets);
}

export function fetchMarket(protocol: ProtocolId, marketId: string, historyDays = 0, signal?: AbortSignal) {
  const q = historyDays ? `?history=${historyDays}` : '';
  return getJson<{ market: MarketData; history: number[] | null }>(
    `/api/${protocol}/${encodeURIComponent(marketId)}${q}`,
    signal,
  );
}

/**
 * Applies fetched market data on top of the current scenario. Values the API does
 * not provide (e.g. Exponent's USD price) keep the user's input; manually entered
 * history is kept when the protocol has none.
 */
export function mergeMarketData(p: ScenarioParams, m: MarketData, history: number[] | null): ScenarioParams {
  return {
    ...p,
    marketId: m.marketId,
    marketName: m.name,
    underlyingPrice: m.underlyingPrice ?? p.underlyingPrice,
    ptPrice: round(m.ptPrice, 6),
    ytPrice: round(m.ytPrice, 6),
    baseAPY: round(m.baseAPY, 4),
    maturity: m.maturity.slice(0, 10),
    liquidity: m.liquidity,
    apyHistory: history && history.length ? history.map((x) => round(x, 4)) : p.apyHistory,
    ...(m.points
      ? {
          pointsName: m.points.name,
          pointsPerDay: m.points.pointsPerDay,
          ytMultiplier: m.points.ytMultiplier,
          lpMultiplier: m.points.lpMultiplier,
        }
      : {}),
  };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
