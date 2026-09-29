'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeScenario, type StrategyId } from '../../lib/analysis';
import { buildInsights, buildVerdict } from '../../lib/risk/advisor';
import { evaluateAlerts } from '../../lib/risk/alerts';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { clearMarket, markManual, mergeMarketData } from '../../lib/data/market-data';
import { defaultScenario, type ScenarioParams, type ScenarioSetter } from '../../types/scenario';
import type { MarketListing } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import { loadScenario, normalizeScenarioData, useScenarios } from '../../hooks/useScenarios';
import { useAlerts } from '../../hooks/useAlerts';
import { useMarketData } from '../../hooks/useMarketData';
import { fieldMessages } from '../forms/messages';

const AUTO_REFRESH_MS = 5 * 60_000;

/** The analysis has something real to show: a picked market, or values the user chose to enter by hand. */
export const hasMarket = (p: ScenarioParams) => !!p.marketId || !!p.manualEntry;

/**
 * Applies a fetched market only if it is still the one selected — a late answer for a
 * market (or protocol) the user has already left is dropped. Pure, for tests.
 */
export function applyIfCurrent(prev: ScenarioParams, protocol: ProtocolId, marketId: string, apply: (p: ScenarioParams) => ScenarioParams): ScenarioParams {
  return prev.protocol === protocol && prev.marketId === marketId ? apply(prev) : prev;
}

/** All analysis state, shared by the mobile (PWA) and desktop layouts. */
export function useDashboard() {
  const [p, setP] = useState<ScenarioParams | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [focus, setFocus] = useState<StrategyId | 'auto'>('auto');
  const [carry, setCarry] = useState(false);
  const [fromScenario, setFromScenario] = useState(false);
  const scenarios = useScenarios();
  const alerts = useAlerts();
  const md = useMarketData(p?.protocol ?? 'exponent');
  const pRef = useRef<ScenarioParams | null>(null);
  pRef.current = p;

  // Load ?scenario=<id>, else the last draft. Client-only: avoids SSR/Date.now mismatches.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('scenario');
    (async () => {
      if (id) {
        const s = await loadScenario(id);
        if (s) {
          setP(s.data);
          setSavedId(s.id);
          setName(s.name);
          setFromScenario(true);
          return;
        }
      }
      setP(normalizeScenarioData(readLocal(STORAGE_KEYS.draft, null) ?? defaultScenario()));
    })();
  }, []);

  useEffect(() => {
    if (p) writeLocal(STORAGE_KEYS.draft, p);
  }, [p]);

  /** Typing into a market field marks it «دستی» so a refresh won't overwrite it. */
  const set: ScenarioSetter = useCallback((key, value) => setP((x) => (x ? markManual({ ...x, [key]: value }, key) : x)), []);

  const setProtocol = useCallback((protocol: ProtocolId) => setP((x) => (x && x.protocol !== protocol ? { ...clearMarket(x), protocol } : x)), []);

  /** Fetch `marketId` and apply it when it arrives — if it is still the selected market. */
  const fetchInto = useCallback(
    async (protocol: ProtocolId, marketId: string, carryAssumptions: boolean) => {
      const res = await md.load(marketId);
      if (!res) return;
      setP((prev) => (prev ? applyIfCurrent(prev, protocol, marketId, (x) => mergeMarketData(x, res.market, res.history, { carryAssumptions })) : prev));
    },
    [md],
  );

  /**
   * Pick a market: the previous market's numbers and assumptions are cleared right
   * away (the result shows a placeholder, not stale figures), then the new data loads.
   */
  const pickMarket = useCallback(
    (m: MarketListing) => {
      const cur = pRef.current;
      if (!cur) return;
      const protocol = cur.protocol;
      const kept = carry ? cur : null;
      setP((x) => {
        if (!x) return x;
        const cleared = clearMarket(x);
        return {
          ...cleared,
          ...(kept ? pickAssumptions(kept) : {}),
          protocol,
          marketId: m.id,
          marketName: m.name,
          marketIcon: m.icon ?? '',
          chain: m.chain,
          platform: m.platform ?? '',
          maturity: m.maturity.slice(0, 10),
        };
      });
      setFromScenario(false);
      void fetchInto(protocol, m.id, carry);
    },
    [carry, fetchInto],
  );

  /** Re-read the selected market: observed values update, manual entries and assumptions stay. */
  const refresh = useCallback(() => {
    const cur = pRef.current;
    if (cur?.marketId) void fetchInto(cur.protocol, cur.marketId, true);
  }, [fetchInto]);

  const startManual = useCallback(
    () =>
      setP((x) =>
        x
          ? {
              ...clearMarket(x),
              manualEntry: true,
              underlyingPrice: 1,
              ptPrice: NaN,
              ytPrice: NaN,
              baseAPY: NaN,
              dataMeta: { source: 'manual', fetchedAt: null, sourceUpdatedAt: null, missing: [], manual: [], accountingSymbol: null, asset: null, historySource: 'none' },
            }
          : x,
      ),
    [],
  );

  // Keep a live market live: refresh on open (drafts only — a saved scenario keeps its numbers until asked) and every few minutes.
  const marketKey = p ? `${p.protocol}:${p.marketId}` : '';
  useEffect(() => {
    const cur = pRef.current;
    if (!cur?.marketId || !md.live) return;
    if (!fromScenario) refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per selected market
  }, [marketKey, md.live]);

  const analysis = useMemo(() => (p ? analyzeScenario(p) : null), [p]);
  const insights = useMemo(() => (p && analysis ? buildInsights(p, analysis) : []), [p, analysis]);
  const verdict = useMemo(() => (analysis ? buildVerdict(analysis, insights) : null), [analysis, insights]);
  const triggered = useMemo(() => (analysis ? evaluateAlerts(alerts.rules, analysis) : []), [alerts.rules, analysis]);
  const msg = useMemo(() => (analysis ? fieldMessages(analysis.validation) : null), [analysis]);

  const save = useCallback(async () => {
    if (!p) return;
    setSaveState('saving');
    const fallback = p.marketName || `سناریو ${new Date().toLocaleDateString('fa-IR')}`;
    const s = await scenarios.save(name.trim() || fallback, p, savedId);
    setSavedId(s.id);
    setName(s.name);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }, [p, name, savedId, scenarios]);

  const reset = useCallback(() => {
    setP((x) => ({ ...defaultScenario(), protocol: x?.protocol ?? 'exponent', capital: x?.capital ?? defaultScenario().capital }));
    setSavedId(undefined);
    setName('');
    setFromScenario(false);
    setFocus('auto');
  }, []);

  return {
    p,
    setP,
    set,
    setProtocol,
    pickMarket,
    refresh,
    startManual,
    md,
    carry,
    setCarry,
    focus,
    setFocus,
    fromScenario,
    analysis,
    insights,
    verdict,
    triggered,
    msg,
    alerts,
    storageMode: scenarios.mode,
    save: { name, setName, run: save, state: saveState, isUpdate: !!savedId },
    reset,
  };
}

/** The market-specific assumptions to carry when the user explicitly asks for it. */
function pickAssumptions(p: ScenarioParams): Partial<ScenarioParams> {
  const { fdv, airdropAllocation, totalPointsSupply, existingPoints, snapshotDate, pointsName, pointsPerDay, pointsBasis, ytMultiplier, lpMultiplier, pointsSeason } = p;
  return { fdv, airdropAllocation, totalPointsSupply, existingPoints, snapshotDate, pointsName, pointsPerDay, pointsBasis, ytMultiplier, lpMultiplier, pointsSeason };
}

export type DashboardState = ReturnType<typeof useDashboard>;

/** Narrowed state once the scenario has loaded. */
export type ReadyDashboard = DashboardState & {
  p: ScenarioParams;
  analysis: NonNullable<DashboardState['analysis']>;
  verdict: NonNullable<DashboardState['verdict']>;
  msg: NonNullable<DashboardState['msg']>;
};

export const isReady = (d: DashboardState): d is ReadyDashboard => !!(d.p && d.analysis && d.verdict && d.msg);
