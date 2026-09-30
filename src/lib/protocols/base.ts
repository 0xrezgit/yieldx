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
    detail = `upstream API responded with ${status}`,
  ) {
    super(`${protocol}: ${detail}.`);
    this.name = 'UpstreamError';
  }
}

/** A protocol API that has not answered in this long is treated as down. */
export const FETCH_TIMEOUT_MS = 15_000;

/** Checks the rough shape of a response before it is cast; a mismatch is an upstream error, not a crash later. */
export type Shape<T> = (body: unknown) => body is T;

export const isArrayOf = <T>(body: unknown): body is T[] => Array.isArray(body);
export const isObject = <T extends object>(body: unknown): body is T =>
  typeof body === 'object' && body !== null && !Array.isArray(body);

/**
 * GET a protocol API. Every failure mode ends as an UpstreamError so each route
 * can report «this source is down» instead of a 500: timeout (504), network error
 * or unreadable body (502), HTTP error (its status), unexpected shape (502).
 */
export async function fetchJson<T>(protocol: string, url: string, shape?: Shape<T>, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      next: { revalidate: 60 },
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new UpstreamError(protocol, timedOut ? 504 : 502, timedOut ? `no answer within ${timeoutMs / 1000}s` : 'network error');
  }
  if (!res.ok) throw new UpstreamError(protocol, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamError(protocol, 502, 'response is not valid JSON');
  }
  if (shape && !shape(body)) throw new UpstreamError(protocol, 502, 'response has an unexpected shape');
  return body as T;
}

/**
 * POST a fixed GraphQL query. Same failure mapping as fetchJson; a GraphQL `errors`
 * array without `data` is an upstream error too (partial data is kept).
 * Not cached by Next (POST) — callers cache the result themselves.
 */
export async function postGraphql<T>(protocol: string, url: string, query: string, variables: Record<string, unknown>, shape: Shape<T>, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new UpstreamError(protocol, timedOut ? 504 : 502, timedOut ? `no answer within ${timeoutMs / 1000}s` : 'network error');
  }
  if (!res.ok) throw new UpstreamError(protocol, res.status);
  let body: { data?: unknown; errors?: unknown[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new UpstreamError(protocol, 502, 'response is not valid JSON');
  }
  if (!body || body.data == null) throw new UpstreamError(protocol, 502, Array.isArray(body?.errors) ? 'GraphQL error' : 'response has no data');
  if (!shape(body.data)) throw new UpstreamError(protocol, 502, 'response has an unexpected shape');
  return body.data;
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
