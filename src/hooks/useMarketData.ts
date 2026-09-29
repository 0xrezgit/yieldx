'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketData, MarketListing } from '../types/market';
import type { ProtocolId } from '../types/protocol';
import { ApiError, fetchMarket, fetchMarketsShared } from '../lib/data/market-data';
import protocols from '../config/protocols.json';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const HISTORY_DAYS = 60;
const REFRESH_MS = 5 * 60_000;

export function describeApiError(e: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'اتصال اینترنت برقرار نیست؛ داده‌ی زنده دریافت نشد.';
  if (e instanceof ApiError) {
    if (e.code === 'manual_only') return 'این پروتکل داده‌ی زنده ندارد؛ مقادیر را دستی وارد کنید.';
    if (e.code === 'market_not_found') return 'بازاری با این شناسه پیدا نشد.';
    if (e.code === 'upstream_error') return 'API پروتکل پاسخ نداد؛ کمی بعد دوباره تلاش کنید.';
  }
  return 'دریافت داده ناموفق بود.';
}

/**
 * Market list + on-demand market fetch for one protocol.
 *
 * Race safety: every `load` gets a sequence number and aborts the previous request;
 * a response that arrives after another market (or protocol) was chosen resolves to
 * null and is never applied. The list comes from the shared cache, so typing in a
 * form or opening another page doesn't refetch it.
 */
export function useMarketData(protocol: ProtocolId) {
  const live = protocols[protocol].liveData;
  const [markets, setMarkets] = useState<MarketListing[]>([]);
  const [listState, setListState] = useState<LoadState>('idle');
  const [listStale, setListStale] = useState(false);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<MarketData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    // New protocol: forget everything of the previous one, and cancel its market request.
    seq.current++;
    ctrl.current?.abort();
    setMarkets([]);
    setError(null);
    setState('idle');
    setLast(null);
    setUpdatedAt(null);
    setListStale(false);
    if (!live) {
      setListState('idle');
      return;
    }
    let alive = true;
    let first = true;
    const refresh = (force: boolean) => {
      if (first) setListState('loading');
      fetchMarketsShared(protocol, { force })
        .then((r) => {
          if (!alive) return;
          setMarkets(r.markets);
          setListState('ready');
          setListStale(r.stale);
          setUpdatedAt(r.at);
          first = false;
        })
        .catch((e) => {
          if (!alive) return;
          if (first) {
            setListState('error');
            setError(describeApiError(e));
          } else setListStale(true);
        });
    };
    refresh(false);
    const timer = setInterval(() => refresh(true), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh(false);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [protocol, live]);

  /** Fetch one market. Resolves to null when superseded by a newer request. */
  const load = useCallback(
    async (marketId: string) => {
      const my = ++seq.current;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setState('loading');
      setError(null);
      try {
        const res = await fetchMarket(protocol, marketId, HISTORY_DAYS, c.signal);
        if (my !== seq.current) return null;
        setLast(res.market);
        setState('ready');
        return res;
      } catch (e) {
        if (my !== seq.current || c.signal.aborted) return null;
        setState('error');
        setError(describeApiError(e));
        return null;
      }
    },
    [protocol],
  );

  return { live, markets, listState, listStale, updatedAt, state, error, last, load };
}
