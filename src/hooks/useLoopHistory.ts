'use client';

import { useEffect, useState } from 'react';
import type { LoopHistoryFeed } from '../lib/pendleloop/types';

const TTL_MS = 15 * 60_000;
/** One request per collateral for the whole page, however many rows show it. */
const cache = new Map<string, { at: number; job: Promise<LoopHistoryFeed> }>();

function load(chainId: number, pt: string): Promise<LoopHistoryFeed> {
  const key = `${chainId}:${pt.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.job;
  const job = fetch(`/api/pendleloop/history?chain=${chainId}&pt=${pt}`).then((r) => (r.ok ? (r.json() as Promise<LoopHistoryFeed>) : Promise.reject(new Error(String(r.status)))));
  cache.set(key, { at: Date.now(), job });
  job.catch(() => cache.delete(key));
  return job;
}

/** The hourly history of every PendleLoop box of one collateral (see /api/pendleloop/history). */
export function useLoopHistory(chainId: number | null, pt: string | null) {
  const [state, setState] = useState<{ key: string; feed: LoopHistoryFeed | null; failed: boolean } | null>(null);
  const key = chainId && pt ? `${chainId}:${pt.toLowerCase()}` : null;
  useEffect(() => {
    if (!key) return;
    let live = true;
    load(chainId!, pt!)
      .then((feed) => live && setState({ key, feed, failed: false }))
      .catch(() => live && setState({ key, feed: null, failed: true }));
    return () => {
      live = false;
    };
  }, [key, chainId, pt]);
  const mine = state && state.key === key ? state : null;
  return { feed: mine?.feed ?? null, loading: !!key && !mine, failed: mine?.failed ?? false };
}
