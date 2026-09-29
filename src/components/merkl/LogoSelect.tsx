'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { formatNumber, normalizeSearch } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

export interface LogoOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Plain text matched by the search box. */
  search: string;
  icon: ReactNode;
  count?: number;
}

/**
 * A select whose options carry a logo or icon — native <select> cannot show images.
 * Opens as a list under the button; long lists get a search box. Escape or a click
 * outside closes it and returns focus to the button.
 */
export function LogoSelect<T extends string | number>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: LogoOption<T>[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const n = normalizeSearch(q);
    return n ? options.filter((o) => normalizeSearch(o.search).includes(n)) : options;
  }, [options, q]);

  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
    setQ('');
    button.current?.focus();
  };

  return (
    <div ref={box} className="relative flex flex-col gap-1.5 min-w-0">
      <span className="text-sm text-secondary">{label}</span>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen(!open)}
        className="tap flex items-center gap-2 w-full min-h-11 px-2.5 rounded-md border border-control bg-elevated text-[15px] text-primary text-right hover:border-strong"
      >
        <span className="shrink-0 grid place-items-center">{current?.icon}</span>
        <span className="flex-1 min-w-0 truncate">{current?.label}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute top-full inset-x-0 z-40 mt-1 min-w-[15rem] rounded-lg border border-default bg-surface sx-pop overflow-hidden">
          {options.length > 8 && (
            <div className="relative p-2 border-b border-default">
              <Search size={15} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
              <input autoFocus type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو" aria-label={`جست‌وجوی ${label}`} className="w-full pr-8 pl-2 text-sm" />
            </div>
          )}
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {shown.map((o) => {
              const selected = o.value === value;
              return (
                <li key={String(o.value)} role="option" aria-selected={selected}>
                  <button type="button" onClick={() => pick(o.value)} className={`w-full flex items-center gap-2.5 px-3 min-h-10 text-sm text-right hover:bg-elevated ${selected ? 'text-primary font-semibold' : 'text-secondary'}`}>
                    <span className="shrink-0 grid place-items-center">{o.icon}</span>
                    <span className="flex-1 min-w-0 truncate">{o.label}</span>
                    {o.count !== undefined && <Num className="text-xs text-muted">{formatNumber(o.count, 0)}</Num>}
                    {selected && <Check size={14} className="text-accent shrink-0" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">موردی پیدا نشد</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
