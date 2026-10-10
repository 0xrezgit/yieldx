import lending from '../../config/lending.json';
import { fetchSolanaTokens, type SolanaToken } from '../protocols/jupiter';
import type { Opportunity, RewardStream } from '../../types/opportunity';
import { fetchJson, isArrayOf, isObject, mapLimit, withRetry } from '../protocols/base';
import { HISTORY_DAYS } from '../opportunity/robust-rate';
import type { HistoryPoints } from './history';

/**
 * Kamino Lend — supplying to Kamino's lending reserves on Solana.
 *
 * Source: Kamino's public REST API (api.kamino.finance). Kamino's official SDK only
 * calls `/v2/kamino-market`; the two rate routes below and their field meanings are
 * taken from a third-party client written against Kamino's published OpenAPI
 * document (@1delta/margin-fetcher-sol 0.0.1, measured 2026-09-15/29). Every field
 * used here was checked against the live response on 2026-10-01; the meanings still
 * rest on that third-party client, so every opportunity is marked as coming from an
 * unofficial source and at most «partial» quality.
 *
 * - GET /v2/kamino-market                      → markets (lendingMarket, name, isPrimary)
 * - GET /kamino-market/{market}/reserves/metrics → per reserve: symbol, mint, USD totals, token totals
 * - GET /reserves/batch/stats?market={market}  → keyed by reserve: status, APY breakdown, limits
 *
 * Meanings used: decimal strings; APYs are fractions. `supplyApyBreakdown.lending`
 * is the supply APY from borrower interest (incentives, season rewards and the
 * asset's own yield are separate lines). `depositLimit` is in token units, "0" =
 * closed. `liquidityAvailableUsd` is what can be withdrawn now; `actualAvailableLiquidity`
 * is not — live it equals `borrowLimit − totalBorrow` (0 on collateral-only reserves).
 */

const CFG = lending.kamino;

interface KaminoMarket {
  lendingMarket: string;
  name?: string;
  isPrimary?: boolean;
}
interface KaminoMetric {
  reserve: string;
  liquidityToken?: string;
  liquidityTokenMint?: string;
  totalSupply?: string;
  totalSupplyUsd?: string;
}
interface KaminoRewardApy {
  rewardToken: string;
  apy: string;
}
export interface KaminoStats {
  token?: string;
  status?: string;
  supplyApyBreakdown?: { lending?: string; incentives?: string };
  /** Supply APY now and averaged (`avg7d` …), decimal strings. */
  supplyApy?: { current?: string; avg7d?: string };
  supplyRewardApys?: KaminoRewardApy[];
  liquidityAvailableUsd?: string;
  depositLimit?: string | null;
}

export interface KaminoReserveInput {
  market: KaminoMarket;
  metric: KaminoMetric;
  stats: KaminoStats;
}

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One reserve as a lending opportunity; null when it cannot be read or is not active. */
export function kaminoReserve(r: KaminoReserveInput, fetchedAt: string): Opportunity | null {
  const { market, metric, stats } = r;
  const mint = metric.liquidityTokenMint ?? stats.token ?? null;
  const symbol = metric.liquidityToken ?? null;
  const lendingApy = num(stats.supplyApyBreakdown?.lending);
  if (!mint || !metric.reserve || lendingApy === null || lendingApy < 0 || lendingApy > 10) return null;
  const supplyUsd = num(metric.totalSupplyUsd);
  if (supplyUsd === null || supplyUsd < CFG.minSupplyUsd) return null;
  const supplyUnits = num(metric.totalSupply);
  const unitUsd = supplyUnits && supplyUnits > 0 && supplyUsd > 0 ? supplyUsd / supplyUnits : null;
  const limit = stats.depositLimit === undefined || stats.depositLimit === null ? null : num(stats.depositLimit);
  const remainingUsd = limit === null || unitUsd === null || supplyUnits === null ? null : Math.max(0, (limit - supplyUnits) * unitUsd);
  const rewards: RewardStream[] = (stats.supplyRewardApys ?? [])
    .filter((x) => x.rewardToken && (num(x.apy) ?? 0) > 0)
    .map((x) => ({
      key: `kamino:${metric.reserve}:${x.rewardToken}`,
      source: 'protocol' as const,
      kind: 'token' as const,
      token: { symbol: null, address: x.rewardToken, chain: 'solana:mainnet' },
      aprUsd: (num(x.apy) as number) * 100,
      // Farm emissions come without an end date: listed, never counted in dollars.
      endsAt: null,
      conditional: false,
      vesting: false,
    }));
  const active = !stats.status || stats.status === 'Active';
  return {
    key: `kamino:solana:mainnet:${metric.reserve}:supply`,
    family: 'lend',
    protocol: { id: 'kamino', version: 'klend', name: 'Kamino' },
    chain: 'solana:mainnet',
    market: { id: metric.reserve, address: metric.reserve, name: `${symbol ?? '—'} · ${market.name ?? 'Kamino'}` },
    assets: { deposit: [{ symbol, address: mint }] },
    rate: { value: lendingApy * 100, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: fetchedAt, avg7d: num(stats.supplyApy?.avg7d) === null ? null : (num(stats.supplyApy?.avg7d) as number) * 100 },
    maturity: null,
    capacity: { depositRemainingUsd: remainingUsd, withdrawableNowUsd: num(stats.liquidityAvailableUsd) },
    exit: { type: 'instant', note: 'برداشت تا نقدینگی آزاد ذخیره.' },
    rewards,
    risk: { paused: !active },
    quality: 'partial',
    sources: [{ name: 'Kamino API', url: CFG.api, fetchedAt, sourceUpdatedAt: null }],
    notes: ['منبع Kamino: API عمومی؛ معنای فیلدها از کلاینت شخص ثالث، نه مستندات رسمی.'],
    url: CFG.app,
    unofficialSource: true,
  };
}

const isStats = (b: unknown): b is Record<string, KaminoStats> => isObject(b);

export async function fetchKamino(fetchedAt: string): Promise<Opportunity[]> {
  const markets = await withRetry(() => fetchJson<KaminoMarket[]>(CFG.name, `${CFG.api}/v2/kamino-market`, isArrayOf<KaminoMarket>));
  const list = markets.filter((m) => typeof m?.lendingMarket === 'string').slice(0, CFG.maxMarkets);
  const reads = await mapLimit(list, CFG.concurrency, async (m) => {
    const [metrics, stats] = await Promise.all([
      withRetry(() => fetchJson<KaminoMetric[]>(CFG.name, `${CFG.api}/kamino-market/${m.lendingMarket}/reserves/metrics`, isArrayOf<KaminoMetric>)),
      withRetry(() => fetchJson<Record<string, KaminoStats>>(CFG.name, `${CFG.api}/reserves/batch/stats?market=${m.lendingMarket}`, isStats)),
    ]);
    for (const metric of metrics) reserveMarket.set(metric.reserve, m.lendingMarket);
    return metrics.map((metric) => (stats[metric.reserve] ? kaminoReserve({ market: m, metric, stats: stats[metric.reserve] }, fetchedAt) : null));
  });
  const ok = reads.filter((r): r is PromiseFulfilledResult<(Opportunity | null)[]> => r.status === 'fulfilled');
  if (list.length && !ok.length) throw (reads[0] as PromiseRejectedResult).reason;
  const rows = ok.flatMap((r) => r.value).filter((o): o is Opportunity => o !== null);
  // Kamino's API has no logos: Jupiter's token list by mint (100 a request; best-effort).
  const mints = [...new Set(rows.map((o) => o.assets.deposit[0]?.address).filter((a): a is string => !!a))];
  const tokens = new Map<string, SolanaToken>();
  for (let i = 0; i < mints.length; i += 100) for (const [k, v] of await fetchSolanaTokens(mints.slice(i, i + 100))) tokens.set(k, v);
  return rows.map((o) => {
    const icon = tokens.get(o.assets.deposit[0]?.address ?? '')?.icon;
    return icon ? { ...o, icon } : o;
  });
}

// ─── Daily history (robust rate) ─────────────────────────────────────────────

/** Each reserve's lending market, for its history route (filled by `fetchKamino`). */
const reserveMarket = new Map<string, string>();

/** Daily supply interest APY (%) per reserve: one request each, a few at a time. */
export async function fetchKaminoHistory(list: Opportunity[]): Promise<Map<string, HistoryPoints>> {
  const out = new Map<string, HistoryPoints>();
  const start = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const end = new Date().toISOString();
  await mapLimit(list, CFG.concurrency, async (o) => {
    const reserve = o.market.id;
    const market = reserveMarket.get(reserve);
    if (!market) return;
    const body = await fetchJson<{ history?: { timestamp?: string; metrics?: { supplyInterestAPY?: number | string } }[] }>(
      CFG.name,
      `${CFG.api}/kamino-market/${market}/reserves/${reserve}/metrics/history?env=mainnet-beta&start=${start}&end=${end}&frequency=day`,
      isObject,
    );
    out.set(
      o.key,
      (body.history ?? []).map((h) => ({ t: Date.parse(h.timestamp ?? ''), v: num(h.metrics?.supplyInterestAPY) === null ? null : (num(h.metrics?.supplyInterestAPY) as number) * 100 })),
    );
  });
  return out;
}
