'use client';

import { useCallback, useEffect, useState } from 'react';
import { defaultScenario, type SavedScenario, type ScenarioParams } from '../types/scenario';
import { readLocal, STORAGE_KEYS, writeLocal } from '../lib/data/local-store';

export type StorageMode = 'remote' | 'local';

/** Fills fields missing from older saved data so analysis never sees undefined. */
export function normalizeScenarioData(data: unknown): ScenarioParams {
  const base = defaultScenario();
  if (!data || typeof data !== 'object') return base;
  const merged = { ...base, ...(data as Partial<ScenarioParams>) };
  if (!Array.isArray(merged.apyHistory)) merged.apyHistory = [];
  return merged;
}

function fromRow(row: Record<string, unknown>): SavedScenario {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    data: normalizeScenarioData(row.data),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
  };
}

const readAll = (): SavedScenario[] =>
  readLocal<Record<string, unknown>[]>(STORAGE_KEYS.scenarios, []).map(fromRow);

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `local-${Date.now()}`;

/**
 * Saved scenarios. Uses /api/scenarios (Neon) when the database is configured and
 * falls back to localStorage when the API answers 503 or is unreachable.
 */
export function useScenarios() {
  const [mode, setMode] = useState<StorageMode>('local');
  const [items, setItems] = useState<SavedScenario[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/scenarios');
      if (!res.ok) throw new Error(String(res.status));
      const rows = (await res.json()) as Record<string, unknown>[];
      setMode('remote');
      setItems(rows.map(fromRow));
    } catch {
      setMode('local');
      setItems(readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (name: string, data: ScenarioParams, id?: string): Promise<SavedScenario> => {
      if (mode === 'remote') {
        const res = await fetch('/api/scenarios', {
          method: id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, name, data }),
        });
        if (res.ok) {
          const saved = fromRow(await res.json());
          await refresh();
          return saved;
        }
      }
      const now = new Date().toISOString();
      const all = readAll();
      const existing = id ? all.find((s) => s.id === id) : undefined;
      const saved: SavedScenario = existing
        ? { ...existing, name, data, updatedAt: now }
        : { id: newId(), name, data, createdAt: now, updatedAt: now };
      writeLocal(STORAGE_KEYS.scenarios, [saved, ...all.filter((s) => s.id !== saved.id)]);
      setMode('local');
      await refresh();
      return saved;
    },
    [mode, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (mode === 'remote') {
        await fetch(`/api/scenarios?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else {
        writeLocal(
          STORAGE_KEYS.scenarios,
          readAll().filter((s) => s.id !== id),
        );
      }
      await refresh();
    },
    [mode, refresh],
  );

  return { mode, items, loading, save, remove, refresh };
}

/** Loads a single scenario by id from the API, falling back to localStorage. */
export async function loadScenario(id: string): Promise<SavedScenario | null> {
  try {
    const res = await fetch(`/api/scenarios?id=${encodeURIComponent(id)}`);
    if (res.ok) return fromRow(await res.json());
  } catch {
    /* fall through to local */
  }
  return readAll().find((s) => s.id === id) ?? null;
}
