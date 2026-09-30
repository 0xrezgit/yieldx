'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProtocolId } from '../types/protocol';
import { fetchMarketsShared } from '../lib/data/market-data';
import type { OpportunityListing } from '../lib/risk/opportunities';
import protocols from '../config/protocols.json';

const REFRESH_MS = 5 * 60_000;
const IDS = (Object.keys(protocols) as ProtocolId[]).filter((id) => protocols[id].liveData);

export interface ProtocolFeed {
  /** When this protocol's list was received (ms); null when never. */
  at: number | null;
  /** Last refresh failed; rows (if any) are the last good list. */
  stale: boolean;
  /** No data at all. */
  failed: boolean;
}

/**
 * Live market lists of every protocol, merged. Each protocol loads independently:
 * one failing API never empties the page — its last good rows stay, marked stale.
 */
export function useAllMarkets() {
  const [byProtocol, setByProtocol] = useState<Partial<Record<ProtocolId, OpportunityListing[]>>>({});
  const [feeds, setFeeds] = useState<Partial<Record<ProtocolId, ProtocolFeed>>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (force: boolean) => {
    await Promise.all(
      IDS.map(async (id) => {
        try {
          const r = await fetchMarketsShared(id, { force });
          setByProtocol((b) => ({ ...b, [id]: r.markets.map((m) => ({ ...m, protocol: id })) }));
          setFeeds((f) => ({ ...f, [id]: { at: r.at, stale: r.stale, failed: false } }));
        } catch {
          setFeeds((f) => ({ ...f, [id]: { at: f[id]?.at ?? null, stale: true, failed: !f[id]?.at } }));
        }
      }),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh(false);
    // No polling in a hidden tab; returning to it, or reconnecting, refreshes.
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(true), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh(false);
    const onOnline = () => refresh(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  const markets = useMemo(() => IDS.flatMap((id) => byProtocol[id] ?? []), [byProtocol]);
  const failed = IDS.filter((id) => feeds[id]?.failed);
  const stale = IDS.filter((id) => feeds[id]?.stale && !feeds[id]?.failed);
  const times = IDS.map((id) => feeds[id]?.at).filter((x): x is number => !!x);
  const updatedAt = times.length ? Math.min(...times) : null;

  return { markets, loading: loading && !markets.length, failed, stale, feeds, updatedAt, refresh: () => refresh(true) };
}
