'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Gift, Loader2, Search, Sparkles, X } from 'lucide-react';
import type { MarketListing } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import { formatDate, formatNumber, formatPercent, formatUSDCompact, normalizeSearch } from '../../lib/utils/formatting';
import { networkByName } from '../../lib/registry/networks';
import { protocolIdentity } from '../../lib/registry/identity';
import { LogoWithNetwork } from '../ui/asset-identity';
import { DataStatus } from '../ui/data-status';
import { Num } from '../ui/num';

type Row = MarketListing & { protocol?: ProtocolId };
type SortKey = 'liquidity' | 'apy' | 'maturity';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'liquidity', label: 'نقدینگی' },
  { id: 'apy', label: 'نرخ ثابت' },
  { id: 'maturity', label: 'سررسید' },
];

export const TAG_LABEL: Record<string, string> = {
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

/** Everything a row can be found by: symbol, project, protocol, network (English + Persian), market id and token address. */
export function searchText(m: Row): string {
  const net = networkByName(m.chain);
  return normalizeSearch(
    [m.name, m.platform ?? '', m.protocol ? protocolIdentity(m.protocol).name : '', m.protocol ? protocolIdentity(m.protocol).nameFa : '', m.chain, net.nameFa, m.id, m.asset?.address ?? '', m.asset?.symbol ?? '', m.categories.join(' ')].join(' '),
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  markets: Row[];
  loading: boolean;
  selectedId: string;
  onSelect: (m: Row) => void;
  title: string;
  updatedAt: number | null;
  stale?: boolean;
  /** Show the protocol on each row (cross-protocol lists). */
  showProtocol?: boolean;
}

/** Searchable market list: bottom sheet on mobile, dialog on desktop. Focus is trapped and returned. */
export function MarketPicker({ open, onClose, markets, loading, selectedId, onSelect, title, updatedAt, stale = false, showProtocol = false }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [chain, setChain] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [pointsOnly, setPointsOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('liquidity');
  const [showExpired, setShowExpired] = useState(false);

  // Every open starts clean: a search typed for another protocol must not hide this list.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setChain(null);
    setTag(null);
    setPointsOnly(false);
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => searchRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      // Deferred: returning focus during the key event that closed the dialog would let
      // that same Enter press re-open it from the trigger button.
      requestAnimationFrame(() => opener?.focus?.());
    };
  }, [open, onClose]);

  const active = useMemo(() => markets.filter((m) => !m.expired), [markets]);
  const expiredCount = markets.length - active.length;

  const facets = useMemo(() => {
    const chainCount = new Map<string, number>();
    const tagCount = new Map<string, number>();
    for (const m of active) {
      chainCount.set(m.chain, (chainCount.get(m.chain) ?? 0) + 1);
      for (const t of m.categories) if (t !== 'points') tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
    return {
      chains: [...chainCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
      tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t),
    };
  }, [active]);

  const index = useMemo(() => new Map(markets.map((m) => [m, searchText(m)])), [markets]);
  // Same symbol more than once → the maturity (and network) are what tell rows apart.
  const dupNames = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of active) c.set(m.name, (c.get(m.name) ?? 0) + 1);
    return new Set([...c.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [active]);

  const list = useMemo(() => {
    const q = normalizeSearch(query);
    const rows = (showExpired ? markets : active).filter(
      (m) => (!q || q.split(' ').every((w) => index.get(m)?.includes(w))) && (!chain || m.chain === chain) && (!tag || m.categories.includes(tag)) && (!pointsOnly || m.hasPoints),
    );
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      liquidity: (a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1),
      apy: (a, b) => b.impliedAPY - a.impliedAPY,
      maturity: (a, b) => a.daysToMaturity - b.daysToMaturity,
    };
    return rows.sort((a, b) => Number(a.expired) - Number(b.expired) || by[sort](a, b));
  }, [markets, active, index, query, chain, tag, pointsOnly, sort, showExpired]);

  if (!open || typeof document === 'undefined') return null;

  const pick = (m: Row) => {
    if (m.expired) return;
    onSelect(m);
    onClose();
  };
  const filtersOn = !!(query || chain || tag || pointsOnly);

  // Rendered into <body>: the picker opens from inside cards whose stacking context would clip it.
  return createPortal(
    <div className="sx fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="بستن" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 top-6 rounded-t-2xl lg:inset-x-auto lg:bottom-auto lg:top-[6vh] lg:left-1/2 lg:-translate-x-1/2 lg:w-[52rem] lg:h-[86vh] lg:rounded-2xl
          bg-surface border border-default shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="px-4 lg:px-6 pt-4 pb-3 flex flex-col gap-3 border-b border-default">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <h2 id={titleId} className="text-lg font-semibold text-primary">
                {title}
              </h2>
              {loading && !markets.length ? (
                <p className="text-sm text-secondary flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> در حال دریافت بازارها…
                </p>
              ) : (
                <DataStatus source="api" fetchedAt={updatedAt} stale={stale} label={<><Num>{formatNumber(active.length, 0)}</Num> بازار فعال</>} />
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="بستن" className="tap grid place-items-center size-10 rounded-lg text-secondary hover:text-primary hover:bg-elevated">
              <X size={20} />
            </button>
          </div>

          <div className="relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              ref={searchRef}
              type="search" dir="auto"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && list[0]) {
                  e.preventDefault();
                  pick(list[0]);
                }
              }}
              placeholder="نماد، پروژه، شبکه یا آدرس"
              aria-label="جست‌وجوی بازار"
              className="w-full bg-elevated border border-control rounded-lg pr-10 pl-3 min-h-11 text-base"
            />
          </div>

          {facets.chains.length > 1 && (
            <ChipRow label="شبکه">
              {facets.chains.map((c) => (
                <Chip key={c} on={chain === c} onClick={() => setChain(chain === c ? null : c)}>
                  {networkByName(c).nameFa}
                </Chip>
              ))}
            </ChipRow>
          )}
          <ChipRow label="دسته">
            <Chip on={pointsOnly} onClick={() => setPointsOnly(!pointsOnly)}>
              <Gift size={13} aria-hidden /> پوینت‌دار
            </Chip>
            {facets.tags.map((t) => (
              <Chip key={t} on={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                {TAG_LABEL[t] ?? t}
              </Chip>
            ))}
          </ChipRow>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-secondary" aria-live="polite">
              <Num>{formatNumber(list.length, 0)}</Num> نتیجه
              {filtersOn && (
                <button
                  type="button"
                  className="tap mr-2 text-accent underline underline-offset-4"
                  onClick={() => {
                    setQuery('');
                    setChain(null);
                    setTag(null);
                    setPointsOnly(false);
                  }}
                >
                  پاک‌کردن فیلترها
                </button>
              )}
            </span>
            <div className="seg" role="radiogroup" aria-label="مرتب‌سازی">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={sort === s.id}
                  onClick={() => setSort(s.id)}
                  className="tap px-3 min-h-9"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <ul className="flex-1 overflow-y-auto overscroll-contain p-2 lg:p-3" aria-label="بازارها">
          {loading &&
            !markets.length &&
            Array.from({ length: 7 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 p-3 h-[72px]" aria-hidden>
                <span className="size-8 rounded-full bg-elevated animate-pulse" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/3 rounded bg-elevated animate-pulse" />
                  <span className="block h-2.5 w-1/2 rounded bg-elevated animate-pulse" />
                </span>
              </li>
            ))}
          {!loading && list.length === 0 && <li className="py-16 text-center text-secondary">بازاری با این جست‌وجو یا فیلتر پیدا نشد.</li>}
          {list.map((m) => (
            <li key={`${m.protocol ?? ''}:${m.id}`}>
              <MarketRow m={m} selected={m.id === selectedId} dup={dupNames.has(m.name)} showProtocol={showProtocol} onPick={() => pick(m)} />
            </li>
          ))}
        </ul>

        {expiredCount > 0 && (
          <footer className="border-t border-default px-4 lg:px-6 py-3 bottom-safe">
            <label className="flex items-center gap-2 text-sm text-secondary min-h-11">
              <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
              نمایش <Num>{formatNumber(expiredCount, 0)}</Num> بازار سررسیدشده
            </label>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-muted shrink-0 w-10">{label}</span>
      <div className="strip flex gap-1.5 min-w-0" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`tap shrink-0 inline-flex items-center gap-1 rounded-full px-3 min-h-8 text-sm border transition-colors ${
        on ? 'border-accent bg-accent/15 text-primary' : 'border-default text-secondary hover:text-primary'
      }`}
    >
      {on && <Check size={13} aria-hidden />}
      {children}
    </button>
  );
}

function MarketRow({ m, selected, dup, showProtocol, onPick }: { m: Row; selected: boolean; dup: boolean; showProtocol: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={m.expired}
      aria-current={selected || undefined}
      className={`w-full flex items-center gap-3 rounded-lg p-3 min-h-[72px] text-right transition-colors ${
        selected ? 'bg-accent/12 ring-1 ring-accent/50' : 'hover:bg-hover'
      } ${m.expired ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <LogoWithNetwork icon={m.icon} name={m.name} chain={m.chain} size={32} />
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <bdi dir="ltr" className="font-semibold text-primary truncate">
            {m.name}
          </bdi>
          {selected && <Check size={15} className="text-accent shrink-0" aria-label="انتخاب‌شده" />}
        </div>
        <div className="text-xs text-secondary truncate">
          {[showProtocol && m.protocol ? protocolIdentity(m.protocol).name : null, networkByName(m.chain).nameFa, m.platform].filter(Boolean).join(' · ')}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {m.expired ? (
            <span className="text-danger">سررسیدشده</span>
          ) : (
            <span className={`inline-flex items-center gap-1 ${dup ? 'text-primary font-semibold' : 'text-secondary'}`}>
              <Clock size={12} aria-hidden /> {formatDate(m.maturity)} · <Num>{formatNumber(m.daysToMaturity, 0)}</Num> روز
            </span>
          )}
          {m.hasPoints && (
            <span className="inline-flex items-center gap-1 text-st-yt">
              <Gift size={12} aria-hidden /> پوینت
              {m.ytMultiplier !== null && <Num>×{formatNumber(m.ytMultiplier, 0)}</Num>}
            </span>
          )}
          {m.isNew && !m.expired && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Sparkles size={12} aria-hidden /> جدید
            </span>
          )}
        </div>
      </div>
      <div className="text-left shrink-0 flex flex-col items-end gap-0.5">
        <Num className="text-base font-semibold text-primary">{formatPercent(m.impliedAPY, 2)}</Num>
        <span className="text-xs text-muted">نرخ ثابت</span>
        <span className="text-xs text-secondary">{m.liquidity !== null ? <Num>{formatUSDCompact(m.liquidity)}</Num> : 'نقدینگی —'}</span>
      </div>
    </button>
  );
}
