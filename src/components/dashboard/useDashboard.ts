'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeScenario } from '../../lib/analysis';
import { buildInsights, buildVerdict } from '../../lib/risk/advisor';
import { evaluateAlerts } from '../../lib/risk/alerts';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { defaultScenario, type ScenarioParams, type ScenarioSetter } from '../../types/scenario';
import { loadScenario, normalizeScenarioData, useScenarios } from '../../hooks/useScenarios';
import { useAlerts } from '../../hooks/useAlerts';
import { fieldMessages } from '../forms/messages';

/** All dashboard state, shared by the mobile (PWA) and web layouts. */
export function useDashboard() {
  const [p, setP] = useState<ScenarioParams | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const scenarios = useScenarios();
  const alerts = useAlerts();

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
          return;
        }
      }
      setP(normalizeScenarioData(readLocal(STORAGE_KEYS.draft, null) ?? defaultScenario()));
    })();
  }, []);

  useEffect(() => {
    if (p) writeLocal(STORAGE_KEYS.draft, p);
  }, [p]);

  const set: ScenarioSetter = useCallback((key, value) => setP((x) => (x ? { ...x, [key]: value } : x)), []);

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
    setP(defaultScenario());
    setSavedId(undefined);
    setName('');
  }, []);

  return {
    p,
    setP,
    set,
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

export type DashboardState = ReturnType<typeof useDashboard>;

/** Narrowed state once the scenario has loaded. */
export type ReadyDashboard = DashboardState & {
  p: ScenarioParams;
  analysis: NonNullable<DashboardState['analysis']>;
  verdict: NonNullable<DashboardState['verdict']>;
  msg: NonNullable<DashboardState['msg']>;
};

export const isReady = (d: DashboardState): d is ReadyDashboard => !!(d.p && d.analysis && d.verdict && d.msg);
