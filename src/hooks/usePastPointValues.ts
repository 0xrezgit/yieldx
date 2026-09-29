'use client';

import { useEffect, useState } from 'react';
import { readLocal, STORAGE_KEYS } from '../lib/data/local-store';
import { normalizeProgram, pastValues } from '../lib/portfolio/airdrop';
import type { AirdropProgram } from '../types/airdrop';

/** Actual value of 1M points recorded for earlier seasons of `name` (from the portfolio), latest first. */
export function usePastPointValues(name: string) {
  const [programs, setPrograms] = useState<AirdropProgram[]>([]);
  useEffect(() => {
    const s = readLocal<{ airdrops?: unknown[] }>(STORAGE_KEYS.portfolio, {});
    setPrograms((s.airdrops ?? []).map(normalizeProgram).filter((a): a is AirdropProgram => a !== null));
  }, []);
  return name ? pastValues(programs, name) : [];
}
