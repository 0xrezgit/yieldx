import type { ReactNode } from 'react';
import type { StrategyId } from '../../lib/analysis';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted';

export const toneText: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  accent: 'text-accent',
  muted: 'text-muted',
};

export const toneSurface: Record<Tone, string> = {
  success: 'text-success bg-success/12 border-success/30',
  warning: 'text-warning bg-warning/12 border-warning/30',
  danger: 'text-danger bg-danger/12 border-danger/30',
  info: 'text-info bg-info/12 border-info/30',
  accent: 'text-accent bg-accent/15 border-accent/35',
  muted: 'text-secondary bg-elevated border-strong',
};

export const riskTone = { low: 'success', medium: 'warning', high: 'danger' } as const;
export const riskLabel = { low: 'کم‌ریسک', medium: 'ریسک متوسط', high: 'پرریسک' } as const;

/** One colour per strategy, used for dots, bars and highlights. */
export const strategyColor: Record<StrategyId, { text: string; bg: string; border: string; soft: string }> = {
  pt: { text: 'text-st-pt', bg: 'bg-st-pt', border: 'border-st-pt/50', soft: 'bg-st-pt/10' },
  loop: { text: 'text-st-loop', bg: 'bg-st-loop', border: 'border-st-loop/50', soft: 'bg-st-loop/10' },
  yt: { text: 'text-st-yt', bg: 'bg-st-yt', border: 'border-st-yt/50', soft: 'bg-st-yt/10' },
  clmm: { text: 'text-st-clmm', bg: 'bg-st-clmm', border: 'border-st-clmm/50', soft: 'bg-st-clmm/10' },
};

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-0.5 whitespace-nowrap ${toneSurface[tone]}`}
    >
      {children}
    </span>
  );
}
