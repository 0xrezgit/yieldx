import 'server-only';
import lending from '../../config/lending.json';
import { fetchJson, isArrayOf, isObject, mapLimit, withRetry } from '../protocols/base';
import { fetchSolanaTokens } from '../protocols/jupiter';
import type { KaminoPair, KaminoStats } from '../lending/kamino';
import { realizedVol } from './model';
import type { MultiplyFeed, MultiplyRow } from './types';

/**
 * Kamino Multiply pairs that are a leveraged long: a volatile collateral (SOL, JLP,
 * cbBTC, HYPE, tokenised stocks…) against a dollar debt. Same routes as the lending
 * source (see lending/kamino.ts), plus each reserve's daily history for its USD price
 * (`assetPriceUSD`), from which the pair's volatility is measured.
 *
 * A pair is kept when its debt is a dollar (price within 3 % of $1, daily volatility
 * under 5 % a year) and its collateral moves (volatility of the price ratio ≥ 10 % a
 * year); dollar/dollar and LST/SOL pairs are loops, ranked elsewhere; PTs need their
 * own model. Pairs with a borrow factor are left out (not modelled); the flash-loan fee
 * is a cost on every swap the position makes.
 */

const CFG = lending.kamino;
const TTL_MS = 10 * 60_000;
const HISTORY_TTL_MS = 6 * 3_600_000;
const HISTORY_DAYS = 90;

interface Market {
  lendingMarket: string;
  name?: string;
}
interface Metric {
  reserve: string;
  liquidityToken?: string;
  liquidityTokenMint?: string;
  totalSupply?: string;
  totalSupplyUsd?: string;
}
type Stats = KaminoStats & { maxLiquidationBonus?: string; liquidationMaxDebtCloseFactorPct?: number };

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};

const isPairs = (b: unknown): b is { multiplyPairs: KaminoPair[] } => isObject(b) && Array.isArray((b as { multiplyPairs?: unknown }).multiplyPairs);

const histories = new Map<string, { at: number; prices: (number | null)[] }>();

/** Daily USD price of a reserve, last 90 days (cached for hours: one point a day). */
async function priceHistory(market: string, reserve: string, now: number): Promise<(number | null)[]> {
  const hit = histories.get(reserve);
  if (hit && now - hit.at < HISTORY_TTL_MS) return hit.prices;
  const start = new Date(now - HISTORY_DAYS * 86_400_000).toISOString();
  const end = new Date(now).toISOString();
  const body = await fetchJson<{ history?: { metrics?: { assetPriceUSD?: string | number } }[] }>(
    CFG.name,
    `${CFG.api}/kamino-market/${market}/reserves/${reserve}/metrics/history?env=mainnet-beta&start=${start}&end=${end}&frequency=day`,
    isObject,
  );
  const prices = (body.history ?? []).map((h) => num(h.metrics?.assetPriceUSD));
  histories.set(reserve, { at: now, prices });
  return prices;
}

/** Collateral ÷ debt, day by day (both series end today; aligned from the end). */
function ratioSeries(c: (number | null)[], d: (number | null)[]): number[] {
  const n = Math.min(c.length, d.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = c[c.length - n + i];
    const b = d[d.length - n + i];
    if (a !== null && b !== null && a > 0 && b > 0) out.push(a / b);
  }
  return out;
}

export async function fetchMultiply(now = Date.now()): Promise<MultiplyFeed> {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const [markets, pairsBody] = await Promise.all([
    withRetry(() => fetchJson<Market[]>(CFG.name, `${CFG.api}/v2/kamino-market`, isArrayOf<Market>)),
    withRetry(() => fetchJson<{ multiplyPairs: KaminoPair[] }>(CFG.name, `${CFG.api}/markets/multiply-pairs`, isPairs)),
  ]);
  const byMarket = new Map(markets.filter((m) => typeof m?.lendingMarket === 'string').map((m) => [m.lendingMarket, m]));
  const pairs = pairsBody.multiplyPairs.filter((p) => {
    if (!byMarket.has(p.lendingMarket)) return skip('بازار پنهان یا منسوخ'), false;
    if (num(p.borrowFactor) !== 1) return skip('ضریب وام (مدل نشده)'), false;
    const fee = num(p.flashLoanFee);
    if (fee === null || fee < 0 || fee > 0.01) return skip('کارمزد فلش‌لون نامعتبر'), false;
    return true;
  });
  const marketIds = [...new Set(pairs.map((p) => p.lendingMarket))];
  const reads = await mapLimit(marketIds, CFG.concurrency, async (m) => {
    const [metrics, stats] = await Promise.all([
      withRetry(() => fetchJson<Metric[]>(CFG.name, `${CFG.api}/kamino-market/${m}/reserves/metrics`, isArrayOf<Metric>)),
      withRetry(() => fetchJson<Record<string, Stats>>(CFG.name, `${CFG.api}/reserves/batch/stats?market=${m}`, isObject)),
    ]);
    return { m, metrics: new Map(metrics.map((x) => [x.reserve, x])), stats };
  });
  const data = new Map(reads.flatMap((r) => (r.status === 'fulfilled' ? [[r.value.m, r.value] as const] : [])));
  if (marketIds.length && !data.size) throw (reads[0] as PromiseRejectedResult).reason;

  const priceOf = (x: Metric | undefined) => {
    const u = num(x?.totalSupplyUsd);
    const t = num(x?.totalSupply);
    return u !== null && t !== null && t > 0 && u > 0 ? u / t : null;
  };

  // First pass on today's data; the histories are fetched only for what is left.
  const candidates: { p: KaminoPair; market: Market; cm: Metric; dm: Metric; cs: Stats; ds: Stats; cPrice: number; dPrice: number }[] = [];
  for (const p of pairs) {
    const d = data.get(p.lendingMarket);
    const cm = d?.metrics.get(p.collateralReserve);
    const dm = d?.metrics.get(p.borrowReserve);
    const cs = d?.stats[p.collateralReserve];
    const ds = d?.stats[p.borrowReserve];
    if (!d || !cm || !dm || !cs || !ds || !cm.liquidityTokenMint || !dm.liquidityTokenMint) {
      skip('داده‌ی ذخیره نیامد');
      continue;
    }
    if ((cs.status && cs.status !== 'Active') || (ds.status && ds.status !== 'Active')) {
      skip('ذخیره‌ی غیرفعال');
      continue;
    }
    const cPrice = priceOf(cm);
    const dPrice = priceOf(dm);
    if (cPrice === null || dPrice === null) {
      skip('قیمت گزارش نشده');
      continue;
    }
    if (Math.abs(dPrice - 1) > 0.03) {
      skip('وام غیر دلاری (لوپ هم‌حرکت)');
      continue;
    }
    if (/^PT-/i.test(cm.liquidityToken ?? '')) {
      skip('PT (مدل جدا)');
      continue;
    }
    candidates.push({ p, market: byMarket.get(p.lendingMarket)!, cm, dm, cs, ds, cPrice, dPrice });
  }

  const vols = await mapLimit(candidates, CFG.concurrency, async (c) => {
    const [ch, dh] = await Promise.all([priceHistory(c.p.lendingMarket, c.p.collateralReserve, now), priceHistory(c.p.lendingMarket, c.p.borrowReserve, now)]);
    return { ratio: ratioSeries(ch, dh), debtVol: realizedVol(dh.filter((x): x is number => x !== null)) };
  });
  const tokens = await fetchSolanaTokens([...new Set(candidates.flatMap((c) => [c.cm.liquidityTokenMint as string, c.dm.liquidityTokenMint as string]))]).catch(() => new Map());

  const rows: MultiplyRow[] = [];
  candidates.forEach((c, i) => {
    const v = vols[i];
    if (v.status !== 'fulfilled') return void skip('تاریخچه‌ی قیمت نیامد');
    const vol = realizedVol(v.value.ratio);
    if (vol === null) return void skip('تاریخچه‌ی قیمت کوتاه');
    if (v.value.debtVol !== null && v.value.debtVol >= 5) return void skip('وام غیر دلاری (لوپ هم‌حرکت)');
    if (vol < 10) return void skip('وثیقه‌ی کم‌نوسان (لوپ هم‌حرکت)');
    const liqLtv = num(c.p.liquidationLtv);
    const maxLtv = num(c.p.maxLtv);
    const borrow = num(c.ds.borrowApyBreakdown?.borrow);
    if (liqLtv === null || maxLtv === null || borrow === null || !(liqLtv > 0 && liqLtv < 1) || !(maxLtv > 0) || borrow < 0) return void skip('حد وثیقه یا نرخ وام نامعتبر');
    const avg7d = num(c.ds.borrowApy?.avg7d);
    const own = Math.max(0, num(c.cs.underlyingApy?.current) ?? 0);
    const supply = Math.max(0, num(c.cs.supplyApyBreakdown?.lending) ?? 0);
    const available = [num(c.ds.actualAvailableLiquidityUsd), num(c.ds.liquidityAvailableUsd)].filter((x): x is number => x !== null && x >= 0);
    const borrowNowPct = borrow * 100;
    const borrow7dPct = avg7d === null ? null : avg7d * 100;
    const cMint = c.cm.liquidityTokenMint as string;
    const dMint = c.dm.liquidityTokenMint as string;
    rows.push({
      key: `kamino:${c.p.lendingMarket}:${c.p.collateralReserve}:${c.p.borrowReserve}`,
      market: { address: c.p.lendingMarket, name: c.market.name ?? 'Kamino' },
      collateral: { symbol: c.cm.liquidityToken ?? '—', mint: cMint, priceUsd: c.cPrice, icon: tokens.get(cMint)?.icon ?? null },
      debt: { symbol: c.dm.liquidityToken ?? '—', mint: dMint, priceUsd: c.dPrice, icon: tokens.get(dMint)?.icon ?? null },
      elevationGroup: c.p.elevationGroup ?? 0,
      collateralYieldPct: (own + supply) * 100,
      ownYieldPct: own * 100,
      supplyPct: supply * 100,
      borrowPct: Math.max(borrowNowPct, borrow7dPct ?? -Infinity),
      borrowNowPct,
      borrow7dPct,
      liqLtv,
      maxLtv: Math.min(maxLtv, liqLtv),
      liqBonus: Math.min(0.5, Math.max(0, num(c.cs.maxLiquidationBonus) ?? 0.05)),
      closeFactor: Math.min(1, Math.max(0.05, (num(c.cs.liquidationMaxDebtCloseFactorPct) ?? 20) / 100)),
      volPct: vol,
      flashFee: num(c.p.flashLoanFee) ?? 0,
      volDays: v.value.ratio.length,
      history: v.value.ratio,
      availableUsd: available.length ? Math.min(...available) : null,
      depositUsd: num(c.cm.totalSupplyUsd),
      url: `https://kamino.com/borrow?marketsFilter=${c.p.lendingMarket}`,
    });
  });
  rows.sort((a, b) => (b.depositUsd ?? 0) - (a.depositUsd ?? 0));
  return { rows, skipped, fetchedAt: new Date(now).toISOString(), error: null };
}

let cache: { at: number; feed: MultiplyFeed } | null = null;
let inFlight: Promise<MultiplyFeed> | null = null;

/** Cached for minutes; a failed refresh serves the last good copy with the error. */
export async function getMultiplyFeed(now = Date.now()): Promise<MultiplyFeed> {
  if (cache && now - cache.at < TTL_MS) return cache.feed;
  inFlight ??= fetchMultiply(now).finally(() => (inFlight = null));
  try {
    const feed = await inFlight;
    cache = { at: now, feed };
    return feed;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'unknown error';
    if (cache) return { ...cache.feed, error };
    return { rows: [], skipped: {}, fetchedAt: new Date(now).toISOString(), error };
  }
}
