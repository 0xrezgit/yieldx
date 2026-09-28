'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketData, MarketListing } from '../types/market';
import type { ProtocolId } from '../types/protocol';
import { ApiError, fetchMarket, fetchMarkets } from '../lib/data/market-data';
import protocols from '../config/protocols.json';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const HISTORY_DAYS = 60;
const REFRESH_MS = 5 * 60_000;

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'manual_only') return 'این پروتکل داده‌ی زنده ندارد؛ مقادیر را دستی وارد کنید.';
    if (e.code === 'market_not_found') return 'بازاری با این شناسه پیدا نشد.';
    if (e.code === 'upstream_error') return 'API پروتکل در دسترس نیست؛ کمی بعد دوباره تلاش کنید.';
  }
  return 'دریافت داده ناموفق بود.';
}

/** Market list + on-demand market fetch for the selected protocol. */
export function useMarketData(protocol: ProtocolId) {
  const live = protocols[protocol].liveData;
  const [markets, setMarkets] = useState<MarketListing[]>([]);
  const [listState, setListState] = useState<LoadState>('idle');
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<MarketData | null>(null);

  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Live list: loads on protocol change, then refreshes every few minutes and when the
  // tab regains focus, so new listings show up and matured ones flip to expired.
  useEffect(() => {
    setMarkets([]);
    setError(null);
    setState('idle');
    setUpdatedAt(null);
    if (!live) {
      setListState('idle');
      return;
    }
    let ctrl = new AbortController();
    let first = true;

    const refresh = () => {
      ctrl.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      if (first) setListState('loading');
      fetchMarkets(protocol, signal)
        .then((m) => {
          setMarkets(m);
          setListState('ready');
          setUpdatedAt(Date.now());
          first = false;
        })
        .catch((e) => {
          if (signal.aborted) return;
          // Keep showing the last good list on a failed background refresh.
          if (first) {
            setListState('error');
            setError(describe(e));
          }
        });
    };

    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [protocol, live]);

  const load = useCallback(
    async (marketId: string) => {
      setState('loading');
      setError(null);
      try {
        const res = await fetchMarket(protocol, marketId, HISTORY_DAYS);
        setLast(res.market);
        setState('ready');
        return res;
      } catch (e) {
        setState('error');
        setError(describe(e));
        return null;
      }
    },
    [protocol],
  );

  return { live, markets, listState, updatedAt, state, error, last, load };
}
