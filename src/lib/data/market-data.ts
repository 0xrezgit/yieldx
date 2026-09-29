import type { MarketData, MarketListing } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import { defaultScenario, type ScenarioParams } from '../../types/scenario';

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
  return getJson<{ markets: MarketListing[] }>(`/api/${protocol}`, signal).then((r) => r.markets);
}

/**
 * Shared market-list cache for every page: one request per protocol at a time
 * (concurrent callers share it), reused for `LIST_TTL_MS`, and the last good list is
 * kept so a failed refresh can still show data — flagged as stale, never as live.
 */
const LIST_TTL_MS = 60_000;
interface ListEntry {
  data: MarketListing[] | null;
  at: number;
  inflight: Promise<MarketListing[]> | null;
}
const lists = new Map<ProtocolId, ListEntry>();

export interface SharedList {
  markets: MarketListing[];
  /** When the list was received (ms). */
  at: number;
  /** True when this is the last good list after a failed refresh. */
  stale: boolean;
}

export async function fetchMarketsShared(protocol: ProtocolId, opts: { force?: boolean } = {}): Promise<SharedList> {
  const e = lists.get(protocol) ?? { data: null, at: 0, inflight: null };
  lists.set(protocol, e);
  if (!opts.force && e.data && Date.now() - e.at < LIST_TTL_MS) return { markets: e.data, at: e.at, stale: false };
  if (!e.inflight) {
    e.inflight = fetchMarkets(protocol)
      .then((m) => {
        e.data = m;
        e.at = Date.now();
        return m;
      })
      .finally(() => {
        e.inflight = null;
      });
  }
  try {
    const m = await e.inflight;
    return { markets: m, at: e.at, stale: false };
  } catch (err) {
    if (e.data) return { markets: e.data, at: e.at, stale: true };
    throw err;
  }
}

/** Test hook. */
export const clearListCache = () => lists.clear();

export function fetchMarket(protocol: ProtocolId, marketId: string, historyDays = 0, signal?: AbortSignal) {
  const q = historyDays ? `?history=${historyDays}` : '';
  return getJson<{ market: MarketData; history: number[] | null }>(
    `/api/${protocol}/${encodeURIComponent(marketId)}${q}`,
    signal,
  );
}

export interface TokenPrice {
  usd: number;
  /** When the price was observed (can differ from the requested time by a few hours). */
  at: string;
}

/** USD prices by DefiLlama coin id ("base:0x…", "solana:<mint>"), now or at `atMs`. */
export function fetchCoinPrices(coins: string[], atMs?: number, signal?: AbortSignal) {
  const q = new URLSearchParams({ coins: coins.join(',') });
  if (atMs !== undefined) q.set('at', String(Math.floor(atMs / 1000)));
  return getJson<{ prices: Record<string, TokenPrice> }>(`/api/prices?${q}`, signal).then((r) => r.prices);
}

/** USD prices of listed tokens now, or at `atMs` when given. */
export function fetchPrices(symbols: string[], atMs?: number, signal?: AbortSignal) {
  const q = new URLSearchParams({ symbols: symbols.join(',') });
  if (atMs !== undefined) q.set('at', String(Math.floor(atMs / 1000)));
  return getJson<{ prices: Record<string, TokenPrice> }>(`/api/prices?${q}`, signal).then((r) => r.prices);
}

/** Fields filled from the market API; typing into one marks it as a manual override. */
export const MARKET_FIELDS = ['underlyingPrice', 'ptPrice', 'ytPrice', 'baseAPY', 'maturity', 'apyHistory', 'liquidity'] as const satisfies readonly (keyof ScenarioParams)[];

/** Assumptions that belong to one market (points program, airdrop, pool settings). */
export const MARKET_ASSUMPTIONS = [
  'pointsName',
  'pointsSeason',
  'pointsPerDay',
  'pointsBasis',
  'ytMultiplier',
  'lpMultiplier',
  'fdv',
  'airdropAllocation',
  'totalPointsSupply',
  'existingPoints',
  'snapshotDate',
  'borrowAPY',
  'liquidationThreshold',
  'rangeLowerAPY',
  'rangeUpperAPY',
  'feeAPY',
] as const satisfies readonly (keyof ScenarioParams)[];

export interface MergeOptions {
  /** Keep the previous market's airdrop/points assumptions — only on the user's explicit choice. */
  carryAssumptions?: boolean;
}

/**
 * Neutral values for a market's own assumptions: no points counted (0/day, ×1) and
 * default airdrop/loan/pool inputs. Used whenever a market is left, so nothing of
 * the previous market is attributed to the next one.
 */
function neutralAssumptions(impliedAPY: number): Partial<ScenarioParams> {
  const d = defaultScenario();
  return {
    pointsName: '',
    pointsSeason: null,
    pointsPerDay: 0,
    pointsBasis: d.pointsBasis,
    ytMultiplier: 1,
    lpMultiplier: 1,
    fdv: d.fdv,
    airdropAllocation: d.airdropAllocation,
    totalPointsSupply: d.totalPointsSupply,
    existingPoints: 0,
    snapshotDate: '',
    borrowAPY: d.borrowAPY,
    liquidationThreshold: d.liquidationThreshold,
    feeAPY: d.feeAPY,
    // A neutral CLMM range around this market's rate (an assumption, editable).
    ...(Number.isFinite(impliedAPY) && impliedAPY > 0
      ? { rangeLowerAPY: round(impliedAPY * 0.7, 1), rangeUpperAPY: round(impliedAPY * 1.3, 1) }
      : { rangeLowerAPY: d.rangeLowerAPY, rangeUpperAPY: d.rangeUpperAPY }),
  };
}

const finiteOr = (x: number | null | undefined, fallback: number) => (x !== null && x !== undefined && Number.isFinite(x) ? x : fallback);

/**
 * Applies fetched market data to the scenario.
 *
 * - Same market (a refresh): observed values are updated, but anything the user typed
 *   by hand (dataMeta.manual) and every assumption is kept.
 * - Another market: nothing market-specific survives. Points program, airdrop and pool
 *   assumptions go back to neutral defaults (unless `carryAssumptions`), APY history is
 *   replaced (or emptied), and values the API does not provide become unknown (NaN) —
 *   never the previous market's number. Capital and personal strategy settings stay.
 */
export function mergeMarketData(p: ScenarioParams, m: MarketData, history: number[] | null, opts: MergeOptions = {}): ScenarioParams {
  // Same market = a refresh. (After a new pick, clearMarket has already blanked the old numbers.)
  const same = p.protocol === m.protocol && p.marketId === m.marketId;
  const manual = new Set(same ? p.dataMeta?.manual ?? [] : []);
  const keep = <K extends keyof ScenarioParams>(k: K, next: ScenarioParams[K]): ScenarioParams[K] => (manual.has(k) ? p[k] : next);
  const d = defaultScenario();

  const missing: string[] = [];
  if (m.underlyingPrice === null || !Number.isFinite(m.underlyingPrice)) missing.push('underlyingPrice');
  if (!Number.isFinite(m.baseAPY)) missing.push('baseAPY');
  if (!history || !history.length) missing.push('apyHistory');
  if (m.liquidity === null) missing.push('liquidity');

  // Unknown now: on a refresh the user's own number stays, on a new market it is unknown.
  const unknown = (k: 'underlyingPrice' | 'baseAPY') => (same ? p[k] : NaN);

  // New market: neutral assumptions (clearMarket already applied them on a pick; a direct merge does it here).
  // On a pick the range is re-centred on the real rate once it is known.
  const fresh = !opts.carryAssumptions && (!same || !p.dataMeta);
  const assumptions: Partial<ScenarioParams> = !fresh ? {} : same ? rangeOnly(neutralAssumptions(m.impliedAPY), p) : neutralAssumptions(m.impliedAPY);

  return {
    ...p,
    ...assumptions,
    protocol: m.protocol as ScenarioParams['protocol'],
    marketId: m.marketId,
    marketName: m.name,
    underlyingPrice: keep('underlyingPrice', finiteOr(m.underlyingPrice, unknown('underlyingPrice'))),
    ptPrice: keep('ptPrice', round(m.ptPrice, 6)),
    ytPrice: keep('ytPrice', round(m.ytPrice, 6)),
    baseAPY: keep('baseAPY', Number.isFinite(m.baseAPY) ? round(m.baseAPY, 4) : unknown('baseAPY')),
    maturity: keep('maturity', m.maturity.slice(0, 10)),
    liquidity: keep('liquidity', m.liquidity),
    marketSizeUnits: m.marketSizeUnits,
    apyHistory: keep('apyHistory', history && history.length ? history.map((x) => round(x, 4)) : same ? p.apyHistory : []),
    platform: m.platform ?? '',
    marketIcon: m.icon ?? '',
    chain: m.chain,
    pointsStatus: m.pointsStatus,
    ...pointsFields(m, same),
    manualEntry: false,
    dataMeta: {
      source: 'api',
      fetchedAt: m.fetchedAt || new Date().toISOString(),
      sourceUpdatedAt: m.sourceUpdatedAt ?? null,
      missing,
      manual: [...manual],
      accountingSymbol: m.accountingSymbol ?? m.assetSymbol ?? null,
      asset: m.asset ?? null,
      historySource: history && history.length ? 'api' : same && p.apyHistory.length ? p.dataMeta?.historySource ?? 'none' : 'none',
    },
  };
}

/**
 * Program details from the API win. A market known to have no program earns no
 * points; when the program exists but isn't detailed (Pendle), the rate stays
 * unknown (0 = not counted) until the user enters it — on a refresh their entry stays.
 */
function pointsFields(m: MarketData, same: boolean): Partial<ScenarioParams> {
  if (m.points) {
    return {
      pointsName: m.points.name,
      pointsPerDay: m.points.pointsPerDay,
      pointsBasis: m.points.basis,
      ytMultiplier: m.points.ytMultiplier,
      lpMultiplier: m.points.lpMultiplier,
      pointsSeason: m.points.season,
    };
  }
  if (m.pointsStatus === 'none') return { pointsPerDay: 0, pointsSeason: null, pointsName: '' };
  return same ? {} : { pointsPerDay: 0, pointsName: '' };
}

/** After a pick (assumptions already neutral, possibly edited): only the CLMM range is re-centred. */
function rangeOnly(n: Partial<ScenarioParams>, p: ScenarioParams): Partial<ScenarioParams> {
  const d = defaultScenario();
  const untouched = p.rangeLowerAPY === d.rangeLowerAPY && p.rangeUpperAPY === d.rangeUpperAPY;
  return untouched ? { rangeLowerAPY: n.rangeLowerAPY, rangeUpperAPY: n.rangeUpperAPY } : {};
}

/** Clears everything tied to the selected market (on a new pick or a protocol change). */
export function clearMarket(p: ScenarioParams): ScenarioParams {
  return {
    ...p,
    ...neutralAssumptions(NaN),
    marketId: '',
    marketName: '',
    marketIcon: '',
    platform: '',
    chain: '',
    // Observed numbers of the old market are unknown for the next one — never reused.
    underlyingPrice: NaN,
    ptPrice: NaN,
    ytPrice: NaN,
    baseAPY: NaN,
    apyHistory: [],
    liquidity: null,
    marketSizeUnits: null,
    pointsStatus: 'unknown',
    pointsName: '',
    pointsPerDay: 0,
    manualEntry: false,
    dataMeta: undefined,
  };
}

/** Marks a market field as typed by hand, so refreshes don't overwrite it and the UI labels it «دستی». */
export function markManual(p: ScenarioParams, key: keyof ScenarioParams): ScenarioParams {
  if (!(MARKET_FIELDS as readonly string[]).includes(key) || !p.dataMeta || p.dataMeta.manual.includes(key)) return p;
  return { ...p, dataMeta: { ...p.dataMeta, manual: [...p.dataMeta.manual, key], missing: p.dataMeta.missing.filter((f) => f !== key) } };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
