'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Minus, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import type { Position } from '../../types/position';
import { KIND_LABEL, QUALITY_FA, QUALITY_TONE, STATUS_FA } from '../../lib/portfolio/labels';
import { AssetIdentity } from '../ui/asset-identity';
import type { Alert } from '../../lib/portfolio/analysis';
import type { PositionStatus, Quality } from '../../lib/portfolio/valuation';
import { dollarNumber, formatDollar } from '../../lib/portfolio/format';
import { EMPTY, formatDate, formatNumber, formatPercent } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

/*
 * Building blocks of the positions section, in a Stripe-inspired dark style:
 * hairline borders, 6–8px radii, light type, one violet accent. Gains are green,
 * losses red, warnings orange — always with an icon and a word as well.
 */

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent';

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-sx-green',
  warning: 'text-sx-orange',
  danger: 'text-sx-red',
  info: 'text-sx-blue',
  muted: 'text-sx-muted',
  accent: 'text-sx-accent',
};

const TONE_CHIP: Record<Tone, string> = {
  success: 'text-sx-green bg-sx-green/12',
  warning: 'text-sx-orange bg-sx-orange/12',
  danger: 'text-sx-red bg-sx-red/12',
  info: 'text-sx-blue bg-sx-blue/12',
  muted: 'text-sx-muted bg-sx-raised',
  accent: 'text-sx-accent bg-sx-accent/15',
};

export const btn = {
  primary:
    'tap inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-lg bg-sx-primary text-white text-[15px] font-semibold hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed',
  secondary:
    'tap inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-sx-accent/70 text-sx-text text-[15px] hover:bg-sx-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
  ghost:
    'tap inline-flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-lg text-sx-muted text-sm hover:text-sx-text hover:bg-sx-raised transition-colors disabled:opacity-40',
  danger: 'tap inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg text-sx-red text-sm hover:bg-sx-red/10 transition-colors',
};

export function Chip({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded text-xs font-medium whitespace-nowrap ${TONE_CHIP[tone]}`}>{children}</span>;
}

/** Amount in dollars: Persian digits, the word «دلار» after the number. */
export function Usd({ x, digits = 2, className = '' }: { x: number; digits?: number; className?: string }) {
  if (!Number.isFinite(x)) return <span className="text-sx-faint">{EMPTY}</span>;
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <Num>{dollarNumber(x, digits)}</Num> <span className="text-[max(12px,0.8em)] font-normal text-sx-muted">دلار</span>
    </span>
  );
}

export const usd = (x: number, digits = 2) => <Usd x={x} digits={digits} />;

/** Profit/loss: colour, arrow and word, so meaning never rests on colour alone. */
export function Pnl({ usd: x, pct, size = 'md', word = true }: { usd: number; pct?: number | null; size?: 'sm' | 'md' | 'lg'; word?: boolean }) {
  if (!Number.isFinite(x)) return <span className="text-sx-faint">{EMPTY}</span>;
  const up = x > 0.005;
  const down = x < -0.005;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const cls = up ? 'text-sx-green' : down ? 'text-sx-red' : 'text-sx-muted';
  const text = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className={`inline-flex items-center gap-1.5 font-normal ${cls} ${text}`}>
      <Icon size={size === 'lg' ? 18 : 14} aria-hidden />
      {word && <span className="text-xs">{up ? 'سود' : down ? 'زیان' : 'سربه‌سر'}</span>}
      <Usd x={x} />
      {pct !== undefined && pct !== null && Number.isFinite(pct) && <Num className="text-xs opacity-90">({formatPercent(pct, 2, true)})</Num>}
    </span>
  );
}

export function QualityBadge({ q, prefix }: { q: Quality; prefix?: string }) {
  return (
    <Chip tone={QUALITY_TONE[q]}>
      {prefix ? `${prefix}: ` : ''}
      {QUALITY_FA[q]}
    </Chip>
  );
}

export function StatusBadge({ s }: { s: PositionStatus }) {
  return (
    <Chip tone={s === 'open' ? 'accent' : s === 'matured' ? 'warning' : 'muted'}>
      <span className={`size-1.5 rounded-full ${s === 'open' ? 'bg-sx-accent' : s === 'matured' ? 'bg-sx-orange' : 'bg-sx-muted'}`} aria-hidden />
      {STATUS_FA[s]}
    </Chip>
  );
}

/** One figure: small label, value, optional note and data-quality tag. */
export function Stat({ label, children, q, hint, className = '' }: { label: string; children: ReactNode; q?: Quality; hint?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 flex flex-col gap-1 border-t border-sx-border pt-3 ${className}`}>
      <div className="text-xs text-sx-muted flex flex-wrap items-baseline justify-between gap-x-2 leading-5">
        <span>{label}</span>
        {q && q !== 'market' && q !== 'rule' && <span className={`text-xs ${TONE_TEXT[QUALITY_TONE[q]]}`}>{QUALITY_FA[q]}</span>}
      </div>
      <div className="text-[17px] font-normal text-sx-text leading-snug min-w-0">{children}</div>
      {hint && <div className="text-xs text-sx-faint">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? 'lg:grid-cols-4' : cols === 3 ? 'lg:grid-cols-3' : '';
  return <div className={`grid grid-cols-2 ${c} gap-x-6 gap-y-5`}>{children}</div>;
}

/** Section surface. */
export function Panel({ title, subtitle, icon, actions, children, className = '' }: { title?: string; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`sx-card p-4 md:p-6 min-w-0 flex flex-col gap-4 ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[17px] font-medium text-sx-text flex items-center gap-2">
                {icon && <span className="text-sx-accent shrink-0">{icon}</span>}
                {title}
              </h2>
            )}
            {subtitle && <p className="text-sm text-sx-muted mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Disclosure({ title, icon, badge, defaultOpen = false, children }: { title: string; icon?: ReactNode; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group sx-card min-w-0">
      <summary className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 min-h-13 rounded-2xl hover:bg-raised/50 transition-colors">
        <span className="text-[15px] font-medium text-sx-text flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-sx-accent">{icon}</span>}
          <span className="truncate">{title}</span>
          {badge}
        </span>
        <ChevronDown size={18} className="text-sx-muted transition-transform group-open:rotate-180 shrink-0" />
      </summary>
      <div className="px-4 md:px-6 pb-5 pt-1 flex flex-col gap-4">{children}</div>
    </details>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="seg seg-fit" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className="tap min-h-9 text-sm"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Position identity: underlying logo + network badge, PT/YT marker, protocol · network · maturity. */
export function MarketIdentity({ p, size = 44 }: { p: Pick<Position, 'protocol' | 'chain' | 'icon' | 'marketName' | 'platform' | 'maturity' | 'kind'>; size?: number }) {
  const s = size >= 44 ? 48 : size >= 32 ? 32 : 24;
  return <AssetIdentity symbol={p.marketName} icon={p.icon || null} chain={p.chain} protocol={p.protocol} platform={p.platform} maturity={p.maturity} kind={KIND_LABEL[p.kind] as 'PT' | 'YT' | 'PT Loop'} size={s} />;
}

const ALERT_ICON = { danger: ShieldAlert, warning: AlertTriangle, info: Info, success: CheckCircle2 };
const ALERT_CLS = {
  danger: 'border-sx-red text-sx-red',
  warning: 'border-sx-orange text-sx-orange',
  info: 'border-sx-blue text-sx-blue',
  success: 'border-sx-green text-sx-green',
};

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((a, i) => {
        const Icon = ALERT_ICON[a.level];
        return (
          <li key={i} className={`flex items-start gap-2.5 rounded-md border-r-2 bg-sx-surface px-4 py-2.5 text-sm ${ALERT_CLS[a.level]}`}>
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span className="text-sx-text font-light">{a.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function NoWalletNote() {
  return (
    <p className="text-sm text-sx-muted leading-7 flex items-start gap-2">
      <Info size={16} className="mt-1.5 shrink-0 text-sx-blue" aria-hidden />
      داده فقط در همین مرورگر است و از زنجیره تأیید نمی‌شود؛ از آن پشتیبان بگیرید.
    </p>
  );
}

/** Line chart of recorded snapshots only. Gaps longer than `gapMs` break the line instead of being filled. */
export function SnapshotChart({ points, label, gapMs = 3 * 86_400_000 }: { points: { t: number; y: number }[]; label: string; gapMs?: number }) {
  const pts = points.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.t));
  if (pts.length < 2) {
    return (
      <p className="text-sm text-sx-muted leading-7">
        هنوز سابقه‌ای ثبت نشده.
      </p>
    );
  }
  const W = 600;
  const H = 180;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  let lo = Math.min(...pts.map((p) => p.y));
  let hi = Math.max(...pts.map((p) => p.y));
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 8) + 4;
  const y = (v: number) => H - 10 - ((v - lo) / (hi - lo)) * (H - 20);
  let d = '';
  pts.forEach((p, i) => {
    const gap = i > 0 && p.t - pts[i - 1].t > gapMs;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)} `;
  });
  const up = pts[pts.length - 1].y >= pts[0].y;
  const color = up ? 'var(--c-success)' : 'var(--c-danger)';
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label={label} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--c-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {lo < 0 && hi > 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--c-secondary)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {pts.length <= 60 && pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.y)} r="2.5" fill={color} />)}
      </svg>
      <figcaption className="flex justify-between gap-2 text-xs text-sx-faint">
        <span>{formatDate(new Date(t0).toISOString())}</span>
        <span>
          {formatDollar(lo, 0)} تا {formatDollar(hi, 0)} · <Num>{formatNumber(pts.length, 0)}</Num> نقطه‌ی ثبت‌شده
        </span>
        <span>{formatDate(new Date(t1).toISOString())}</span>
      </figcaption>
    </figure>
  );
}

export function ShareBars({ slices, name }: { slices: { key: string; share: number; valueUsd: number }[]; name: (k: string) => ReactNode }) {
  if (!slices.length) return <p className="text-sm text-sx-faint">{EMPTY}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {slices.map((s) => (
        <li key={s.key} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2 text-sm">
            <span className="text-sx-text truncate">{name(s.key)}</span>
            <span className="text-sx-muted whitespace-nowrap">
              <Num>{formatPercent(s.share, 1)}</Num> · <Usd x={s.valueUsd} digits={0} />
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-sx-raised overflow-hidden" dir="ltr">
            <div className={`h-full rounded-full ${s.share >= 50 ? 'bg-sx-orange' : 'bg-sx-accent'}`} style={{ width: `${Math.max(2, s.share)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Page wrapper for the section: scoped theme, generous spacing. */
export function SxPage({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <main className={`sx w-full min-w-0 ${narrow ? 'max-w-3xl' : 'max-w-matrix'} mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-6 text-sx-text`}>{children}</main>;
}
