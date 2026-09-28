'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortfolioFile, PortfolioSnapshot, Position } from '../types/position';
import { readLocal, STORAGE_KEYS, writeLocal } from '../lib/data/local-store';
import { mergeBackup, normalizePosition, parseBackup } from '../lib/portfolio/portfolio';

interface Stored {
  positions: unknown[];
  history: PortfolioSnapshot[];
}

/**
 * The user's positions, kept only in this browser. There are no accounts, so
 * personal positions are never sent to the shared API; export/import is the backup.
 * Other tabs pick up changes through the storage event.
 */
export function usePortfolio() {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  // Latest list for back-to-back updates within one render (e.g. several snapshots at once).
  const ref = useRef<Position[]>([]);

  const load = useCallback(() => {
    const s = readLocal<Stored>(STORAGE_KEYS.portfolio, { positions: [], history: [] });
    ref.current = (s.positions ?? []).map(normalizePosition).filter((p): p is Position => p !== null);
    setPositions(ref.current);
    setHistory(Array.isArray(s.history) ? s.history : []);
  }, []);

  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEYS.portfolio && load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [load]);

  const persist = useCallback((next: Position[], nextHistory?: PortfolioSnapshot[]) => {
    ref.current = next;
    setPositions(next);
    if (nextHistory) setHistory(nextHistory);
    const current = readLocal<Stored>(STORAGE_KEYS.portfolio, { positions: [], history: [] });
    writeLocal(STORAGE_KEYS.portfolio, { positions: next, history: nextHistory ?? current.history ?? [] });
  }, []);

  const save = useCallback(
    (p: Position, touch = true) => {
      const list = ref.current;
      const stamped = touch ? { ...p, updatedAt: new Date().toISOString() } : p;
      persist(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? stamped : x)) : [...list, stamped]);
    },
    [persist],
  );

  const remove = useCallback((id: string) => persist(ref.current.filter((p) => p.id !== id)), [persist]);

  const setHistorySnapshots = useCallback(
    (h: PortfolioSnapshot[]) => {
      setHistory(h);
      const current = readLocal<Stored>(STORAGE_KEYS.portfolio, { positions: [], history: [] });
      writeLocal(STORAGE_KEYS.portfolio, { ...current, history: h });
    },
    [],
  );

  const exportFile = useCallback((): PortfolioFile => ({ version: 1, exportedAt: new Date().toISOString(), positions: positions ?? [], history }), [positions, history]);

  /** Returns the number of positions imported, or null for an invalid file. */
  const importFile = useCallback(
    (text: string): number | null => {
      const file = parseBackup(text);
      if (!file) return null;
      const merged = mergeBackup(ref.current, file);
      const byAt = new Map([...history, ...file.history].map((h) => [h.at, h]));
      persist(merged, [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at)));
      return file.positions.length;
    },
    [history, persist],
  );

  return { positions, history, save, remove, setHistory: setHistorySnapshots, exportFile, importFile };
}
