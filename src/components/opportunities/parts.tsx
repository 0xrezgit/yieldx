'use client';

import type { ReactNode } from 'react';
import { Gift, Repeat } from 'lucide-react';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { isLoopable } from '../../lib/risk/opportunities';
import { formatDate, formatGregorian, formatNumber, formatPercent, formatUSDCompact } from '../../lib/utils/formatting';
import { protocolIdentity } from '../../lib/registry/identity';
import type { ProtocolFeed } from '../../hooks/useAllMarkets';
import { AssetIdentity } from '../ui/asset-identity';
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
    muted: 'bg-hover text-secondary',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 min-h-6 text-xs font-medium whitespace-nowrap ${cls[tone]}`}>{children}</span>;
}

/** Identity for tables and cards: token + network badge, symbol, protocol · network · maturity. */
export function MarketIdentityCell({ m, size = 24 }: { m: OpportunityListing; size?: 24 | 32 }) {
  return <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} platform={m.platform} maturity={m.maturity} size={size} />;
}

/** Logo, name and the facts that matter for every strategy (details / cards). */
export function MarketHead({ m }: { m: OpportunityListing; size?: number }) {
  const season = m.points?.season;
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <MarketIdentityCell m={m} size={32} />
      <div className="flex items-center gap-1 flex-wrap">
        {m.platform && <Pill>پروژه: <bdi dir="ltr">{m.platform}</bdi></Pill>}
        {m.hasPoints && (
          <Pill tone="info">
            <Gift size={12} aria-hidden /> <bdi dir="ltr">{m.points?.name ?? 'پوینت'}</bdi>
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
            <Repeat size={12} aria-hidden /> لوپ
          </Pill>
        )}
      </div>
    </div>
  );
}

/** Below 1280px the protocol and data columns fold into the identity cell. */
export function CompactMeta({ m, feed }: { m: OpportunityListing; feed?: ProtocolFeed }) {
  return (
    <span className="xl:hidden flex flex-wrap items-center gap-x-1.5 text-xs text-secondary">
      <ProtocolCell m={m} />
      {feed?.stale && <span className="text-warning">· داده‌ی قدیمی</span>}
    </span>
  );
}

export const ProtocolCell = ({ m }: { m: OpportunityListing }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <TokenLogo src={protocolIdentity(m.protocol).logo} name={protocolIdentity(m.protocol).name} size={16} square />
    <bdi dir="ltr">{protocolIdentity(m.protocol).name}</bdi>
  </span>
);

export const MaturityCell = ({ m }: { m: OpportunityListing }) => (
  <span className="flex flex-col whitespace-nowrap" title={`میلادی: ${formatGregorian(m.maturity)}`}>
    <span className="text-primary">{formatDate(m.maturity)}</span>
    <span className="text-xs text-secondary">
      <Num>{formatNumber(m.daysToMaturity, 0)}</Num> روز
    </span>
  </span>
);

export const LiquidityCell = ({ m }: { m: OpportunityListing }) =>
  m.liquidity === null ? <span className="text-muted" title="نقدینگی در API این پروتکل نیست">—</span> : <Num>{formatUSDCompact(m.liquidity)}</Num>;

/** Freshness of the row's protocol feed, plus missing inputs — words, not only colour. */
export function DataCell({ m, feed, needsBase = false }: { m: OpportunityListing; feed?: ProtocolFeed; needsBase?: boolean }) {
  const stale = feed?.stale;
  const noBase = needsBase && (m.baseAPY === null || !Number.isFinite(m.baseAPY));
  return (
    <span className="flex flex-col gap-0.5 text-xs whitespace-nowrap">
      <span className={`inline-flex items-center gap-1 ${stale ? 'text-warning' : 'text-secondary'}`}>
        <span className={`size-1.5 rounded-full ${stale ? 'bg-warning' : 'bg-success'}`} aria-hidden />
        {stale ? 'قدیمی' : 'به‌روز'}
      </span>
      {noBase && <span className="text-warning">بازده پایه —</span>}
      {m.liquidity === null && <span className="text-muted">نقدینگی —</span>}
    </span>
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
        className="absolute -top-1 h-4.5 w-1 -translate-x-1/2 rounded-full bg-primary ring-2 ring-canvas"
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
    <div className={`seg ${options.length > 4 ? 'seg-scroll strip' : 'seg-fit'}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`tap [&>svg]:hidden sm:[&>svg]:inline ${size === 'sm' ? 'min-h-9 text-sm' : 'min-h-10 text-[15px]'}`}
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
      <div className="text-xs text-secondary truncate">{label}</div>
      <div className={`font-semibold leading-tight ${tone ?? 'text-primary'}`}>{children}</div>
      {hint && <div className="text-xs text-secondary truncate">{hint}</div>}
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
  return <div className="rounded-2xl border border-dashed border-strong px-6 py-10 text-center text-secondary text-sm">{children}</div>;
}
