'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Position } from '../types/position';
import protocols from '../config/protocols.json';
import { fetchMarket } from '../lib/data/market-data';
import { quoteFromMarket, type MarketQuote } from '../lib/portfolio/valuation';
import { DAY_MS } from '../lib/utils/math';

/** Market data is cached upstream for ~60s; five minutes keeps well inside every API's limits. */
const REFRESH_MS = 5 * 60_000;
const CONCURRENCY = 3;
/** Enough daily history for the YT low/base/high range even on a new position. */
const MIN_HISTORY_DAYS = 60;

export const quoteKey = (p: Pick<Position, 'protocol' | 'marketId'>) => `${p.protocol}:${p.marketId}`;

export interface QuoteState {
  quote: MarketQuote | null;
  /** Extra details used by the wizard and analysis. */
  assetSymbol: string | null;
  error: string | null;
  loading: boolean;
}

/**
 * Live quotes for the markets of the given positions.
 * A failed refresh keeps the previous quote but flags it, so it is shown as stale,
 * never as live.
 */
export function useQuotes(positions: Position[] | null) {
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const running = useRef(false);

  // One request per market; history covers the oldest holding (protocols that have it).
  const targets = useMemo(() => {
    const map = new Map<string, { protocol: Position['protocol']; marketId: string; days: number }>();
    for (const p of positions ?? []) {
      if (!protocols[p.protocol]?.liveData) continue;
      const first = p.events.reduce((m, e) => Math.min(m, new Date(e.at).getTime()), Infinity);
      const days = protocols[p.protocol].historyAvailable && Number.isFinite(first) ? Math.min(365, Math.max(MIN_HISTORY_DAYS, Math.ceil((Date.now() - first) / DAY_MS) + 2)) : 0;
      const k = quoteKey(p);
      const prev = map.get(k);
      map.set(k, { protocol: p.protocol, marketId: p.marketId, days: Math.max(prev?.days ?? 0, days) });
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the set of markets changes
  }, [JSON.stringify((positions ?? []).map((p) => [quoteKey(p), p.events.length]))]);

  const refresh = useCallback(async () => {
    if (running.current || !targets.length) return;
    running.current = true;
    setRefreshing(true);
    setQuotes((q) => {
      const next = { ...q };
      for (const [k] of targets) next[k] = { ...(next[k] ?? { quote: null, assetSymbol: null, error: null }), loading: true };
      return next;
    });
    const queue = [...targets];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const [k, { protocol, marketId, days }] = t;
        try {
          const { market, history } = await fetchMarket(protocol, marketId, days);
          setQuotes((q) => ({ ...q, [k]: { quote: quoteFromMarket(market, history), assetSymbol: market.assetSymbol ?? null, error: null, loading: false } }));
        } catch {
          setQuotes((q) => {
            const prev = q[k];
            return {
              ...q,
              [k]: { quote: prev?.quote ? { ...prev.quote, failed: true } : null, assetSymbol: prev?.assetSymbol ?? null, error: 'دریافت داده‌ی بازار ناموفق بود', loading: false },
            };
          });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setUpdatedAt(Date.now());
    setRefreshing(false);
    running.current = false;
  }, [targets]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { quotes, refresh, refreshing, updatedAt };
}
