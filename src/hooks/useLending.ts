'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LendingFeed } from '../lib/lending/types';

const REFRESH_MS = 60_000;

export interface LendingState {
  feed: LendingFeed | null;
  loading: boolean;
  refreshing: boolean;
  /** Showing the last good copy after a failed refresh. */
  stale: boolean;
  /** No data at all. */
  failed: boolean;
  refresh: () => void;
}

/** Lending and vault opportunities from the server proxy, refreshed every minute and on focus. */
export function useLending(): LendingState {
  const [feed, setFeed] = useState<LendingFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch('/api/lending', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setFeed((await res.json()) as LendingFeed);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [load]);

  return { feed, loading: loading && !feed, refreshing, stale: error && !!feed, failed: error && !feed, refresh: load };
}
