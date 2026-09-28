'use client';

import { useEffect, useState } from 'react';
import type { ProtocolId } from '../types/protocol';
import { fetchMarkets } from '../lib/data/market-data';
import type { OpportunityListing } from '../lib/risk/opportunities';
import protocols from '../config/protocols.json';

const REFRESH_MS = 5 * 60_000;
const IDS = (Object.keys(protocols) as ProtocolId[]).filter((id) => protocols[id].liveData);

/**
 * Live market lists of every protocol, merged. Refreshes every few minutes and on
 * tab focus; a protocol whose API fails is reported but doesn't hide the others.
 */
export function useAllMarkets() {
  const [markets, setMarkets] = useState<OpportunityListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<ProtocolId[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let ctrl = new AbortController();

    const refresh = async () => {
      ctrl.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      const results = await Promise.allSettled(IDS.map((id) => fetchMarkets(id, signal)));
      if (signal.aborted) return;
      const ok: OpportunityListing[] = [];
      const bad: ProtocolId[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok.push(...r.value.map((m) => ({ ...m, protocol: IDS[i] })));
        else bad.push(IDS[i]);
      });
      // Keep the last good list when a background refresh fails completely.
      if (ok.length) {
        setMarkets(ok);
        setUpdatedAt(Date.now());
      }
      setFailed(bad);
      setLoading(false);
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
  }, []);

  return { markets, loading, failed, updatedAt };
}
