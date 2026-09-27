'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketData, MarketSummary } from '../types/market';
import type { ProtocolId } from '../types/protocol';
import { ApiError, fetchMarket, fetchMarkets } from '../lib/data/market-data';
import protocols from '../config/protocols.json';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const HISTORY_DAYS = 60;

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
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [listState, setListState] = useState<LoadState>('idle');
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<MarketData | null>(null);

  useEffect(() => {
    setMarkets([]);
    setError(null);
    setState('idle');
    if (!live) {
      setListState('idle');
      return;
    }
    const ctrl = new AbortController();
    setListState('loading');
    fetchMarkets(protocol, ctrl.signal)
      .then((m) => {
        setMarkets(m);
        setListState('ready');
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setListState('error');
        setError(describe(e));
      });
    return () => ctrl.abort();
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

  return { live, markets, listState, state, error, last, load };
}
