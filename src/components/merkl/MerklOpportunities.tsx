'use client';

import { useEffect, useMemo, useState } from 'react';
import { Compass, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { useMerkl } from '../../hooks/useMerkl';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { applyMerklFilters, defaultMerklFilters, defaultMineSettings, type DiscoverSort, type MerklFilters, type MineSettings } from '../../lib/merkl/estimate';
import { formatNumber } from '../../lib/utils/formatting';
import { DataStatus } from '../ui/data-status';
import { Num } from '../ui/num';
import { Segmented } from '../opportunities/parts';
import { SectionSwitch } from '../opportunities/SectionSwitch';
import { MerklFilterBar } from './MerklFilters';
import { DiscoverBoard } from './DiscoverBoard';
import { MineBoard } from './MineBoard';

type Tab = 'discover' | 'mine';

interface Stored {
  tab: Tab;
  filters: MerklFilters;
  sort: DiscoverSort;
  mine: MineSettings;
}

const initial: Stored = { tab: 'discover', filters: defaultMerklFilters, sort: 'apr', mine: defaultMineSettings };

/** Stored values may be missing, NaN or from an older shape: fall back field by field. */
function sane<T extends object>(value: Partial<T> | undefined, fallback: T): T {
  const out = { ...fallback } as Record<string, unknown>;
  for (const [k, v] of Object.entries(value ?? {})) {
    const d = (fallback as Record<string, unknown>)[k];
    if (typeof d === 'number') out[k] = typeof v === 'number' && Number.isFinite(v) ? v : d;
    else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

/** Merkl incentives across every chain and protocol: discovery, and a personal estimate where one is valid. */
export default function MerklOpportunities() {
  const { opportunities, loading, fetchedAt, stale, failed, refresh } = useMerkl();
  const [st, setSt] = useState<Stored | null>(null);

  useEffect(() => {
    const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.merkl, {});
    const linked = new URLSearchParams(window.location.search).get('tab');
    setSt({
      tab: linked === 'mine' || linked === 'discover' ? linked : saved.tab === 'mine' ? 'mine' : 'discover',
      filters: sane(saved.filters, initial.filters),
      sort: (['apr', 'daily', 'tvl', 'ending'] as DiscoverSort[]).includes(saved.sort as DiscoverSort) ? (saved.sort as DiscoverSort) : initial.sort,
      mine: sane(saved.mine, initial.mine),
    });
  }, []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.merkl, st);
  }, [st]);

  const filtered = useMemo(() => (st ? applyMerklFilters(opportunities, st.filters) : []), [opportunities, st]);
  const live = useMemo(() => opportunities.filter((o) => o.campaigns.length > 0), [opportunities]);

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }
  const patch = (p: Partial<Stored>) => setSt((s) => (s ? { ...s, ...p } : s));

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">فرصت‌ها</h1>
          <p className="text-sm text-secondary">پاداش‌های تشویقی Merkl در همه‌ی شبکه‌ها و پروتکل‌ها؛ جدا از محاسبات PT، YT و لوپ.</p>
          <div className="mt-1">
            {loading ? (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> در حال دریافت فرصت‌های Merkl…
              </p>
            ) : failed ? (
              <p className="text-xs text-danger flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-danger" aria-hidden /> داده‌ی Merkl دریافت نشد
              </p>
            ) : (
              <DataStatus source="api" fetchedAt={fetchedAt} stale={stale} label={<><Num>{formatNumber(live.length, 0)}</Num> فرصت زنده</>} sourceName="API مرکل" />
            )}
          </div>
        </div>
        <button type="button" onClick={refresh} className="tap inline-flex items-center gap-1.5 rounded-lg px-3 min-h-10 text-sm text-secondary hover:text-primary hover:bg-elevated">
          <RefreshCw size={14} aria-hidden /> به‌روزرسانی
        </button>
      </header>

      <SectionSwitch current="merkl" />

      <div className="sticky top-14 z-20 -mx-[var(--space-page-x)] px-[var(--space-page-x)] py-2 bg-canvas/95 backdrop-blur">
        <Segmented
          value={st.tab}
          onChange={(tab) => patch({ tab })}
          label="نما"
          options={[
            { id: 'discover', label: <><Compass size={15} aria-hidden /> کشف فرصت‌ها</> },
            { id: 'mine', label: <><Wallet size={15} aria-hidden /> برای سرمایه‌ی من</> },
          ]}
        />
      </div>

      <MerklFilterBar list={live} f={st.filters} setF={(filters) => patch({ filters })} shown={filtered.length} total={live.length} />

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : failed ? (
        <p className="text-sm text-secondary">دریافت از Merkl ممکن نشد. چند دقیقه‌ی دیگر «به‌روزرسانی» را بزنید.</p>
      ) : st.tab === 'discover' ? (
        <DiscoverBoard list={filtered} by={st.sort} setBy={(sort) => patch({ sort })} />
      ) : (
        <MineBoard list={filtered} s={st.mine} setS={(p) => patch({ mine: sane({ ...st.mine, ...p }, st.mine) })} minDays={st.filters.minDays} />
      )}

      <p className="text-xs text-muted leading-6">
        داده‌ها از{' '}
        <a href="https://app.merkl.xyz" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          Merkl
        </a>
        . APR و پاداش‌ها با TVL، قیمت توکن و تمدید کمپین‌ها تغییر می‌کنند؛ پوینت و توکن پیش از TGE ارزش دلاری قطعی ندارند. اعداد تخمینی‌اند و توصیه‌ی مالی نیستند.
      </p>
    </main>
  );
}
