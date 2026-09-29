'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortfolioFile, PortfolioSnapshot, Position } from '../types/position';
import { readLocal, STORAGE_KEYS, writeLocal } from '../lib/data/local-store';
import { mergeAirdrops, mergeBackup, normalizePosition, parseBackup } from '../lib/portfolio/portfolio';
import { normalizeProgram } from '../lib/portfolio/airdrop';
import type { AirdropProgram } from '../types/airdrop';

interface Stored {
  positions: unknown[];
  history: PortfolioSnapshot[];
  airdrops?: unknown[];
}

/**
 * The user's positions, kept only in this browser. There are no accounts, so
 * personal positions are never sent to the shared API; export/import is the backup.
 * Other tabs pick up changes through the storage event.
 */
export function usePortfolio() {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [airdrops, setAirdrops] = useState<AirdropProgram[]>([]);
  const airdropRef = useRef<AirdropProgram[]>([]);
  // Latest list for back-to-back updates within one render (e.g. several snapshots at once).
  const ref = useRef<Position[]>([]);

  const load = useCallback(() => {
    const s = readLocal<Stored>(STORAGE_KEYS.portfolio, { positions: [], history: [] });
    ref.current = (s.positions ?? []).map(normalizePosition).filter((p): p is Position => p !== null);
    setPositions(ref.current);
    setHistory(Array.isArray(s.history) ? s.history : []);
    airdropRef.current = (s.airdrops ?? []).map(normalizeProgram).filter((a): a is AirdropProgram => a !== null);
    setAirdrops(airdropRef.current);
  }, []);

  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEYS.portfolio && load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [load]);

  const persist = useCallback((next: Position[], nextHistory?: PortfolioSnapshot[], nextAirdrops?: AirdropProgram[]) => {
    ref.current = next;
    setPositions(next);
    if (nextHistory) setHistory(nextHistory);
    if (nextAirdrops) {
      airdropRef.current = nextAirdrops;
      setAirdrops(nextAirdrops);
    }
    const current = readLocal<Stored>(STORAGE_KEYS.portfolio, { positions: [], history: [] });
    writeLocal(STORAGE_KEYS.portfolio, { positions: next, history: nextHistory ?? current.history ?? [], airdrops: airdropRef.current });
  }, []);

  /** Create or update an airdrop record (touches updatedAt). */
  const saveAirdrop = useCallback(
    (a: AirdropProgram) => {
      const list = airdropRef.current;
      const stamped = { ...a, updatedAt: new Date().toISOString() };
      persist(ref.current, undefined, list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? stamped : x)) : [...list, stamped]);
    },
    [persist],
  );

  const removeAirdrop = useCallback((id: string) => persist(ref.current, undefined, airdropRef.current.filter((a) => a.id !== id)), [persist]);

  const save = useCallback(
    (p: Position, touch = true) => {
      const list = ref.current;
      const stamped = touch ? { ...p, updatedAt: new Date().toISOString() } : p;
      persist(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? stamped : x)) : [...list, stamped]);
    },
    [persist],
  );

  // A deleted position is also unlinked from its airdrop records (the records stay).
  const remove = useCallback(
    (id: string) =>
      persist(
        ref.current.filter((p) => p.id !== id),
        undefined,
        airdropRef.current.map((a) => (a.positionIds.includes(id) ? { ...a, positionIds: a.positionIds.filter((x) => x !== id), shares: a.shares ? Object.fromEntries(Object.entries(a.shares).filter(([k]) => k !== id)) : null } : a)),
      ),
    [persist],
  );

  const setHistorySnapshots = useCallback(
    (h: PortfolioSnapshot[]) => {
      setHistory(h);
      const current = readLocal<Stored>(STORAGE_KEYS.portfolio, { positions: [], history: [] });
      writeLocal(STORAGE_KEYS.portfolio, { ...current, history: h, airdrops: airdropRef.current });
    },
    [],
  );

  const exportFile = useCallback((): PortfolioFile => ({ version: 1, exportedAt: new Date().toISOString(), positions: positions ?? [], history, airdrops }), [positions, history, airdrops]);

  /** Returns the number of positions imported, or null for an invalid file. */
  const importFile = useCallback(
    (text: string): number | null => {
      const file = parseBackup(text);
      if (!file) return null;
      const merged = mergeBackup(ref.current, file);
      const byAt = new Map([...history, ...file.history].map((h) => [h.at, h]));
      persist(merged, [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at)), mergeAirdrops(airdropRef.current, file.airdrops));
      return file.positions.length;
    },
    [history, persist],
  );

  return { positions, history, airdrops, saveAirdrop, removeAirdrop, save, remove, setHistory: setHistorySnapshots, exportFile, importFile };
}
