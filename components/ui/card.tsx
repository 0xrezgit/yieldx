'use client';

import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

interface CardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  /** Extra classes merged onto the section (never replaces base token spacing). */
  className?: string;
}

/** Quant Terminal card surface — border-based, scale padding, equal-height aware. */
export function Card({ title, icon, children, className = '' }: CardProps) {
  return (
    <section
      className={`bg-surface border border-default rounded-lg p-4 md:p-5 h-full min-w-0 flex flex-col gap-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 min-w-0">
        <h2 className="text-xs uppercase tracking-wider text-secondary font-semibold flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        <CircleHelp size={14} className="text-muted shrink-0" aria-hidden />
      </div>
      {children}
    </section>
  );
}
