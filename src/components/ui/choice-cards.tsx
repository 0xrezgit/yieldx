'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Choice<T extends string> {
  id: T;
  icon: LucideIcon;
  title: ReactNode;
  /** One line under the title (hidden on phones). */
  text?: string;
}

/**
 * Cards that act as tabs: icon, title and one line saying what each one is for. A grid
 * on wide screens; with more than three, a strip that scrolls on phones.
 */
export function ChoiceCards<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Choice<T>[]; label: string }) {
  const many = options.length > 3;
  return (
    <div
      role="tablist"
      aria-label={label}
      className={many ? 'strip -mx-[var(--space-page-x)] px-[var(--space-page-x)] flex gap-2 lg:grid lg:grid-cols-5 lg:mx-0 lg:px-0 lg:gap-3' : 'grid grid-cols-3 gap-2 sm:gap-3'}
    >
      {options.map(({ id, icon: Icon, title, text }) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)} className={`choice ${many ? 'shrink-0 w-[9.5rem] lg:w-auto' : ''}`}>
          <span className="choice-icon">
            <Icon size={16} aria-hidden />
          </span>
          <span className="font-semibold text-primary text-[15px] leading-snug">{title}</span>
          {text && <span className="hidden sm:block text-xs text-muted leading-relaxed">{text}</span>}
        </button>
      ))}
    </div>
  );
}
