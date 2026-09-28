'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Minus, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import type { Position } from '../../types/position';
import protocols from '../../config/protocols.json';
import { chainFa, chainLogo, KIND_LABEL, protocolLogo, QUALITY_FA, QUALITY_TONE, STATUS_FA } from '../../lib/portfolio/labels';
import type { Alert } from '../../lib/portfolio/analysis';
import type { PositionStatus, Quality } from '../../lib/portfolio/valuation';
import { EMPTY, formatDate, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Badge, toneText } from '../ui/badge';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';

/**
 * Profit/loss with colour, an arrow and a word, so meaning never depends on colour alone.
 */
export function Pnl({ usd, pct, size = 'md', word = true }: { usd: number; pct?: number | null; size?: 'sm' | 'md' | 'lg'; word?: boolean }) {
  if (!Number.isFinite(usd)) return <span className="text-muted">{EMPTY}</span>;
  const up = usd > 0.005;
  const down = usd < -0.005;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const cls = up ? 'text-success' : down ? 'text-danger' : 'text-secondary';
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold ${cls} ${text}`}>
      <Icon size={size === 'lg' ? 20 : 15} aria-hidden />
      {word && <span className="text-xs font-medium">{up ? 'سود' : down ? 'زیان' : 'سربه‌سر'}</span>}
      <Num>{formatUSD(usd)}</Num>
      {pct !== undefined && pct !== null && Number.isFinite(pct) && (
        <Num className="text-xs font-medium opacity-90">({formatPercent(pct, 2, true)})</Num>
      )}
    </span>
  );
}

export function QualityBadge({ q, prefix }: { q: Quality; prefix?: string }) {
  return (
    <Badge tone={QUALITY_TONE[q]}>
      {prefix ? `${prefix}: ` : ''}
      {QUALITY_FA[q]}
    </Badge>
  );
}

export function StatusBadge({ s }: { s: PositionStatus }) {
  return <Badge tone={s === 'open' ? 'info' : s === 'matured' ? 'warning' : 'muted'}>{STATUS_FA[s]}</Badge>;
}

/** Label / value / optional quality — the basic unit of every position screen. */
export function Stat({ label, children, q, hint, className = '' }: { label: string; children: ReactNode; q?: Quality; hint?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl bg-elevated/40 border border-default p-3 flex flex-col gap-0.5 ${className}`}>
      <div className="text-[11px] text-muted flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        {q && q !== 'market' && q !== 'rule' && <span className={`shrink-0 ${toneText[QUALITY_TONE[q]]}`}>{QUALITY_FA[q]}</span>}
      </div>
      <div className="font-bold text-primary leading-snug min-w-0">{children}</div>
      {hint && <div className="text-[11px] text-secondary">{hint}</div>}
    </div>
  );
}

export const usd = (x: number) => <Num>{formatUSD(x)}</Num>;

/** Platform, chain and token logos side by side — each one its own logo. */
export function MarketIdentity({ p, size = 40 }: { p: Pick<Position, 'protocol' | 'chain' | 'icon' | 'marketName' | 'platform' | 'maturity' | 'kind'>; size?: number }) {
  const cl = chainLogo(p.chain);
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="relative shrink-0">
        <TokenLogo src={p.icon || null} name={p.marketName} size={size} />
        <span className="absolute -bottom-1 -left-1 rounded-full ring-2 ring-surface" title={chainFa(p.chain)}>
          <TokenLogo src={cl} name={p.chain} size={Math.round(size * 0.42)} />
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-primary truncate" dir="ltr">
            {KIND_LABEL[p.kind]} {p.marketName}
          </span>
        </div>
        <div className="text-xs text-muted flex items-center gap-1 flex-wrap">
          <TokenLogo src={protocolLogo(p.protocol)} name={protocols[p.protocol].name} size={14} />
          <span dir="ltr">{protocols[p.protocol].name}</span>· {chainFa(p.chain)}
          {p.platform ? <> · <span dir="ltr">{p.platform}</span></> : null} · سررسید {formatDate(p.maturity)}
        </div>
      </div>
    </div>
  );
}

const ALERT_ICON = { danger: ShieldAlert, warning: AlertTriangle, info: Info, success: CheckCircle2 };
const ALERT_CLS = {
  danger: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-info/40 bg-info/10 text-info',
  success: 'border-success/40 bg-success/10 text-success',
};

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {alerts.map((a, i) => {
        const Icon = ALERT_ICON[a.level];
        return (
          <li key={i} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${ALERT_CLS[a.level]}`}>
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span className="text-primary">{a.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function NoWalletNote() {
  return (
    <p className="text-xs text-secondary rounded-xl border border-default bg-elevated/40 px-3 py-2 flex items-start gap-2">
      <Info size={14} className="mt-0.5 shrink-0 text-info" aria-hidden />
      کیف پول متصل نیست: موجودی و رویدادها فقط بر اساس ثبت شما هستند و از روی بلاکچین تأیید نمی‌شوند. اطلاعات فقط در همین مرورگر ذخیره می‌شود؛ برای پشتیبان از «خروجی» استفاده کنید.
    </p>
  );
}

/** Line chart of recorded snapshots only. Gaps longer than `gapMs` break the line instead of being filled. */
export function SnapshotChart({ points, label, gapMs = 3 * 86_400_000 }: { points: { t: number; y: number }[]; label: string; gapMs?: number }) {
  const pts = points.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.t));
  if (pts.length < 2) {
    return <p className="text-sm text-secondary">سابقه‌ی کافی ثبت نشده است. هر بار که صفحه با داده‌ی به‌روز باز شود (حداکثر ساعتی یک بار)، یک نقطه‌ی واقعی ذخیره می‌شود؛ جای خالی با داده‌ی ساختگی پر نمی‌شود.</p>;
  }
  const W = 600;
  const H = 160;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  let lo = Math.min(...pts.map((p) => p.y));
  let hi = Math.max(...pts.map((p) => p.y));
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 8) + 4;
  const y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
  let d = '';
  pts.forEach((p, i) => {
    const gap = i > 0 && p.t - pts[i - 1].t > gapMs;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)} `;
  });
  const up = pts[pts.length - 1].y >= pts[0].y;
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" role="img" aria-label={label} preserveAspectRatio="none">
        {lo < 0 && hi > 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="#33406E" strokeDasharray="4 4" />}
        <path d={d} fill="none" stroke={up ? '#34D399' : '#FB7185'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.y)} r="2" fill={up ? '#34D399' : '#FB7185'} />
        ))}
      </svg>
      <figcaption className="flex justify-between text-[11px] text-muted">
        <span>{formatDate(new Date(t0).toISOString())}</span>
        <span>
          <Num>{formatUSD(lo, 0)}</Num> تا <Num>{formatUSD(hi, 0)}</Num> · <Num>{pts.length.toLocaleString('fa-IR')}</Num> نقطه‌ی ثبت‌شده
        </span>
        <span>{formatDate(new Date(t1).toISOString())}</span>
      </figcaption>
    </figure>
  );
}

export function ShareBars({ slices, name }: { slices: { key: string; share: number; valueUsd: number }[]; name: (k: string) => ReactNode }) {
  if (!slices.length) return <p className="text-sm text-muted">{EMPTY}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {slices.map((s) => (
        <li key={s.key} className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="text-primary truncate">{name(s.key)}</span>
            <span className="text-secondary">
              <Num>{formatPercent(s.share, 1)}</Num> · <Num>{formatUSD(s.valueUsd, 0)}</Num>
            </span>
          </div>
          <div className="h-2 rounded-full bg-elevated overflow-hidden" dir="ltr">
            <div className={`h-full rounded-full ${s.share >= 50 ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${Math.max(2, s.share)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
