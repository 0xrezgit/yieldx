'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MerklFeed } from '../lib/merkl/types';

/** Server data refreshes every minute; asking more often returns the same copy. */
const REFRESH_MS = 60_000;
/** Clock tick: campaigns that end between refreshes disappear on time. */
const TICK_MS = 15_000;

export interface MerklState {
  feed: MerklFeed | null;
  loading: boolean;
  /** Refresh in flight (the list stays on screen). */
  refreshing: boolean;
  /** Showing the last good list after a failed refresh (here or on the server). */
  stale: boolean;
  /** No data at all. */
  failed: boolean;
  /** Current time in seconds, ticking. */
  now: number;
  refresh: () => void;
}

/** Live Merkl feed from the server proxy; refreshed every minute and on focus, the last good copy survives a failure. */
export function useMerkl(): MerklState {
  const [feed, setFeed] = useState<MerklFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch('/api/merkl/opportunities', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as MerklFeed;
      setFeed(body);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
      setNow(Date.now() / 1000);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);
    return () => {
      clearInterval(timer);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [load]);

  return {
    feed,
    loading: loading && !feed,
    refreshing,
    stale: (feed?.stale ?? false) || (error && !!feed),
    failed: error && !feed,
    now,
    refresh: load,
  };
}
