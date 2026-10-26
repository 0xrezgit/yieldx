import 'server-only';
import protocols from '../../config/protocols.json';
import { fetchJson, isArrayOf, isObject } from '../protocols/base';
import { pendleLoopUrl, type PendleLoopBox } from '../lending/pendle-loop';
import { parseRisk } from '../longshort/feed';
import type { LoopBox, LoopBoxesFeed, LoopHistoryFeed, LoopHistoryRow, LoopHistorySeries } from './types';

/**
 * PendleLoop «Loop to Earn» for the loop page and the history check, straight from Pendle's
 * public API — no network, protocol or market is listed here: whatever Pendle lists today
 * (Morpho, Aave V3, Euler on Ethereum, Monad, Base, Plasma, X Layer, Arbitrum…) comes through,
 * and a PT whose maturity has passed drops out on its own.
 *
 * - GET /v1/pt-looping/loop/boxes — every box, re-read every `BOXES_TTL_MS`.
 * - GET /v1/pt-looping/loop/pts/{chain}/{pt}/charts?timeFrame=hour — each box of that PT, hour
 *   by hour: borrow APY, the oracle's PT price, the market's, the fixed APY (Pendle keeps
 *   about 92 days of hours).
 */

const BOXES_TTL_MS = 2 * 60_000;
const HISTORY_TTL_MS = 30 * 60_000;
const HISTORY_DAYS = 92;
const HISTORY_CACHE_MAX = 200;

type Box = PendleLoopBox & {
  expiry?: string | null;
  ptMarketAddress?: string | null;
  iconUrl?: string | null;
  minOpenUsd?: number | null;
  risks?: Parameters<typeof parseRisk>[0];
  data?: (PendleLoopBox['data'] & { maxLeverage?: number; maxApy?: number; serviceFeeRate?: number; reference?: { fixedApy?: number } | null }) | null;
};

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);
const https = (x: unknown): string | null => (typeof x === 'string' && x.startsWith('https://') ? x : null);

/** A box as the page needs it; null for long/short, broken or expired boxes. */
export function loopBoxOf(b: Box, now = Date.now()): LoopBox | null {
  const d = b.data ?? {};
  if (b.side || (b.kind !== 'pt' && b.kind !== 'vanilla')) return null;
  if (!fin(b.chainId) || !isAddr(b.ptAddress) || !isAddr(b.debtAsset) || !isAddr(b.moneyMarketAddress) || !b.ptSymbol || !b.debtSymbol || !b.boxId) return null;
  if (!fin(d.lltv) || !(d.lltv > 0 && d.lltv < 1) || !fin(d.borrowApy) || d.borrowApy < 0 || d.borrowApy > 10) return null;
  const expiry = b.kind === 'pt' && typeof b.expiry === 'string' ? b.expiry : null;
  if (b.kind === 'pt' && (!expiry || !(Date.parse(expiry) > now))) return null;
  const yieldApy = b.kind === 'pt' ? (fin(d.reference?.fixedApy) ? d.reference.fixedApy : null) : fin(d.collateralYieldApy) ? d.collateralYieldApy : null;
  return {
    boxId: b.boxId,
    chainId: b.chainId,
    kind: b.kind,
    collateral: { address: b.ptAddress.toLowerCase(), symbol: b.ptSymbol },
    debt: { address: b.debtAsset.toLowerCase(), symbol: b.debtSymbol },
    protocol: { name: b.protocol.toLowerCase() === 'aave' ? 'Aave V3' : b.protocol, icon: https(b.iconUrl) },
    moneyMarketAddress: b.moneyMarketAddress.toLowerCase(),
    expiry,
    ptMarketAddress: isAddr(b.ptMarketAddress) ? b.ptMarketAddress.toLowerCase() : null,
    pendleUrl: pendleLoopUrl(b),
    marketUrl: https(b.marketUrl),
    lltv: d.lltv,
    borrowApy: d.borrowApy,
    borrowApy7dAvg: fin(d.borrowApy7dAvg) ? d.borrowApy7dAvg : null,
    yieldApy,
    maxApy: fin(d.maxApy) && d.maxApy < 10 ? d.maxApy : null,
    maxLeverage: fin(d.maxLeverage) ? d.maxLeverage : null,
    liquidityUsd: fin(d.liquidityUsd) ? d.liquidityUsd : null,
    utilization: fin(d.utilization) ? d.utilization : null,
    serviceFeeRate: fin(d.serviceFeeRate) ? d.serviceFeeRate : null,
    minOpenUsd: fin(b.minOpenUsd) ? b.minOpenUsd : null,
    isDepegged: b.isDepegged === true,
    risk: parseRisk(b.risks),
  };
}

let boxesCache: { at: number; feed: LoopBoxesFeed } | null = null;

export async function getLoopBoxes(now = Date.now()): Promise<LoopBoxesFeed> {
  if (boxesCache && now - boxesCache.at < BOXES_TTL_MS) return boxesCache.feed;
  try {
    const raw = await fetchJson<Box[]>('PendleLoop', `${protocols.pendle.apiBase}/v1/pt-looping/loop/boxes`, isArrayOf<Box>);
    const boxes = raw.map((b) => loopBoxOf(b, now)).filter((b): b is LoopBox => b !== null);
    boxesCache = { at: now, feed: { fetchedAt: new Date(now).toISOString(), boxes, error: null } };
    return boxesCache.feed;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'unknown error';
    // The last good list, re-checked for maturities that passed since.
    if (boxesCache) return { ...boxesCache.feed, boxes: boxesCache.feed.boxes.filter((b) => !b.expiry || Date.parse(b.expiry) > now), error };
    return { fetchedAt: new Date(now).toISOString(), boxes: [], error };
  }
}

type RawPoint = { timestamp?: number; borrowApy?: number | null; ptOraclePriceInDebt?: number | null; ptMarketPriceInDebt?: number | null; fixedApy?: number | null; liquidityUsd?: number | null };
type RawCharts = { series?: { boxId?: string; moneyMarketAddress?: string; debtAsset?: string; points?: RawPoint[] }[] };

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Pendle's chart answer → compact rows; points without a price or a rate are dropped. */
export function historySeries(raw: RawCharts): LoopHistorySeries[] {
  return (raw.series ?? []).flatMap((s) => {
    if (!s.boxId || !isAddr(s.moneyMarketAddress) || !isAddr(s.debtAsset)) return [];
    const rows: LoopHistoryRow[] = (s.points ?? []).flatMap((p) =>
      fin(p.timestamp) && fin(p.borrowApy) && fin(p.ptOraclePriceInDebt) && fin(p.ptMarketPriceInDebt) && p.ptOraclePriceInDebt > 0 && p.ptMarketPriceInDebt > 0
        ? [[p.timestamp, r6(p.borrowApy * 100), r6(p.ptOraclePriceInDebt), r6(p.ptMarketPriceInDebt), fin(p.fixedApy) ? r6(p.fixedApy * 100) : null, fin(p.liquidityUsd) ? Math.round(p.liquidityUsd) : null] as LoopHistoryRow]
        : [],
    );
    return rows.length ? [{ boxId: s.boxId, moneyMarketAddress: s.moneyMarketAddress.toLowerCase(), debtAsset: s.debtAsset.toLowerCase(), rows }] : [];
  });
}

const historyCache = new Map<string, { at: number; feed: LoopHistoryFeed }>();
const historyRunning = new Map<string, Promise<LoopHistoryFeed>>();

/** Hourly history of every box of one PT (cached; one upstream call at a time per PT). */
export async function getLoopHistory(chainId: number, pt: string, now = Date.now()): Promise<LoopHistoryFeed> {
  const key = `${chainId}:${pt.toLowerCase()}`;
  const hit = historyCache.get(key);
  if (hit && now - hit.at < HISTORY_TTL_MS) return hit.feed;
  const running = historyRunning.get(key);
  if (running) return running;
  const job = (async () => {
    const start = Math.floor(now / 1000) - HISTORY_DAYS * 86_400;
    const raw = await fetchJson<RawCharts>('PendleLoop', `${protocols.pendle.apiBase}/v1/pt-looping/loop/pts/${chainId}/${pt.toLowerCase()}/charts?timeFrame=hour&timestampStart=${start}`, isObject<RawCharts>, 30_000, true); // cached here (the answer is over Next's 2 MB fetch-cache limit)
    const feed: LoopHistoryFeed = { chainId, pt: pt.toLowerCase(), fetchedAt: new Date(now).toISOString(), series: historySeries(raw) };
    if (historyCache.size >= HISTORY_CACHE_MAX) historyCache.delete(historyCache.keys().next().value as string);
    historyCache.set(key, { at: now, feed });
    return feed;
  })();
  historyRunning.set(key, job);
  try {
    return await job;
  } catch (e) {
    if (hit) return hit.feed;
    throw e;
  } finally {
    historyRunning.delete(key);
  }
}
