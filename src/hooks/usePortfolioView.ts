'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Position } from '../types/position';
import { analyzePosition, positionAlerts, type Alert, type Analysis } from '../lib/portfolio/analysis';
import { appendSnapshot, portfolioSnapshot, portfolioTotals, positionSnapshot } from '../lib/portfolio/portfolio';
import { defaultExitSettings, valuePosition, type MarketQuote, type Valuation } from '../lib/portfolio/valuation';
import { fetchCoinPrices, fetchPrices, type TokenPrice } from '../lib/data/market-data';
import { shares, summarize, type AirdropSummary } from '../lib/portfolio/airdrop';
import type { AirdropProgram } from '../types/airdrop';
import { coinId } from './useCoinPrice';
import { tokenInfo } from '../lib/portfolio/tokens';
import { usePortfolio } from './usePortfolio';
import { quoteKey, useQuotes, type QuoteState } from './useQuotes';

/** One airdrop program as seen from one linked position. */
export interface PositionAirdrop {
  program: AirdropProgram;
  summary: AirdropSummary;
  /** Current USD price of the token (automatic or manual) and where it came from. */
  price: { usd: number; source: 'market' | 'manual'; at: string } | null;
  /** This position's share of the program (0–1). */
  share: number;
}

export interface PositionView {
  p: Position;
  v: Valuation;
  a: Analysis;
  alerts: Alert[];
  quote: MarketQuote | null;
  q: QuoteState | undefined;
  airdrops: PositionAirdrop[];
}

export interface AirdropTotals {
  /** Sum of known program results (each program once). */
  usd: number;
  /** Programs with tokens whose result is unknown (no price). */
  unknown: number;
  programs: number;
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

  // Current prices of airdrop tokens, by contract address, in one request.
  const [coinPrices, setCoinPrices] = useState<Record<string, TokenPrice>>({});
  const coinIds = [...new Set(store.airdrops.map((a) => (a.token ? coinId(a.token.chain, a.token.address) : null)).filter((x): x is string => !!x))].sort().join(',');
  useEffect(() => {
    if (!coinIds) return;
    const ctrl = new AbortController();
    fetchCoinPrices(coinIds.split(','), undefined, ctrl.signal)
      .then(setCoinPrices)
      .catch(() => {});
    return () => ctrl.abort();
  }, [coinIds, updatedAt]);

  const base = useMemo(
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

  const programs = useMemo(() => {
    const estimated = Object.fromEntries(base.map((x) => [x.p.id, x.v.points]));
    return store.airdrops.map((program) => {
      const id = program.token ? coinId(program.token.chain, program.token.address) : null;
      const auto = id ? coinPrices[id] : undefined;
      const price = auto ? { usd: auto.usd, source: 'market' as const, at: auto.at } : program.manualPrice ? { usd: program.manualPrice.usd, source: 'manual' as const, at: program.manualPrice.at } : null;
      return { program, price, summary: summarize(program, price?.usd ?? null, now), shares: shares(program, estimated) };
    });
  }, [store.airdrops, base, coinPrices, now]);

  const views = useMemo<PositionView[]>(
    () =>
      base.map((x) => ({
        ...x,
        airdrops: programs.filter((g) => g.program.positionIds.includes(x.p.id)).map((g) => ({ program: g.program, summary: g.summary, price: g.price, share: g.shares[x.p.id] ?? 0 })),
      })),
    [base, programs],
  );

  const totals = useMemo(() => portfolioTotals(views), [views]);
  const airdropTotals = useMemo<AirdropTotals>(() => {
    const received = programs.filter((g) => g.summary.received > 0 || g.summary.stage === 'none');
    return {
      usd: received.reduce((s, g) => s + (g.summary.totalUsd ?? 0), 0),
      unknown: received.filter((g) => g.summary.totalUsd === null).length,
      programs: received.length,
    };
  }, [programs]);

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

  return { ...store, views, totals, airdropTotals, quotes, refresh, refreshing, updatedAt, now };
}
