'use client';

import { useDeferredValue, useMemo } from 'react';
import { useLending } from './useLending';
import { useAllMarkets } from './useAllMarkets';
import { useMerkl } from './useMerkl';
import { liveAt } from '../lib/merkl/filters';
import { buildContext } from '../lib/merkl/vetting';
import { ptOpportunity, ytOpportunity } from '../lib/opportunity/from-market';
import { protocolIdentity } from '../lib/registry/identity';
import { evaluate, type Analysis, type AnalysisInput } from '../lib/market/analysis';
import type { SourceStatus } from '../lib/lending/types';
import type { Opportunity } from '../types/opportunity';

export interface MarketAnalysisState {
  /** Estimates for the capital at every horizon; null until some data arrived. */
  analysis: Analysis | null;
  /** The capital the shown analysis was computed for (lags typing by a frame). */
  analysedCapital: number;
  /** Still computing for the latest capital. */
  pending: boolean;
  sources: SourceStatus[];
  /** Nothing has answered yet. */
  loading: boolean;
  /** Every source failed. */
  failed: boolean;
  refreshing: boolean;
  /** Live PT/YT market lists of Pendle, Spectra and Exponent (for the YT dollar ranking). */
  markets: ReturnType<typeof useAllMarkets>['markets'];
  /** The lending feed (for the Loop PT dollar ranking's real lending markets). */
  lending: { opportunities: Opportunity[] | null; loading: boolean; failed: boolean };
  /** Newest data time across sources (ms). */
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * One snapshot for the market analysis: lending and vault adapters (server), PT
 * lists (Pendle, Spectra, Exponent) and Merkl campaigns, re-estimated for the
 * capital. A failing source never blocks the others. Typing the capital does not
 * recompute on every key: the deferred value keeps the previous result on screen
 * until the new one is ready, and a result is never shown under another capital.
 */
export function useMarketAnalysis(capital: number): MarketAnalysisState {
  const lending = useLending();
  const pt = useAllMarkets();
  const merkl = useMerkl();
  const minute = Math.floor(merkl.now / 60) * 60;

  const input: AnalysisInput | null = useMemo(() => {
    if (!lending.feed && !pt.markets.length && !merkl.feed) return null;
    const live = pt.markets.filter((m) => !m.expired);
    const at = (m: (typeof live)[number]) => new Date(pt.feeds[m.protocol]?.at ?? Date.now()).toISOString();
    const ptOpps = [...live.map((m) => ptOpportunity(m.protocol, m, at(m))), ...live.map((m) => ytOpportunity(m.protocol, m, at(m))).filter((o) => o !== null)];
    const f = merkl.feed;
    const list = f ? f.opportunities.map((o) => liveAt(o, minute)).filter((o) => o.campaigns.length > 0) : [];
    return {
      opportunities: [...(lending.feed?.opportunities ?? []), ...ptOpps],
      merkl: f ? { list, ctx: buildContext(list, f.markets, f.marketChains, minute, f.sells ?? {}), stale: merkl.stale, fetchedAt: new Date(f.fetchedAt).toISOString() } : null,
      gas: f?.gas ?? [],
    };
  }, [lending.feed, pt.markets, pt.feeds, merkl.feed, merkl.stale, minute]);

  const deferredCapital = useDeferredValue(capital);
  const analysis = useMemo(() => (input && deferredCapital > 0 ? evaluate(input, deferredCapital, minute * 1000) : null), [input, deferredCapital, minute]);

  const sources: SourceStatus[] = useMemo(
    () => [
      ...(lending.feed?.sources ?? []),
      ...Object.entries(pt.feeds).map(([id, f]) => ({
        id,
        name: protocolIdentity(id as never).name,
        state: (f!.failed ? 'error' : f!.stale ? 'stale' : 'ok') as SourceStatus['state'],
        fetchedAt: f!.at ? new Date(f!.at).toISOString() : null,
        count: pt.markets.filter((m) => m.protocol === id && !m.expired).length,
        error: null,
      })),
      ...(merkl.loading ? [] : [{ id: 'merkl', name: 'Merkl', state: (merkl.failed ? 'error' : merkl.stale ? 'stale' : 'ok') as SourceStatus['state'], fetchedAt: merkl.feed ? new Date(merkl.feed.fetchedAt).toISOString() : null, count: merkl.feed?.opportunities.length ?? 0, error: null }]),
    ],
    [lending.feed, pt.feeds, pt.markets, merkl.loading, merkl.failed, merkl.stale, merkl.feed],
  );
  const times = sources.map((s) => (s.fetchedAt ? new Date(s.fetchedAt).getTime() : NaN)).filter(Number.isFinite);

  return {
    analysis: analysis && analysis.capital === deferredCapital ? analysis : null,
    analysedCapital: deferredCapital,
    pending: deferredCapital !== capital,
    sources,
    loading: lending.loading && pt.loading && merkl.loading,
    failed: lending.failed && !pt.markets.length && merkl.failed,
    refreshing: lending.refreshing || merkl.refreshing,
    markets: pt.markets,
    lending: { opportunities: lending.feed?.opportunities ?? null, loading: lending.loading, failed: lending.failed },
    updatedAt: times.length ? Math.max(...times) : null,
    refresh: () => {
      lending.refresh();
      pt.refresh();
      merkl.refresh();
    },
  };
}
