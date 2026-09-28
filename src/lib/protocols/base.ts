import type { MarketData, MarketSummary } from '../../types/market';
import type { PointsParams, PositionParams, ProtocolAdapter, ProtocolId } from '../../types/protocol';
import { impliedAPYFromYT } from '../calculators/implied-apy';
import { pointsEarned } from '../calculators/airdrop';
import { validatePosition, type ValidationResult } from '../utils/validation';

/** Thrown when a protocol has no live data source — the UI switches to manual entry. */
export class LiveDataUnavailableError extends Error {
  constructor(protocol: string, what = 'market data') {
    super(`${protocol}: live ${what} is not available; enter values manually.`);
    this.name = 'LiveDataUnavailableError';
  }
}

export class MarketNotFoundError extends Error {
  constructor(protocol: string, marketId: string) {
    super(`${protocol}: market "${marketId}" not found.`);
    this.name = 'MarketNotFoundError';
  }
}

export class UpstreamError extends Error {
  constructor(
    protocol: string,
    public status: number,
  ) {
    super(`${protocol}: upstream API responded with ${status}.`);
    this.name = 'UpstreamError';
  }
}

export async function fetchJson<T>(protocol: string, url: string): Promise<T> {
  const res = await fetch(url, { next: { revalidate: 60 }, headers: { accept: 'application/json' } } as RequestInit);
  if (!res.ok) throw new UpstreamError(protocol, res.status);
  return (await res.json()) as T;
}

/** Shared math — adapters only need to implement data access. */
export abstract class BaseAdapter implements ProtocolAdapter {
  abstract id: ProtocolId;
  abstract name: string;
  abstract liveData: boolean;

  abstract listMarkets(): Promise<MarketSummary[]>;
  abstract fetchMarketData(marketId: string): Promise<MarketData>;
  abstract getHistoricalAPY(marketId: string, days: number): Promise<number[]>;

  calculateImpliedAPY(ytPrice: number, daysToMaturity: number): number {
    return impliedAPYFromYT(ytPrice, daysToMaturity);
  }

  calculatePointsEarning({ exposureUnits, pointsPerDay, multiplier, days }: PointsParams): number {
    return pointsEarned(exposureUnits, pointsPerDay, multiplier, days);
  }

  validatePosition(params: PositionParams): ValidationResult {
    return validatePosition(params);
  }
}

/**
 * Base (underlying) APYs above this are treated as broken API data, not yield —
 * one bad number (e.g. 1 552 741%) would otherwise turn any YT into a fantasy profit.
 */
export const MAX_PLAUSIBLE_APY = 1000;

/** The APY when it is a believable percentage, otherwise null (unknown). */
export function plausibleAPY(x: number | null | undefined): number | null {
  return x !== null && x !== undefined && Number.isFinite(x) && x > -100 && x <= MAX_PLAUSIBLE_APY ? x : null;
}

export const toPercent = (fraction: unknown): number => {
  const n = typeof fraction === 'string' ? Number(fraction) : (fraction as number);
  return Number.isFinite(n) ? n * 100 : NaN;
};
