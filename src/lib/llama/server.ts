import 'server-only';
import { toPool, type RawPool, type RawProtocol, type YieldPool } from './yields';

/**
 * Server-side DefiLlama Yields client (free API, no key): the candidate list for
 * YieldX's own on-chain verification (`verify-server.ts`).
 *
 * The pool list is ~11 MB — over Next's 2 MB data-cache limit — so it is fetched
 * without the data cache and kept here, joined with the protocol list (name,
 * category, audits), for `POOLS_TTL_MS`. A failed refresh keeps the last good list
 * and says so (`stale`). Pools under `MIN_TVL` are dropped (DefiLlama's own default).
 */

const YIELDS = 'https://yields.llama.fi';
const PROTOCOLS = 'https://api.llama.fi/protocols';
const TIMEOUT_MS = 30_000;
/** DefiLlama recomputes pools hourly. */
const POOLS_TTL_MS = 10 * 60_000;
const PROTOCOLS_TTL_MS = 6 * 3_600_000;
export const MIN_TVL = 10_000;

export class LlamaUpstreamError extends Error {}

export async function getJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  if (!res.ok) throw new LlamaUpstreamError(`DefiLlama responded with ${res.status}`);
  return (await res.json()) as T;
}

let protocols: { at: number; value: Map<string, RawProtocol> } | null = null;

async function protocolMap(now: number): Promise<Map<string, RawProtocol>> {
  if (protocols && now - protocols.at < PROTOCOLS_TTL_MS) return protocols.value;
  try {
    const list = await getJson<RawProtocol[]>(PROTOCOLS, { cache: 'no-store' });
    const value = new Map<string, RawProtocol>();
    for (const p of Array.isArray(list) ? list : []) if (p.slug) value.set(p.slug, { slug: p.slug, name: p.name, category: p.category, audits: p.audits });
    protocols = { at: now, value };
    return value;
  } catch {
    // Without names and audits the list is still useful; the audited presets come out empty.
    return protocols?.value ?? new Map();
  }
}

let pools: { at: number; value: YieldPool[] } | null = null;
let loading: Promise<void> | null = null;
let lastFailedAt = 0;
/** After a failure, the large list is asked again only after this long. */
const RETRY_MS = 60_000;

async function load(now: number): Promise<void> {
  const [body, protos] = await Promise.all([getJson<{ data?: RawPool[] }>(`${YIELDS}/pools`, { cache: 'no-store' }), protocolMap(now)]);
  const value = (Array.isArray(body.data) ? body.data : [])
    .filter((p) => p.tvlUsd >= MIN_TVL)
    .map((p) => toPool(p, protos))
    .filter((p): p is YieldPool => p !== null);
  if (!value.length) throw new LlamaUpstreamError('DefiLlama returned no pools');
  pools = { at: now, value };
}

/**
 * The joined pool list. An older list answers at once while a refresh runs (`refresh`,
 * which the route keeps alive after answering); only the very first load is waited for.
 */
export async function allPools(now = Date.now()): Promise<{ pools: YieldPool[]; fetchedAt: number; stale: boolean; refresh: Promise<void> | null }> {
  const fresh = !!pools && now - pools.at < POOLS_TTL_MS;
  let refresh: Promise<void> | null = null;
  if (!fresh && !loading && now - lastFailedAt > RETRY_MS) {
    refresh = loading = load(now)
      .catch(() => {
        lastFailedAt = Date.now();
      })
      .finally(() => {
        loading = null;
      });
  }
  if (!pools && loading) await loading;
  if (!pools) throw new LlamaUpstreamError('DefiLlama unreachable');
  return { pools: pools.value, fetchedAt: pools.at, stale: Date.now() - pools.at >= POOLS_TTL_MS, refresh };
}
