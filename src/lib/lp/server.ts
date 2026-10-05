import 'server-only';
import config from '../../config/lp-pools.json';
import { vetPools, type LpPoolFeed, type RawItem } from './pools';

/**
 * Server-side vfat client (public data API, no key). Two fixed queries: the focus
 * chain (Robinhood Chain) by TVL, and every chain by last week's fees. Each is held
 * in Next's data cache for `revalidateS`, so visitors never reach vfat directly and
 * its rate limit is spent once per window. One query failing keeps the other.
 */

const CFG = config.vfat;
const TIMEOUT_MS = 20_000;

export class LpUpstreamError extends Error {}

async function page(query: string): Promise<RawItem[]> {
  const res = await fetch(`${CFG.api}?${query}`, {
    headers: { accept: 'application/json' },
    next: { revalidate: CFG.revalidateS, tags: ['vfat'] },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  } as RequestInit);
  if (!res.ok) throw new LpUpstreamError(`vfat responded with ${res.status}`);
  const body = (await res.json()) as { items?: unknown };
  return Array.isArray(body.items) ? (body.items as RawItem[]) : [];
}

export async function getLpPools(now = Date.now()): Promise<LpPoolFeed> {
  const queries = {
    focus: `chainId=${CFG.focusChainId}&pageSize=${CFG.pageSize}&sortKey=tvl&sortDirection=desc`,
    global: `pageSize=${CFG.pageSize}&sortKey=feesUsd7d&sortDirection=desc`,
  } as const;
  const ids = Object.keys(queries) as (keyof typeof queries)[];
  const results = await Promise.allSettled(ids.map((id) => page(queries[id])));
  if (results.every((r) => r.status === 'rejected')) throw new LpUpstreamError('vfat unreachable');
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return {
    ...vetPools(items, now),
    sources: ids.map((id, i) => ({ id, ok: results[i].status === 'fulfilled' })),
    fetchedAt: new Date(now).toISOString(),
  };
}
