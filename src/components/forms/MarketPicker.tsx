'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Gift, Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import type { MarketListing } from '../../types/market';
import { formatCompact, formatDate, formatNumber, formatPercent, formatUSDCompact } from '../../lib/utils/formatting';
import { TokenLogo } from '../ui/token-logo';
import { Num } from '../ui/num';

type SortKey = 'liquidity' | 'apy' | 'maturity';
type Filter = { kind: 'all' } | { kind: 'points' } | { kind: 'new' } | { kind: 'chain'; value: string } | { kind: 'tag'; value: string };

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'liquidity', label: 'نقدینگی' },
  { id: 'apy', label: 'نرخ' },
  { id: 'maturity', label: 'سررسید' },
];

const TAG_LABEL: Record<string, string> = {
  stables: 'استیبل',
  stablecoins: 'استیبل',
  eth: 'ETH',
  btc: 'BTC',
  sol: 'SOL',
  rwa: 'RWA',
  staking: 'استیکینگ',
  restaking: 'ری‌استیکینگ',
  'blue-chips': 'بلوچیپ',
  lst: 'LST',
  lrt: 'LRT',
};

interface Props {
  open: boolean;
  onClose: () => void;
  markets: MarketListing[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  protocolName: string;
  updatedAt: number | null;
}

/** Searchable, filterable market list: bottom sheet on mobile, dialog on desktop. */
export function MarketPicker({ open, onClose, markets, loading, selectedId, onSelect, protocolName, updatedAt }: Props) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [sort, setSort] = useState<SortKey>('liquidity');
  const [showExpired, setShowExpired] = useState(false);

  // Lock page scroll, close on Escape, focus search on desktop.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    if (window.matchMedia('(min-width: 1024px)').matches) searchRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const active = useMemo(() => markets.filter((m) => !m.expired), [markets]);
  const expiredCount = markets.length - active.length;

  const chips = useMemo(() => {
    const chains = [...new Set(active.map((m) => m.chain))];
    const tagCount = new Map<string, number>();
    for (const m of active) for (const t of m.categories) if (t !== 'points') tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
    return { chains: chains.length > 1 ? chains : [], tags };
  }, [active]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = showExpired ? markets : active;
    const rows = pool.filter((m) => {
      if (q && !`${m.name} ${m.platform ?? ''} ${m.chain} ${m.categories.join(' ')}`.toLowerCase().includes(q)) return false;
      switch (filter.kind) {
        case 'points':
          return m.hasPoints;
        case 'new':
          return m.isNew;
        case 'chain':
          return m.chain === filter.value;
        case 'tag':
          return m.categories.includes(filter.value);
        default:
          return true;
      }
    });
    const by: Record<SortKey, (a: MarketListing, b: MarketListing) => number> = {
      liquidity: (a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1),
      apy: (a, b) => b.impliedAPY - a.impliedAPY,
      maturity: (a, b) => a.daysToMaturity - b.daysToMaturity,
    };
    return rows.sort((a, b) => Number(a.expired) - Number(b.expired) || by[sort](a, b));
  }, [markets, active, query, filter, sort, showExpired]);

  if (!open) return null;

  const pick = (m: MarketListing) => {
    if (m.expired) return;
    onSelect(m.id);
    onClose();
  };

  const chip = (f: Filter, label: ReactNode, key: string) => {
    const on = JSON.stringify(f) === JSON.stringify(filter);
    return (
      <button
        key={key}
        type="button"
        onClick={() => setFilter(on ? { kind: 'all' } : f)}
        className={`shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-sm border transition-colors ${
          on ? 'border-accent bg-accent/20 text-primary' : 'border-strong text-secondary hover:text-primary'
        }`}
      >
        {label}
      </button>
    );
  };

  // Rendered into <body>: the picker opens from a sticky side panel, whose own
  // stacking context would otherwise let later page content paint over the dialog.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="بستن" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="absolute inset-x-0 bottom-0 top-8 rounded-t-3xl lg:inset-x-auto lg:bottom-auto lg:top-[7vh] lg:left-1/2 lg:-translate-x-1/2 lg:w-[48rem] lg:h-[84vh] lg:rounded-3xl
          bg-surface border border-default shadow-2xl shadow-black/60 flex flex-col overflow-hidden"
      >
        {/* Grab handle (mobile) */}
        <div className="lg:hidden flex justify-center pt-2.5">
          <span className="h-1.5 w-10 rounded-full bg-strong" />
        </div>

        <header className="px-4 lg:px-6 pt-3 lg:pt-5 pb-3 flex flex-col gap-3 border-b border-default">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-extrabold text-primary">
                بازارهای {protocolName}
              </h2>
              <p className="text-xs text-muted flex items-center gap-1.5">
                {loading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> در حال دریافت…
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} /> <Num>{formatNumber(active.length, 0)}</Num> بازار فعال · به‌روزرسانی خودکار
                    {updatedAt && (
                      <>
                        {' '}
                        · <Num>{new Date(updatedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</Num>
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="بستن" className="p-2 rounded-xl text-secondary hover:text-primary hover:bg-elevated">
              <X size={20} />
            </button>
          </div>

          <div className="relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && list[0] && pick(list[0])}
              placeholder="جستجوی توکن، پروژه یا شبکه"
              aria-label="جستجو"
              className="w-full bg-elevated/70 border border-strong rounded-xl pr-10 pl-3 py-2.5 text-base focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 lg:-mx-6 lg:px-6 pb-0.5">
            {chip({ kind: 'all' }, 'همه', 'all')}
            {chip({ kind: 'points' }, <><Gift size={13} /> پوینت‌دار</>, 'points')}
            {active.some((m) => m.isNew) && chip({ kind: 'new' }, <><Sparkles size={13} /> جدید</>, 'new')}
            {chips.chains.map((c) => chip({ kind: 'chain', value: c }, c, `c-${c}`))}
            {chips.tags.map((t) => chip({ kind: 'tag', value: t }, TAG_LABEL[t] ?? t, `t-${t}`))}
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              <Num>{formatNumber(list.length, 0)}</Num> نتیجه
            </span>
            <div className="flex gap-1 p-1 rounded-xl bg-elevated/60 border border-default" role="radiogroup" aria-label="مرتب‌سازی">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={sort === s.id}
                  onClick={() => setSort(s.id)}
                  className={`rounded-lg px-3 py-1 transition-colors ${sort === s.id ? 'bg-surface text-primary shadow' : 'text-secondary'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <ul className="flex-1 overflow-y-auto overscroll-contain p-2 lg:p-3">
          {loading && !markets.length &&
            Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 p-3">
                <span className="size-10 rounded-full bg-elevated animate-pulse" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/3 rounded bg-elevated animate-pulse" />
                  <span className="block h-2.5 w-1/2 rounded bg-elevated animate-pulse" />
                </span>
              </li>
            ))}

          {!loading && list.length === 0 && (
            <li className="py-16 text-center text-secondary">بازاری با این فیلتر پیدا نشد.</li>
          )}

          {list.map((m) => (
            <li key={m.id}>
              <MarketRow m={m} selected={m.id === selectedId} onPick={() => pick(m)} />
            </li>
          ))}
        </ul>

        {expiredCount > 0 && (
          <footer className="border-t border-default px-4 lg:px-6 py-3 bottom-safe">
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} className="accent-accent size-4" />
              نمایش <Num>{formatNumber(expiredCount, 0)}</Num> بازار منقضی
            </label>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

function MarketRow({ m, selected, onPick }: { m: MarketListing; selected: boolean; onPick: () => void }) {
  const gap = m.baseAPY === null ? null : m.impliedAPY - m.baseAPY;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={m.expired}
      aria-current={selected || undefined}
      className={`w-full flex items-center gap-3 rounded-2xl p-3 text-right transition-colors ${
        selected ? 'bg-accent/15 ring-1 ring-accent/50' : 'hover:bg-elevated/70'
      } ${m.expired ? 'opacity-45 cursor-not-allowed' : ''}`}
    >
      <TokenLogo src={m.icon} name={m.name} size={42} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-bold text-primary truncate" dir="ltr">
            {m.name}
          </span>
          {selected && <Check size={15} className="text-accent shrink-0" />}
        </div>
        <div className="text-xs text-muted truncate">
          {m.platform ? `${m.platform} · ` : ''}
          {m.chain}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {m.expired ? (
            <Tag cls="bg-danger/15 text-danger">منقضی</Tag>
          ) : (
            <Tag cls="bg-elevated text-secondary">
              <Clock size={11} /> <Num>{formatNumber(m.daysToMaturity, 0)}</Num> روز · {formatDate(m.maturity)}
            </Tag>
          )}
          {m.hasPoints && (
            <Tag cls="bg-st-yt/15 text-st-yt">
              <Gift size={11} /> پوینت
              {m.ytMultiplier !== null && (
                <>
                  {' '}
                  <Num>×{formatNumber(m.ytMultiplier, 0)}</Num>
                </>
              )}
            </Tag>
          )}
          {m.isNew && !m.expired && (
            <Tag cls="bg-brand2/15 text-brand2">
              <Sparkles size={11} /> جدید
            </Tag>
          )}
        </div>
      </div>

      <div className="text-left shrink-0">
        <div className="text-lg font-extrabold text-primary leading-tight">
          <Num>{formatPercent(m.impliedAPY, 2)}</Num>
        </div>
        <div className="text-[11px] text-muted">نرخ ثابت</div>
        {m.baseAPY !== null && (
          <div className={`text-xs ${gap !== null && gap > 0 ? 'text-warning' : 'text-success'}`}>
            پایه <Num>{formatPercent(m.baseAPY, 1)}</Num>
          </div>
        )}
        {m.liquidity !== null && (
          <div className="text-xs text-secondary">
            <Num>{m.liquidity >= 1000 ? formatUSDCompact(m.liquidity) : formatCompact(m.liquidity)}</Num>
          </div>
        )}
      </div>
    </button>
  );
}

function Tag({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}
