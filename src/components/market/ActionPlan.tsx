'use client';

import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ChevronLeft, ExternalLink, Gift, HandCoins, Hourglass, Landmark, Lock, Repeat, ShoppingCart, Undo2, type LucideIcon } from 'lucide-react';
import type { Step, StepKind } from '../../lib/market/steps';
import { formatNumber } from '../../lib/utils/formatting';

const ICON: Record<StepKind, LucideIcon> = {
  deposit: ArrowDownToLine,
  buy: ShoppingCart,
  collateral: Lock,
  loop: Repeat,
  wait: Hourglass,
  watch: Activity,
  claim: Gift,
  redeem: Undo2,
  repay: Landmark,
  withdraw: ArrowUpFromLine,
  swap: ArrowLeftRight,
  sell: HandCoins,
};

/** The path in one line: an icon and a word per step, read right to left; scrolls sideways instead of wrapping. */
export function StepStrip({ steps }: { steps: Step[] }) {
  return (
    <ol className="strip flex flex-nowrap items-center gap-1 overflow-x-auto text-xs text-secondary rounded-md bg-canvas border border-default px-2 py-1.5" aria-label="مسیر">
      {steps.map((s, i) => {
        const Icon = ICON[s.kind];
        return (
          <li key={i} className="inline-flex shrink-0 items-center gap-1">
            {i > 0 && <ChevronLeft size={12} className="text-muted" aria-hidden />}
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Icon size={13} aria-hidden className={s.kind === 'wait' || s.kind === 'watch' ? 'text-warning' : 'text-accent'} />
              {s.short}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The full guide: numbered, one line each, with a link where there is somewhere to go. */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative flex flex-col gap-3" aria-label="قدم‌به‌قدم">
      {steps.map((s, i) => {
        const Icon = ICON[s.kind];
        const last = i === steps.length - 1;
        return (
          <li key={i} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2.5">
            {!last && <span className="absolute top-7 bottom-[-0.75rem] right-[0.8125rem] w-px bg-default" aria-hidden />}
            <span className={`relative z-[1] grid place-items-center size-7 rounded-full ${s.kind === 'wait' || s.kind === 'watch' ? 'bg-warning/12 text-warning' : 'bg-accent/12 text-accent'}`}>
              <Icon size={14} aria-hidden />
              <span className="sr-only">{formatNumber(i + 1, 0)}</span>
            </span>
            <span className="text-sm text-primary leading-6 min-w-0">{s.title}</span>
            {s.href ? (
              <a href={s.href} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 rounded-md border border-control px-2 min-h-8 text-xs text-secondary hover:text-primary hover:bg-elevated" aria-label={`رفتن: ${s.title}`}>
                <ExternalLink size={12} aria-hidden /> برو
              </a>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ol>
  );
}
