'use client';

import { useCallback, useEffect, useState } from 'react';
import { isAlertRule, type AlertRule } from '../lib/risk/alerts';
import { readLocal, STORAGE_KEYS, writeLocal } from '../lib/data/local-store';
import type { StorageMode } from './useScenarios';

/** Sensible starting rules for a new user. */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: 'default-gap', metric: 'gapPercent', operator: 'gt', threshold: 20, enabled: true },
  { id: 'default-hf', metric: 'healthFactor', operator: 'lt', threshold: 1.15, enabled: true },
  { id: 'default-trend', metric: 'apyTrend7d', operator: 'lt', threshold: -0.5, enabled: true },
];

const readRules = () => {
  const stored = readLocal<unknown[] | null>(STORAGE_KEYS.alerts, null);
  return stored === null ? DEFAULT_ALERT_RULES : stored.filter(isAlertRule);
};

/** Alert rules, stored in /api/alerts when the DB is configured, otherwise in localStorage. */
export function useAlerts() {
  const [mode, setMode] = useState<StorageMode>('local');
  const [rules, setRules] = useState<AlertRule[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      if (!res.ok) throw new Error(String(res.status));
      setRules(((await res.json()) as unknown[]).filter(isAlertRule));
      setMode('remote');
    } catch {
      setRules(readRules());
      setMode('local');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const persistLocal = (next: AlertRule[]) => {
    writeLocal(STORAGE_KEYS.alerts, next);
    setRules(next);
  };

  const add = useCallback(
    async (rule: Omit<AlertRule, 'id'>) => {
      if (mode === 'remote') {
        const res = await fetch('/api/alerts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rule),
        });
        if (res.ok) return refresh();
      }
      persistLocal([...readRules(), { ...rule, id: `local-${Date.now()}` }]);
    },
    [mode, refresh],
  );

  const update = useCallback(
    async (rule: AlertRule) => {
      if (mode === 'remote') {
        const res = await fetch('/api/alerts', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rule),
        });
        if (res.ok) return refresh();
      }
      persistLocal(readRules().map((r) => (r.id === rule.id ? rule : r)));
    },
    [mode, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (mode === 'remote') {
        const res = await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) return refresh();
      }
      persistLocal(readRules().filter((r) => r.id !== id));
    },
    [mode, refresh],
  );

  return { mode, rules, add, update, remove };
}
