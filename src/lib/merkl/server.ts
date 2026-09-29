import 'server-only';
import { normalizeOpportunity, type RawOpportunity } from './normalize';
import type { MerklFeed, MerklOpportunity } from './types';

/**
 * Server-side Merkl client. The API key (MERKL_API_KEY, set in the Vercel project
 * settings — never NEXT_PUBLIC_) is read only here and sent as `X-API-Key`. The
 * public endpoints also work without it, at the default rate limit.
 *
 * Quota: the browser never reaches Merkl directly and can't choose the query. One
 * fixed request set (count + ~9 pages) is cached for REVALIDATE_S in Next's data
 * cache, so any number of visitors costs one upstream refresh per window.
 */

const API = 'https://api.merkl.xyz/v4';
const REVALIDATE_S = 300;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const TIMEOUT_MS = 20_000;

export class MerklUpstreamError extends Error {}

function headers(): HeadersInit {
  const key = process.env.MERKL_API_KEY?.trim();
  return key ? { accept: 'application/json', 'X-API-Key': key } : { accept: 'application/json' };
}

async function get<T>(path: string): Promise<{ body: T; date: number | null }> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: headers(),
      next: { revalidate: REVALIDATE_S, tags: ['merkl'] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
  } catch {
    throw new MerklUpstreamError('Merkl API unreachable');
  }
  // The status only, never the request: headers carry the key.
  if (!res.ok) throw new MerklUpstreamError(`Merkl API responded with ${res.status}`);
  const date = Date.parse(res.headers.get('date') ?? '');
  return { body: (await res.json()) as T, date: Number.isFinite(date) ? date : null };
}

async function fetchLive(): Promise<{ opportunities: MerklOpportunity[]; fetchedAt: number }> {
  const { body: count } = await get<number>('/opportunities/count?status=LIVE');
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil((Number(count) || 0) / PAGE_SIZE)));
  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) => get<RawOpportunity[]>(`/opportunities?status=LIVE&items=${PAGE_SIZE}&page=${p}&campaigns=true`)),
  );
  const now = Date.now() / 1000;
  const seen = new Set<string>();
  const opportunities: MerklOpportunity[] = [];
  for (const { body } of results) {
    for (const raw of Array.isArray(body) ? body : []) {
      const o = normalizeOpportunity(raw, now);
      // Pages can shift while being read; keep the first copy.
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        opportunities.push(o);
      }
    }
  }
  const dates = results.map((r) => r.date).filter((d): d is number => d !== null);
  // The oldest page decides how fresh the whole list is (cached pages keep their original Date).
  return { opportunities, fetchedAt: dates.length ? Math.min(...dates) : Date.now() };
}

/** Last good list in this server instance: served, flagged stale, when a refresh fails. */
let lastGood: { opportunities: MerklOpportunity[]; fetchedAt: number } | null = null;

export async function getMerklFeed(): Promise<MerklFeed> {
  try {
    const fresh = await fetchLive();
    if (!fresh.opportunities.length && lastGood) return { ...lastGood, stale: true };
    lastGood = fresh;
    return { ...fresh, stale: false };
  } catch (error) {
    if (lastGood) return { ...lastGood, stale: true };
    throw error;
  }
}
