import 'server-only';
import config from '../../config/lp-pools.json';
import { mapLimit } from '../protocols/base';
import { FEE_WINDOW_DAYS, historyCandidates, UNSTAKED_FEE_VENUES, vetPools, type LpPool, type LpPoolFeed, type PoolFeeData, type RawHistory, type RawItem } from './pools';
import { realLpStats, type RawRevertPosition, type RealLpStats } from './revert';

/**
 * Server-side vfat client (public data API, no key). Three fixed list queries: the
 * focus chain (Robinhood Chain) by TVL, every chain by last week's fees, and Aero's
 * pools by TVL (new since 2026-10-22: most have no week of fees yet, so the fee
 * list misses them). Then the daily history of each concentrated pool that passed
 * every other rule, for its fee rate per unit of liquidity, and for Aero gauges
 * the staked liquidity in range, read on-chain, for the AERO rate.
 *
 * History is slow upstream (~2 s a pool) and changes daily, so it is kept here per
 * pool and filled in the background: a request waits a few seconds at most, and a
 * pool whose history is not in yet is reported as pending — never shown without it.
 * Lists are cached for `revalidateS`. One list failing keeps the other.
 */

const CFG = config.vfat;
const API = 'https://api.vfat.io/v4';
const TIMEOUT_MS = 20_000;
/** vfat rate-limits bursts; two at a time stays under it. */
const HISTORY_CONCURRENCY = 2;
/** How long a request waits for missing history before answering with what is ready. */
const WAIT_MS = 6_000;
/** A failed history is asked again after this long. */
const RETRY_MS = 10 * 60_000;
/** An Aero gauge's staked liquidity moves with every deposit; read again after this long. */
const STAKED_REVALIDATE_S = 600;

export class LpUpstreamError extends Error {}

/** revalidate null: not kept in Next's data cache (per-pool reads, already kept in memory here). */
async function get<T>(path: string, revalidate: number | null): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { accept: 'application/json' },
      ...(revalidate === null ? { cache: 'no-store' } : { next: { revalidate, tags: ['vfat'] } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
    // vfat rate-limits bursts with 429 + Retry-After (seconds).
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(5, Number(res.headers.get('retry-after')) || 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new LpUpstreamError(`vfat responded with ${res.status}`);
    return (await res.json()) as T;
  }
}

async function list(query: string): Promise<RawItem[]> {
  const body = await get<{ items?: unknown }>(`/yield-opportunities?${query}`, CFG.revalidateS);
  return Array.isArray(body.items) ? (body.items as RawItem[]) : [];
}

const histories = new Map<string, { at: number; value: PoolFeeData | null }>();
const inFlight = new Set<string>();

const fresh = (id: string, now: number) => {
  const h = histories.get(id);
  if (!h) return false;
  // An Aero gauge's staked liquidity changes with every deposit: its data is kept for minutes, not hours.
  const keep = !h.value?.history ? RETRY_MS : h.value.stakedLiquidity !== undefined ? STAKED_REVALIDATE_S * 1000 : CFG.historyRevalidateS * 1000;
  return now - h.at < keep;
};

const UNSTAKED_FEE = '0xb64cc67b'; // unstakedFee() — hundredths of a basis point (50000 = 5%)
const STAKED_LIQUIDITY = '0x3ab04b20'; // stakedLiquidity() — staked liquidity in range, raw units
const RPC = config.rpc as Record<string, string>;

/** One uint256 view of the pool; null when it cannot be read. */
async function readPool(it: RawItem, selector: string): Promise<bigint | null> {
  const rpc = RPC[String(it.chainId)];
  const pool = it.pool?.address;
  if (!rpc || !pool) return null;
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: pool, data: selector }, 'latest'] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
    const body = (await res.json()) as { result?: string };
    if (!body.result || body.result === '0x') return null;
    return BigInt(body.result);
  } catch {
    return null;
  }
}

/** Aerodrome Slipstream and Aero: the share of an unstaked LP's fees the pool keeps. */
const unstakedFee = async (it: RawItem) => {
  const v = await readPool(it, UNSTAKED_FEE);
  return v === null ? null : Number(v) / 1e6;
};

/** Aero gauge: the staked liquidity in range now (decimal string). */
const stakedLiquidity = async (it: RawItem) => (await readPool(it, STAKED_LIQUIDITY))?.toString() ?? null;

const hasAeroGauge = (it: RawItem) => it.pool?.type === 'concentrated' && (it.options ?? []).some((o) => o.kind === 'lp-stake' && !o.isKilled && o.protocol?.id === config.aero.venue);

/** Fetches the missing fee data (each pool once at a time); resolves when all are in. */
function fill(items: RawItem[]): Promise<unknown> {
  const todo = items.filter((it) => !inFlight.has(it.id as string));
  todo.forEach((it) => inFlight.add(it.id as string));
  return mapLimit(todo, HISTORY_CONCURRENCY, async (it) => {
    const id = it.id as string;
    const needsCut = (it.options ?? []).some((o) => o.kind === 'lp' && o.protocol?.id && UNSTAKED_FEE_VENUES.has(o.protocol.id));
    const needsStaked = hasAeroGauge(it);
    let value: PoolFeeData | null = null;
    try {
      const [history, cut, staked] = await Promise.all([
        get<RawHistory>(`/pool-history?id=${encodeURIComponent(id)}&limit=${FEE_WINDOW_DAYS}`, null),
        needsCut ? unstakedFee(it) : Promise.resolve(undefined),
        needsStaked ? stakedLiquidity(it) : Promise.resolve(undefined),
      ]);
      value = { history, ...(needsCut ? { unstakedFee: cut } : {}), ...(needsStaked ? { stakedLiquidity: staked } : {}) };
    } catch {
      value = null;
    }
    histories.set(id, { at: Date.now(), value });
    inFlight.delete(id);
  });
}

/** The feed, and the history still being fetched (the route keeps it running after answering). */
// ─── Real LPs (Revert) ──────────────────────────────────────────────────────
// Supplementary: a pool is shown without them; they appear once fetched.

const REVERT_API = 'https://api.revert.finance/v1';
const realLps = new Map<string, { at: number; value: RealLpStats | null }>();
const realInFlight = new Set<string>();

async function fetchRealLps(p: LpPool): Promise<void> {
  const r = p.revert!;
  let value: RealLpStats | null = null;
  try {
    // The 100 largest positions: the pool's real money, and one request per pool.
    const q = `network=${encodeURIComponent(r.network)}&pool=${encodeURIComponent(r.pool)}&limit=100&sort=underlying_value&desc=true`;
    const res = await fetch(`${REVERT_API}/positions?${q}`, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) } as RequestInit);
    if (res.ok) {
      const body = (await res.json()) as { data?: RawRevertPosition[] };
      value = realLpStats(Array.isArray(body.data) ? body.data : [], r);
    }
  } catch {
    value = null;
  }
  realLps.set(p.id, { at: Date.now(), value });
  realInFlight.delete(p.id);
}

function fillRealLps(pools: LpPool[], now: number): Promise<unknown> | null {
  const todo = pools.filter((p) => p.revert && !realInFlight.has(p.id) && !(realLps.has(p.id) && now - realLps.get(p.id)!.at < CFG.historyRevalidateS * 1000));
  if (!todo.length) return null;
  todo.forEach((p) => realInFlight.add(p.id));
  return mapLimit(todo, HISTORY_CONCURRENCY, fetchRealLps);
}

export async function getLpPools(now = Date.now()): Promise<{ feed: LpPoolFeed; background: Promise<unknown> | null }> {
  const queries = {
    focus: `chainId=${CFG.focusChainId}&pageSize=${CFG.pageSize}&sortKey=tvl&sortDirection=desc`,
    global: `pageSize=${CFG.pageSize}&sortKey=feesUsd7d&sortDirection=desc`,
    aero: `protocols=${encodeURIComponent(config.aero.venue)}&pageSize=${CFG.pageSize}&sortKey=tvl&sortDirection=desc`,
  } as const;
  const ids = Object.keys(queries) as (keyof typeof queries)[];
  const results = await Promise.allSettled(ids.map((id) => list(queries[id])));
  if (results.every((r) => r.status === 'rejected')) throw new LpUpstreamError('vfat unreachable');
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const candidates = historyCandidates(items, now);
  const wanted = candidates.map((it) => it.id as string);
  const missing = candidates.filter((it) => !fresh(it.id as string, now));
  const background = missing.length ? fill(missing) : null;
  if (background) await Promise.race([background, new Promise((r) => setTimeout(r, WAIT_MS))]);

  // A pool asked for but not answered yet is pending, not rejected.
  const known = new Map<string, PoolFeeData | null>();
  let pending = 0;
  for (const id of wanted) {
    const h = histories.get(id);
    if (h) known.set(id, h.value);
    else pending++;
  }
  const vetted = vetPools(items, now, known);
  const { rejected } = vetted;
  rejected.history -= pending;
  const realFill = fillRealLps(vetted.pools, now);
  const pools = vetted.pools.map((p) => (realLps.has(p.id) ? { ...p, realLps: realLps.get(p.id)!.value } : p));

  return {
    feed: {
      pools,
      rejected,
      pending,
      realPending: pools.filter((p) => p.revert && p.realLps === undefined).length,
      sources: ids.map((id, i) => ({ id, ok: results[i].status === 'fulfilled' })),
      fetchedAt: new Date(now).toISOString(),
    },
    background: background || realFill ? Promise.all([background, realFill]) : null,
  };
}
