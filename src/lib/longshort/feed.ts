import 'server-only';
import protocols from '../../config/protocols.json';
import { fetchJson, isArrayOf, isObject, mapLimit, postJson } from '../protocols/base';
import { pendleLoopUrl, type PendleLoopBox } from '../lending/pendle-loop';
import type { LongShortFeed, LongShortRisk, LongShortRow, PerpRef } from './types';

/**
 * PendleLoop's Long/Short markets (GET /v1/pt-looping/loop/boxes?includeLongShort=true,
 * the boxes with a `side`) and, beside each, the same view as a Hyperliquid perpetual:
 * funding now and its 7-day average, highest leverage. Fixed queries only.
 *
 * In the box, `maxLeverage` is collateral ÷ equity: for a short that is one more than
 * the leverage PendleLoop shows (2.68 → «2.6×»), so it is taken back to exposure ÷ equity.
 */

const PENDLE_TTL_MS = 2 * 60_000;
const PERP_TTL_MS = 10 * 60_000;
const HL = 'https://api.hyperliquid.xyz/info';

type Box = PendleLoopBox & {
  side?: string | null;
  categoryIds?: string[];
  baseAsset?: { address: string; symbol: string } | null;
  basePriceUsd?: number | null;
  basePriceChange24h?: number | null;
  baseMarketHours?: { open: number; close: number }[] | null;
  risks?: { overall?: { level?: string; label?: string }; description?: string } | null;
  data?: (PendleLoopBox['data'] & { maxLeverage?: number; optimalUtilization?: number; serviceFeeRate?: number; borrowApySpot?: number }) | null;
};

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Pendle's oracle write-up: a summary paragraph, then «## Name / [color:x] Label / text» sections. */
export function parseRisk(r: Box['risks']): LongShortRisk | null {
  if (!r?.overall?.level) return null;
  const html = r.description ?? '';
  const [head, ...sections] = html.split(/<h2[^>]*>/);
  const summary = text(head.replace(/\[custom-syntax-\d+\]/g, '')) || null;
  const items = sections.flatMap((s) => {
    const [name, rest = ''] = s.split('</h2>');
    const paras = [...rest.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    const tag = paras[0]?.match(/^\[color:(\w+)\]\s*(.*)$/);
    if (!tag) return [];
    const level = tag[1] === 'safe' ? 'low' : tag[1] === 'warning' ? 'medium' : tag[1] === 'danger' ? 'high' : tag[1];
    return [{ name: text(name), level, label: text(tag[2]), text: text(paras.slice(1).join(' ')) }];
  });
  return { level: r.overall.level, label: r.overall.label ?? r.overall.level, summary, items };
}

/** The Hyperliquid coin for a base asset: ETH and its wrappers, BTC and its wrappers, stocks on the «xyz» dex. */
export function perpCoinOf(symbol: string, category: string): string | null {
  if (category === 'stocks') {
    const t = symbol.replace(/c$/, '').toUpperCase();
    return /^[A-Z]{1,6}$/.test(t) ? `xyz:${t}` : null;
  }
  if (/^(w?eth|wsteth|weeth|steth)$/i.test(symbol)) return 'ETH';
  if (/^(wbtc|cbbtc|tbtc|btc)$/i.test(symbol)) return 'BTC';
  return null;
}

export function longShortRow(b: Box): LongShortRow | null {
  const d = b.data ?? {};
  const side = b.side === 'long' || b.side === 'short' ? b.side : null;
  if (!side || b.isDepegged || !b.baseAsset || !isAddr(b.baseAsset.address) || !isAddr(b.ptAddress) || !isAddr(b.debtAsset)) return null;
  if (!fin(d.lltv) || !(d.lltv > 0 && d.lltv < 1) || !fin(d.borrowApy) || !fin(d.maxLeverage) || !fin(b.basePriceUsd) || !(b.basePriceUsd > 0)) return null;
  const category = b.categoryIds?.includes('stocks') ? 'stocks' : 'crypto';
  const maxLeverage = side === 'short' ? d.maxLeverage - 1 : d.maxLeverage;
  if (!(maxLeverage > 1)) return null;
  return {
    key: `pendleloop:${b.chainId}:${b.boxId}`,
    boxId: b.boxId,
    chainId: b.chainId,
    protocol: b.protocol,
    side,
    category,
    base: { symbol: b.baseAsset.symbol, address: b.baseAsset.address.toLowerCase() },
    collateral: { symbol: b.ptSymbol, address: b.ptAddress.toLowerCase() },
    debt: { symbol: b.debtSymbol, address: b.debtAsset.toLowerCase() },
    priceUsd: b.basePriceUsd,
    change24hPct: fin(b.basePriceChange24h) ? b.basePriceChange24h * 100 : null,
    lltv: d.lltv,
    maxLeverage,
    borrowNowPct: (fin(d.borrowApySpot) ? d.borrowApySpot : d.borrowApy) * 100,
    borrow7dPct: fin(d.borrowApy7dAvg) ? d.borrowApy7dAvg * 100 : null,
    collateralYieldPct: ((fin(d.collateralYieldApy) ? d.collateralYieldApy : 0) + (fin(d.collateralSupplyApy) ? d.collateralSupplyApy : 0)) * 100,
    liquidityUsd: fin(d.liquidityUsd) ? d.liquidityUsd : null,
    utilization: fin(d.utilization) ? d.utilization : null,
    optimalUtilization: fin(d.optimalUtilization) ? d.optimalUtilization : null,
    feeRate: fin(d.serviceFeeRate) ? d.serviceFeeRate : 0,
    risk: parseRisk(b.risks),
    marketHours: (b.baseMarketHours ?? []).filter((h) => fin(h.open) && fin(h.close) && h.close > h.open),
    url: pendleLoopUrl(b),
    marketUrl: b.marketUrl?.startsWith('https://') ? b.marketUrl : null,
    perp: null,
  };
}

type HlMeta = [{ universe: { name: string; maxLeverage: number }[] }, { funding: string; markPx: string }[]];
const isMeta = (x: unknown): x is HlMeta => Array.isArray(x) && x.length === 2 && isObject(x[0]) && Array.isArray(x[1]);
const YEAR_HOURS = 24 * 365;

/** Hyperliquid perps for these coins: live funding and highest leverage, then each one's last 7 days of hourly funding. */
export async function fetchPerps(coins: string[], now: number): Promise<Map<string, PerpRef>> {
  const out = new Map<string, PerpRef>();
  const dexes = [...new Set(coins.map((c) => (c.includes(':') ? c.split(':')[0] : '')))];
  for (const dex of dexes) {
    const [meta, ctx] = await postJson<HlMeta>('Hyperliquid', HL, dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }, isMeta);
    meta.universe.forEach((u, i) => {
      const c = ctx[i];
      const f = Number(c?.funding);
      const px = Number(c?.markPx);
      if (coins.includes(u.name) && Number.isFinite(f) && px > 0)
        out.set(u.name, { venue: 'Hyperliquid', coin: u.name, fundingNowPct: f * YEAR_HOURS * 100, funding7dPct: null, maxLeverage: u.maxLeverage, markPx: px, url: `https://app.hyperliquid.xyz/trade/${u.name}` });
    });
  }
  const startTime = now - 7 * 86_400_000;
  await mapLimit([...out.keys()], 3, async (coin) => {
    const h = await postJson<{ fundingRate: string }[]>('Hyperliquid', HL, { type: 'fundingHistory', coin, startTime }, isArrayOf);
    const r = h.map((x) => Number(x.fundingRate)).filter(Number.isFinite);
    // At least five days of hourly points, or the average says too little.
    if (r.length >= 120) out.get(coin)!.funding7dPct = (r.reduce((a, b) => a + b, 0) / r.length) * YEAR_HOURS * 100;
  });
  return out;
}

let pendleCache: { at: number; rows: LongShortRow[]; fetchedAt: string } | null = null;
let perpCache: { at: number; perps: Map<string, PerpRef> } | null = null;

export async function getLongShortFeed(now = Date.now()): Promise<LongShortFeed> {
  let error: string | null = null;
  if (!pendleCache || now - pendleCache.at >= PENDLE_TTL_MS) {
    try {
      const boxes = await fetchJson<Box[]>('PendleLoop', `${protocols.pendle.apiBase}/v1/pt-looping/loop/boxes?includeLongShort=true`, isArrayOf<Box>);
      const rows = boxes.map(longShortRow).filter((r): r is LongShortRow => r !== null);
      pendleCache = { at: now, rows, fetchedAt: new Date(now).toISOString() };
    } catch (e) {
      error = e instanceof Error ? e.message : 'unknown error';
      if (!pendleCache) return { rows: [], fetchedAt: new Date(now).toISOString(), error, perpError: null };
    }
  }
  let perpError: string | null = null;
  const coins = [...new Set(pendleCache.rows.map((r) => perpCoinOf(r.base.symbol, r.category)).filter((c): c is string => c !== null))];
  if (!perpCache || now - perpCache.at >= PERP_TTL_MS) {
    try {
      perpCache = { at: now, perps: await fetchPerps(coins, now) };
    } catch (e) {
      perpError = e instanceof Error ? e.message : 'unknown error';
    }
  }
  const perps = perpCache?.perps ?? new Map<string, PerpRef>();
  const rows = pendleCache.rows.map((r) => {
    const coin = perpCoinOf(r.base.symbol, r.category);
    return { ...r, perp: (coin && perps.get(coin)) || null };
  });
  return { rows, fetchedAt: pendleCache.fetchedAt, error, perpError };
}
