'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Position } from '../types/position';
import { analyzePosition, positionAlerts, type Alert, type Analysis } from '../lib/portfolio/analysis';
import { appendSnapshot, portfolioSnapshot, portfolioTotals, positionSnapshot } from '../lib/portfolio/portfolio';
import { defaultExitSettings, valuePosition, type MarketQuote, type Valuation } from '../lib/portfolio/valuation';
import { fetchPrices } from '../lib/data/market-data';
import { tokenInfo } from '../lib/portfolio/tokens';
import { usePortfolio } from './usePortfolio';
import { quoteKey, useQuotes, type QuoteState } from './useQuotes';

export interface PositionView {
  p: Position;
  v: Valuation;
  a: Analysis;
  alerts: Alert[];
  quote: MarketQuote | null;
  q: QuoteState | undefined;
}

/**
 * Positions + live quotes → valuations. Time ticks every 30s so ages and debt
 * interest move. When every open position is priced from fresh market data, a
 * real snapshot is appended (at most hourly) — the performance chart uses only those.
 */
export function usePortfolioView() {
  const store = usePortfolio();
  const { quotes, refresh, refreshing, updatedAt } = useQuotes(store.positions);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [updatedAt]);

  // Live prices of loop debt tokens that differ from the market's asset (e.g. USDC debt on an ETH PT).
  const [debtPrices, setDebtPrices] = useState<Record<string, number>>({});
  const debtSymbols = [...new Set((store.positions ?? []).filter((p) => p.loop && !p.loop.debtIsAccountingAsset && tokenInfo(p.loop.debtAsset)).map((p) => tokenInfo(p.loop!.debtAsset)!.symbol))].sort().join(',');
  useEffect(() => {
    if (!debtSymbols) return;
    const ctrl = new AbortController();
    fetchPrices(debtSymbols.split(','), undefined, ctrl.signal)
      .then((p) => setDebtPrices(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.usd]))))
      .catch(() => {});
    return () => ctrl.abort();
  }, [debtSymbols, updatedAt]);

  const views = useMemo<PositionView[]>(
    () =>
      (store.positions ?? []).map((p) => {
        const q = quotes[quoteKey(p)];
        const quote = q?.quote ?? null;
        const debtSym = p.loop && !p.loop.debtIsAccountingAsset ? tokenInfo(p.loop.debtAsset)?.symbol : undefined;
        const v = valuePosition(p, quote, now, defaultExitSettings, debtSym ? debtPrices[debtSym] ?? null : null);
        return { p, v, a: analyzePosition(p, v, quote), alerts: positionAlerts(p, v), quote, q };
      }),
    [store.positions, quotes, now, debtPrices],
  );

  const totals = useMemo(() => portfolioTotals(views), [views]);

  // Record snapshots from fresh data only.
  const { save, setHistory, history } = store;
  useEffect(() => {
    if (!updatedAt || !views.length) return;
    const at = new Date().toISOString();
    const live = (x: PositionView) => x.v.status === 'closed' || (x.v.tokenPrice.quality !== 'missing' && x.v.tokenPrice.quality !== 'stale' && x.v.assetUsd.quality !== 'missing' && x.v.assetUsd.quality !== 'stale');
    for (const x of views) {
      if (x.v.status === 'closed' || !live(x) || !Number.isFinite(x.v.netValueUsd)) continue;
      const next = appendSnapshot(x.p.snapshots, positionSnapshot(x.v, at));
      if (next !== x.p.snapshots) save({ ...x.p, snapshots: next }, false);
    }
    if (views.every(live) && totals.unpriced === 0) {
      const next = appendSnapshot(history, portfolioSnapshot(totals, at));
      if (next !== history) setHistory(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only after a refresh completes
  }, [updatedAt]);

  return { ...store, views, totals, quotes, refresh, refreshing, updatedAt, now };
}
