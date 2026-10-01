'use client';

import type { ReactNode } from 'react';
import { formatNumber } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

/** The one filled action of a row (enter the market). */
export const primaryAction = 'tap inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-4 min-h-11 text-sm font-medium text-white hover:brightness-110 active:brightness-95 transition';
/** Secondary actions beside it: same height, outlined. */
export const secondaryAction = 'tap inline-flex items-center justify-center gap-1.5 rounded-md border border-strong bg-white/[0.03] px-3 min-h-11 text-sm font-medium text-secondary hover:text-primary hover:bg-hover transition-colors';

/** Rank before the logo: the first three stand out. */
export function Rank({ n }: { n: number }) {
  return <span className={`grid place-items-center size-6 shrink-0 rounded-full text-[11px] font-semibold num ${n <= 3 ? 'bg-accent/15 text-accent' : 'bg-hover text-muted'}`}>{formatNumber(n, 0)}</span>;
}

/** Up to three headline figures in equal tiles. */
export function Stats({ items }: { items: { label: string; value: ReactNode; tone?: string }[] }) {
  return (
    <dl className="grid grid-flow-col auto-cols-fr gap-px overflow-hidden rounded-lg border border-default bg-default">
      {items.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5 bg-canvas px-2.5 py-2 min-w-0">
          <dt className="text-[11px] text-muted truncate">{s.label}</dt>
          <dd className={`text-sm font-semibold leading-tight truncate ${s.tone ?? 'text-primary'}`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Label/value pairs in two columns; a long value takes the full width. */
export function Facts({ items }: { items: ({ label: ReactNode; value: ReactNode; tone?: string; wide?: boolean } | false | null | undefined)[] }) {
  const list = items.filter(Boolean) as { label: ReactNode; value: ReactNode; tone?: string; wide?: boolean }[];
  if (!list.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {list.map((f, i) => (
        <div key={i} className={`flex items-baseline justify-between gap-2 min-w-0 border-b border-default/60 pb-1.5 ${f.wide ? 'col-span-2' : ''}`}>
          <dt className="text-muted shrink-0">{f.label}</dt>
          <dd className={`text-left min-w-0 ${f.tone ?? 'text-primary'}`}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Status chips that wrap onto as many lines as needed, never past the card. */
export function Tags({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5 [&>span]:whitespace-normal">{children}</div>;
}

export const Count = ({ n }: { n: number }) => (
  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-normal text-secondary">
    <Num>{formatNumber(n, 0)}</Num>
  </span>
);
