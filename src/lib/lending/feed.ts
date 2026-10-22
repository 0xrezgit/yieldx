import type { Opportunity } from '../../types/opportunity';
import { fetchAave, fetchAaveHistory, normalizeAave } from './aave';
import { withHistory, type HistoryLoader } from './history';
import { fetchFluid } from './fluid';
import { fetchKamino, fetchKaminoHistory } from './kamino';
import { fetchLoopscale } from './loopscale';
import { fetchMidnight } from './midnight';
import { fetchMorpho, fetchMorphoHistory, morphoHistoryAdjust, normalizeMorpho } from './morpho';
import { fetchRevert } from './revert';
import { fetchPendleLoops, markPendleLoops } from './pendle-loop';
import type { LendingFeed, SourceStatus } from './types';

/**
 * Server-side aggregation of the lending and vault sources. Each source is fetched,
 * normalised and cached on its own: one failing never hides the others, and a
 * failed refresh serves that source's last good copy, flagged stale.
 *
 * Fixed queries only — the browser cannot choose what is asked upstream.
 */

/** A failed refresh keeps serving the last good copy as-is for this long; after it, the copy is stale. */
export const GRACE_MS = 15 * 60_000;

interface Source {
  id: string;
  name: string;
  /** How long a good copy is served before asking upstream again (per source: limits and cost differ). */
  ttlMs: number;
  load: (fetchedAt: string) => Promise<Opportunity[]>;
  /**
   * Once cached, refresh in the background instead of making the feed wait (every source
   * now: one slow or timing-out API — Morpho's took 15 s — held the whole answer).
   */
  background?: boolean;
  /** Daily rate history for the robust rate (robust-rate.ts), attached each time the list is served. */
  history?: { load: HistoryLoader; adjust?: (o: Opportunity, pct: number) => number };
}

export const SOURCES: Source[] = [
  // Variable rates with a daily history get the robust rate (robust-rate.ts), filled in the background.
  { id: 'morpho', name: 'Morpho', ttlMs: 60_000, load: async (at) => normalizeMorpho(await fetchMorpho(), at), background: true, history: { load: () => fetchMorphoHistory(), adjust: morphoHistoryAdjust } },
  { id: 'aave', name: 'Aave V4', ttlMs: 60_000, load: async (at) => normalizeAave(await fetchAave(), at), background: true, history: { load: fetchAaveHistory } },
  // Order books: several requests per market.
  { id: 'midnight', name: 'Morpho Midnight', ttlMs: 2 * 60_000, load: (at) => fetchMidnight(at, new Date(at).getTime()), background: true },
  // Two requests per Kamino market (every market, ~50): refreshed behind the cached copy.
  { id: 'kamino', name: 'Kamino', ttlMs: 5 * 60_000, load: (at) => fetchKamino(at), background: true, history: { load: fetchKaminoHistory } },
  // Fluid: fTokens and every vault type (two requests per network).
  { id: 'fluid', name: 'Fluid', ttlMs: 2 * 60_000, load: (at) => fetchFluid(at), background: true },
  { id: 'loopscale', name: 'Loopscale', ttlMs: 5 * 60_000, load: (at) => fetchLoopscale(at), background: true },
  // Daily rate from Revert's API, vault state read on-chain (two RPC batches per vault).
  { id: 'revert', name: 'Revert Lend', ttlMs: 60_000, load: (at) => fetchRevert(at), background: true },
  // PendleLoop's list: lenders only for the money markets without a source of their own (Aave V3, Euler);
  // Morpho's markets that it lists are marked with its page (markPendleLoops, when served).
  { id: 'pendle-loop', name: 'PendleLoop', ttlMs: 2 * 60_000, load: (at) => fetchPendleLoops(at), background: true },
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
  if (hit && now - hit.at < s.ttlMs) return { list: hit.list, status: { id: s.id, name: s.name, state: 'ok', fetchedAt: hit.fetchedAt, count: hit.list.length, error: null } };
  // Past its TTL but recent: serve the copy now and refresh behind it, so one slow source
  // (Midnight pages through hundreds of books) never holds up the whole feed.
  if (hit && s.background && now - hit.at < GRACE_MS) {
    void refresh(s, now).catch(() => {});
    return { list: hit.list, status: { id: s.id, name: s.name, state: 'ok', fetchedAt: hit.fetchedAt, count: hit.list.length, error: null } };
  }
  try {
    const c = await refresh(s, now);
    return { list: c.list, status: { id: s.id, name: s.name, state: 'ok', fetchedAt: c.fetchedAt, count: c.list.length, error: null } };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'unknown error';
    if (hit && now - hit.at < GRACE_MS) {
      // One failed refresh does not make minutes-old rates stale; the fetch time stays visible.
      return { list: hit.list, status: { id: s.id, name: s.name, state: 'ok', fetchedAt: hit.fetchedAt, count: hit.list.length, error } };
    }
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
    opportunities: results.flatMap((r, i) => {
      const h = SOURCES[i].history;
      const list = SOURCES[i].id === 'morpho' ? markPendleLoops(r.list) : r.list;
      return h ? withHistory(SOURCES[i].id, list, h.load, h.adjust, now) : list;
    }),
    sources: results.map((r) => r.status),
    fetchedAt: new Date(now).toISOString(),
  };
}

/** Test hook: forget cached sources. */
export function resetLendingCache() {
  cache.clear();
  inFlight.clear();
}
