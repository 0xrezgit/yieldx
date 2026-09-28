'use client';

import type { ReactNode } from 'react';
import { Clock, Gift, Repeat } from 'lucide-react';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { isLoopable } from '../../lib/risk/opportunities';
import { formatNumber, formatPercent, formatUSDCompact } from '../../lib/utils/formatting';
import protocols from '../../config/protocols.json';
import { TokenLogo } from '../ui/token-logo';
import { Num } from '../ui/num';
import type { Tone } from '../ui/badge';

/**
 * An inequality such as «Implied ≤ 12%», isolated as one LTR run: inside RTL text
 * the bidi algorithm would mirror ≤/≥ next to Latin labels and flip their meaning.
 * `x` may be infinite or null: for ≤, +∞ means any value qualifies and null/−∞ none;
 * for ≥ it is the other way round.
 */
export function Bound({ label, op, x, digits = 2, percent = true, className = '' }: { label: string; op: '≤' | '≥'; x: number | null; digits?: number; percent?: boolean; className?: string }) {
  const any = op === '≤' ? x === Infinity : x === -Infinity;
  if (any) return <span className={className}>با هر نرخی</span>;
  if (x === null || !Number.isFinite(x)) return <span className={className}>{op === '≤' ? 'هیچ نرخی' : 'ممکن نیست'}</span>;
  return (
    <bdi dir="ltr" className={`num ${className}`}>
      {label} {op} {percent ? formatPercent(x, digits) : formatNumber(x, digits)}
    </bdi>
  );
}

export const signedPct = (x: number, digits = 1) => formatPercent(x, digits, true);

export function Pill({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  const cls: Record<Tone, string> = {
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/12 text-warning',
    danger: 'bg-danger/12 text-danger',
    info: 'bg-info/12 text-info',
    accent: 'bg-accent/15 text-accent',
    muted: 'bg-elevated text-secondary',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls[tone]}`}>{children}</span>;
}

/** Logo, name and the facts that matter for every strategy. */
export function MarketHead({ m, size = 40 }: { m: OpportunityListing; size?: number }) {
  const season = m.points?.season;
  return (
    <div className="flex items-center gap-3 min-w-0">
      <TokenLogo src={m.icon} name={m.name} size={size} />
      <div className="min-w-0">
        <div className="font-bold text-primary truncate" dir="ltr">
          {m.name}
        </div>
        <div className="text-xs text-muted truncate">
          {protocols[m.protocol].name} · {m.chain}
          {m.platform ? ` · ${m.platform}` : ''}
        </div>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <Pill>
            <Clock size={11} /> <Num>{formatNumber(m.daysToMaturity, 0)}</Num> روز
          </Pill>
          {m.liquidity !== null && (
            <Pill>
              <Num>{formatUSDCompact(m.liquidity)}</Num>
            </Pill>
          )}
          {m.hasPoints && (
            <Pill tone="warning">
              <Gift size={11} /> {m.points?.name ?? 'پوینت'}
              {m.points && m.points.ytMultiplier !== 1 && <Num>×{formatNumber(m.points.ytMultiplier, 1)}</Num>}
              {season != null && (
                <>
                  {' '}
                  · فصل <Num>{formatNumber(season, 0)}</Num>
                </>
              )}
            </Pill>
          )}
          {isLoopable(m) && (
            <Pill tone="accent">
              <Repeat size={11} /> لوپ
            </Pill>
          )}
        </div>
      </div>
    </div>
  );
}

export interface Segment {
  to: number;
  cls: string;
}

/**
 * A horizontal rate scale from 0 to `max` split into coloured segments, with a
 * marker for today's rate. Rates grow left → right (LTR like the charts).
 */
export function RangeBar({ segments, marker, max, label }: { segments: Segment[]; marker: number; max: number; label: string }) {
  const pos = (x: number) => `${Math.min(100, Math.max(0, (x / max) * 100))}%`;
  let from = 0;
  return (
    <div dir="ltr" className="relative h-2.5 rounded-full bg-elevated overflow-visible" role="img" aria-label={label}>
      {segments.map((s, i) => {
        const left = pos(from);
        const width = `${Math.max(0, Math.min(100, (s.to / max) * 100) - Math.min(100, (from / max) * 100))}%`;
        from = Math.max(from, s.to);
        return <span key={i} className={`absolute inset-y-0 ${s.cls} ${i === 0 ? 'rounded-l-full' : ''}`} style={{ left, width }} />;
      })}
      <span
        className="absolute -top-1 h-4.5 w-1 -translate-x-1/2 rounded-full bg-primary ring-2 ring-base"
        style={{ left: pos(marker) }}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-elevated/60 border border-default overflow-x-auto" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 whitespace-nowrap flex items-center justify-center gap-1.5 rounded-lg transition-colors ${
            size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-3 py-2'
          } ${value === o.id ? 'bg-surface text-primary shadow font-bold' : 'text-secondary hover:text-primary'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small label/value pair. */
export function Metric({ label, children, tone, hint }: { label: string; children: ReactNode; tone?: string; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className={`font-bold leading-tight ${tone ?? 'text-primary'}`}>{children}</div>
      {hint && <div className="text-[11px] text-secondary truncate">{hint}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { cls: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <i className={`inline-block w-3 h-1.5 rounded ${i.cls}`} /> {i.label}
        </span>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-strong p-8 text-center text-secondary text-sm">{children}</div>;
}
