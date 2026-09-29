'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MerklFeed, MerklOpportunity } from '../lib/merkl/types';

const REFRESH_MS = 5 * 60_000;

export interface MerklState {
  opportunities: MerklOpportunity[];
  loading: boolean;
  /** When Merkl's data was received by the server (ms); null before the first load. */
  fetchedAt: number | null;
  /** Showing the last good list after a failed refresh (here or on the server). */
  stale: boolean;
  /** No data at all. */
  failed: boolean;
  refresh: () => void;
}

/** Live Merkl opportunities from the server proxy; the last good list survives a failed refresh. */
export function useMerkl(): MerklState {
  const [feed, setFeed] = useState<MerklFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/merkl/opportunities');
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as MerklFeed;
      setFeed(body);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return {
    opportunities: feed?.opportunities ?? [],
    loading: loading && !feed,
    fetchedAt: feed?.fetchedAt ?? null,
    stale: (feed?.stale ?? false) || (error && !!feed),
    failed: error && !feed,
    refresh: load,
  };
}
