'use client';

import { Fragment, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Calculator, ChevronDown } from 'lucide-react';
import { formatNumber } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

export interface Column<R> {
  id: string;
  header: ReactNode;
  cell: (r: R) => ReactNode;
  /** Numeric sort key; null/NaN always sorts last. */
  sort?: (r: R) => number | null;
  /** Explanation button, rendered beside (not inside) the sort button. */
  help?: ReactNode;
  className?: string;
}

interface Props<R> {
  rows: R[];
  rowKey: (r: R) => string;
  /** First column: asset + network identity. */
  identity: (r: R) => ReactNode;
  columns: Column<R>[];
  /** Expanded row / card body. */
  details: (r: R) => ReactNode;
  onAction: (r: R) => void;
  actionLabel: string;
  /** Mobile card: the key result line and the main warning. */
  mobile: (r: R) => { result: ReactNode; sub?: ReactNode; warning?: ReactNode; meta?: ReactNode };
  caption: string;
  defaultSort?: { id: string; dir: 1 | -1 } | null;
  pageSize?: number;
  /** Icon of the action button (default: calculator). */
  actionIcon?: ReactNode;
  /** Header of the identity column. */
  identityHeader?: string;
}

/**
 * Sortable comparison table (desktop ≥ 1024px) with the header sticky under the app
 * header — page scroll only, no inner scroll area — and expandable rows for details.
 * Below 1024px the same rows become summary cards that open on tap.
 */
export function MarketTable<R>({ rows, rowKey, identity, columns, details, onAction, actionLabel, mobile, caption, defaultSort = null, pageSize = 25, actionIcon, identityHeader = 'دارایی و شبکه' }: Props<R>) {
  const [sort, setSort] = useState(defaultSort);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(pageSize);
  const base = useId();

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const key = col.sort;
    return [...rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const bad = (v: number | null) => v === null || Number.isNaN(v);
      if (bad(x) && bad(y)) return 0;
      if (bad(x)) return 1;
      if (bad(y)) return -1;
      return ((x as number) - (y as number)) * sort.dir;
    });
  }, [rows, columns, sort]);

  const page = sorted.slice(0, shown);
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop table */}
      <table className="hidden lg:table w-full text-sm border-separate border-spacing-0">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky below-header z-10 bg-elevated text-right font-normal text-secondary px-2 xl:px-3 py-2.5 border-y border-default first:rounded-tr-lg first:border-r">
              {identityHeader}
            </th>
            {columns.map((c) => {
              const active = sort?.id === c.id;
              return (
                <th key={c.id} scope="col" aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined} className={`sticky below-header z-10 bg-elevated text-right font-normal text-secondary px-2 xl:px-3 py-2.5 border-y border-default leading-5 align-bottom ${c.className ?? ''}`}>
                  {c.sort ? (
                    <button type="button" onClick={() => setSort({ id: c.id, dir: active ? (sort!.dir === 1 ? -1 : 1) : -1 })} className={`inline-flex items-center gap-1 min-h-8 hover:text-primary ${active ? 'text-primary font-semibold' : ''}`}>
                      {c.header}
                      {active ? sort!.dir === 1 ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden /> : <ArrowUpDown size={13} className="opacity-50" aria-hidden />}
                    </button>
                  ) : (
                    c.header
                  )}
                  {c.help}
                </th>
              );
            })}
            <th scope="col" className="sticky below-header z-10 bg-elevated px-3 py-2.5 border-y border-l border-default rounded-tl-lg">
              <span className="sr-only">اقدام</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {page.map((r) => {
            const k = rowKey(r);
            const isOpen = open === k;
            const detailsId = `${base}-${k}`;
            return (
              <Fragment key={k}>
                <tr className={`bg-surface hover:bg-elevated/60 ${isOpen ? 'bg-elevated/60' : ''}`}>
                  <td className="px-2 xl:px-3 py-3 border-b border-r border-default max-w-[13rem] xl:max-w-[16rem]">{identity(r)}</td>
                  {columns.map((c) => (
                    <td key={c.id} className={`px-2 xl:px-3 py-3 border-b border-default align-middle ${c.className ?? ''}`}>
                      {c.cell(r)}
                    </td>
                  ))}
                  <td className="px-2 xl:px-3 py-3 border-b border-l border-default whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => onAction(r)} className="tap inline-flex items-center gap-1.5 rounded-lg bg-brand text-on-brand px-3 min-h-9 text-sm font-semibold">
                        {actionIcon ?? <Calculator size={14} aria-hidden />} {actionLabel}
                      </button>
                      <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} aria-controls={detailsId} aria-label="جزئیات" className="tap grid place-items-center size-9 rounded-lg text-secondary hover:text-primary hover:bg-elevated">
                        <ChevronDown size={18} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr id={detailsId}>
                    <td colSpan={columns.length + 2} className="bg-canvas px-4 py-4 border-b border-x border-default">
                      {details(r)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Mobile / tablet cards */}
      <ul className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {page.map((r) => {
          const k = rowKey(r);
          const isOpen = open === k;
          const mb = mobile(r);
          return (
            <li key={k} className={`sx-card p-4 flex flex-col gap-3 min-w-0 ${isOpen ? 'md:col-span-2' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex flex-col gap-1">
                  {identity(r)}
                  {mb.meta && <div className="meta text-xs text-secondary">{mb.meta}</div>}
                </div>
                <div className="text-left shrink-0 flex flex-col items-end">
                  {mb.result}
                  {mb.sub && <span className="text-xs text-secondary">{mb.sub}</span>}
                </div>
              </div>
              {mb.warning && <div className="text-xs text-warning">{mb.warning}</div>}
              <div className="flex gap-2">
                <button type="button" onClick={() => onAction(r)} className="tap flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-brand text-on-brand px-3 min-h-11 text-[15px] font-medium hover:brightness-110">
                  {actionIcon ?? <Calculator size={15} aria-hidden />} {actionLabel}
                </button>
                <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="tap inline-flex items-center justify-center gap-1 rounded-md border border-strong bg-white/[0.03] px-3 min-h-11 text-[15px] font-medium text-secondary hover:text-primary hover:bg-hover">
                  جزئیات <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
              </div>
              {isOpen && <div className="border-t border-default pt-3">{details(r)}</div>}
            </li>
          );
        })}
      </ul>

      {sorted.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + pageSize)} className="tap self-center rounded-md border border-strong bg-white/[0.03] px-4 min-h-11 text-sm font-medium text-primary hover:bg-hover">
          نمایش بیشتر (<Num>{formatNumber(shown, 0)}</Num> از <Num>{formatNumber(sorted.length, 0)}</Num>)
        </button>
      )}
    </div>
  );
}
