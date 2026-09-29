import type { ReactNode } from 'react';
import { EMPTY, formatFull, formatNumber, formatPercent, formatToken, formatUSD } from '../../lib/utils/formatting';

/**
 * A trigger rate that can be astronomically high (e.g. liquidation implied APY near maturity).
 * Words stay in RTL; only the number is an LTR isolate, so «بیش از ۱٬۰۰۰٪» never reorders.
 */
export function CappedRate({ x, digits = 1, cap = 1000, className = '' }: { x: number; digits?: number; cap?: number; className?: string }) {
  if (x === Infinity) return <span className={className}>دور از دسترس</span>;
  if (x === -Infinity) return <span className={className}>همین حالا</span>;
  if (!Number.isFinite(x)) return <span className={`text-muted ${className}`}>{EMPTY}</span>;
  if (x > cap) return <span className={className} title={formatPercent(x, digits)}>بیش از <Num>{formatPercent(cap, 0)}</Num></span>;
  return <Num className={className}>{formatPercent(x, digits)}</Num>;
}
import { Num } from './num';

type Kind = 'usd' | 'pct' | 'num' | 'token';

interface FinancialNumberProps {
  value: number | null | undefined;
  kind?: Kind;
  digits?: number;
  signed?: boolean;
  /** Colour by sign (gain/loss) — used only where the sign is meaningful (P&L). */
  tone?: boolean;
  /** Write «سود» / «زیان» next to the number so meaning never rests on colour. */
  word?: boolean;
  /** Token symbol for kind="token". */
  symbol?: string;
  /** Why the value is missing (shown next to «—»). */
  missing?: string;
  className?: string;
}

/**
 * One number, formatted once: Persian digits, isolated direction, the full value in
 * the title (tap/hover) when it is rounded, «—» (never 0) when unknown.
 */
export function FinancialNumber({ value, kind = 'num', digits = 2, signed = false, tone = false, word = false, symbol = '', missing, className = '' }: FinancialNumberProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span className={`text-muted ${className}`} title={missing}>
        {EMPTY}
        {missing && <span className="sr-only"> ({missing})</span>}
      </span>
    );
  }
  const text =
    kind === 'usd' ? formatUSD(value, digits, signed) : kind === 'pct' ? formatPercent(value, digits, signed) : kind === 'token' ? formatToken(value, symbol, digits) : formatNumber(value, digits, signed);
  const zero = kind === 'usd' || kind === 'pct' ? Math.abs(value) < 0.5 * 10 ** -digits : value === 0;
  const color = tone ? (zero ? 'text-secondary' : value > 0 ? 'text-success' : 'text-danger') : '';
  return (
    <span className={`inline-flex items-baseline gap-1 whitespace-nowrap ${color} ${className}`} title={formatFull(value) + (kind === 'pct' ? '٪' : kind === 'usd' ? ' دلار' : symbol ? ` ${symbol}` : '')}>
      {word && !zero && <span className="text-[0.7em] font-normal">{value > 0 ? 'سود' : 'زیان'}</span>}
      <Num>{text}</Num>
    </span>
  );
}

/**
 * A labelled figure. At most four of these in a result summary. The card is a
 * size container: the value scales with the card's own width (cqi), so a long
 * amount shrinks to fit instead of spilling out of the box.
 */
export function MetricCard({ label, children, sub, help, emphasis = false }: { label: ReactNode; children: ReactNode; sub?: ReactNode; help?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={`@container min-w-0 flex flex-col gap-1 rounded-lg border border-default bg-surface p-3 sm:p-4 ${emphasis ? 'col-span-full' : ''}`}>
      <div className={`text-sm text-secondary flex items-start gap-1 leading-5 ${emphasis ? '' : 'min-h-10 sm:min-h-0'}`}>
        {label}
        {help}
      </div>
      <div
        className={`min-w-0 text-primary leading-tight ${
          emphasis ? 'font-medium tabular-nums text-[clamp(1.5rem,9cqi,2.25rem)]' : 'font-semibold text-[clamp(0.95rem,12cqi,1.25rem)]'
        }`}
      >
        {children}
      </div>
      {sub && <div className="text-xs leading-5 text-secondary">{sub}</div>}
    </div>
  );
}

/** Empty or start state: what this is, and the one action to take. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="sx-card px-6 py-10 flex flex-col items-center gap-3 text-center">
      {icon && <span className="grid place-items-center size-12 rounded-full bg-accent/12 text-accent">{icon}</span>}
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {children && <div className="text-sm text-secondary max-w-md leading-7">{children}</div>}
      {action && <div className="flex flex-wrap justify-center gap-2 mt-1">{action}</div>}
    </section>
  );
}

/** Shared button looks. */
export const button = {
  primary: 'tap inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-lg bg-brand text-white text-[15px] font-semibold hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed',
  secondary: 'tap inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-accent/70 text-primary text-[15px] hover:bg-accent/10 transition-colors disabled:opacity-40',
  ghost: 'tap inline-flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-lg text-secondary text-sm hover:text-primary hover:bg-elevated transition-colors disabled:opacity-40',
};
