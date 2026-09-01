'use client';

import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  value?: string | number;
  onChange?: (value: any) => void;
  suffix?: string;
  type?: 'number' | 'date' | 'text';
  children?: ReactNode;
}

const controlClass =
  'w-full bg-elevated border border-strong rounded-md px-2.5 py-2 text-primary font-mono tabular-nums text-[13px] transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20';

const labelClass =
  'text-[10px] uppercase tracking-widest text-secondary font-medium block mb-1 truncate';

/** Form control with the Quant Terminal micro-label + scale-based spacing. */
export function Field({ label, value, onChange, suffix, type = 'number', children }: FieldProps) {
  if (children) {
    return (
      <label className="block min-w-0">
        <span className={labelClass}>{label}</span>
        {children}
      </label>
    );
  }

  return (
    <label className="block min-w-0">
      <span className={labelClass}>{label}</span>
      <div className="relative">
        <input
          className={controlClass + (suffix ? ' pr-8' : '')}
          type={type}
          value={value}
          onChange={(e) => onChange?.(type === 'number' ? Number(e.target.value) : e.target.value)}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted font-mono tabular-nums text-[10px] pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

/** Shared class for selects styled exactly like a Field control. */
export const selectClass = controlClass + ' appearance-none pr-8';
