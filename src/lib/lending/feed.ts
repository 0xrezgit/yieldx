import type { Opportunity } from '../../types/opportunity';
import { fetchAave, normalizeAave } from './aave';
import { fetchMidnight } from './midnight';
import { fetchMorpho, normalizeMorpho } from './morpho';
import type { LendingFeed, SourceStatus } from './types';

/**
 * Server-side aggregation of the lending and vault sources. Each source is fetched,
 * normalised and cached on its own: one failing never hides the others, and a
 * failed refresh serves that source's last good copy, flagged stale.
 *
 * Fixed queries only — the browser cannot choose what is asked upstream.
 */

const CACHE_MS = 60_000;

interface Source {
  id: string;
  name: string;
  load: (fetchedAt: string) => Promise<Opportunity[]>;
}

const SOURCES: Source[] = [
  { id: 'morpho', name: 'Morpho', load: async (at) => normalizeMorpho(await fetchMorpho(), at) },
  { id: 'aave', name: 'Aave V4', load: async (at) => normalizeAave(await fetchAave(), at) },
  { id: 'midnight', name: 'Morpho Midnight', load: (at) => fetchMidnight(at, new Date(at).getTime()) },
];

interface Cached {
  list: Opportunity[];
  fetchedAt: string;
  at: number;
}

const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<Cached>>();

async function refresh(s: Source, now: number): Promise<Cached> {
  const running = inFlight.get(s.id);
  if (running) return running;
  const p = (async () => {
    const fetchedAt = new Date(now).toISOString();
    const list = await s.load(fetchedAt);
    const c = { list, fetchedAt, at: now };
    cache.set(s.id, c);
    return c;
  })().finally(() => inFlight.delete(s.id));
  inFlight.set(s.id, p);
  return p;
}

async function one(s: Source, now: number): Promise<{ list: Opportunity[]; status: SourceStatus }> {
  const hit = cache.get(s.id);
  if (hit && now - hit.at < CACHE_MS) return { list: hit.list, status: { id: s.id, name: s.name, state: 'ok', fetchedAt: hit.fetchedAt, count: hit.list.length, error: null } };
  try {
    const c = await refresh(s, now);
    return { list: c.list, status: { id: s.id, name: s.name, state: 'ok', fetchedAt: c.fetchedAt, count: c.list.length, error: null } };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'unknown error';
    if (hit) {
      const list = hit.list.map((o) => ({ ...o, quality: o.quality === 'insufficient' ? o.quality : ('stale' as const) }));
      return { list, status: { id: s.id, name: s.name, state: 'stale', fetchedAt: hit.fetchedAt, count: list.length, error } };
    }
    return { list: [], status: { id: s.id, name: s.name, state: 'error', fetchedAt: null, count: 0, error } };
  }
}

export async function getLendingFeed(now = Date.now()): Promise<LendingFeed> {
  const results = await Promise.all(SOURCES.map((s) => one(s, now)));
  return {
    opportunities: results.flatMap((r) => r.list),
    sources: results.map((r) => r.status),
    fetchedAt: new Date(now).toISOString(),
  };
}

/** Test hook: forget cached sources. */
export function resetLendingCache() {
  cache.clear();
  inFlight.clear();
}
