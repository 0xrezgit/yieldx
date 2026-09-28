'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { parseLocaleNumber } from '../../lib/utils/formatting';

const controlBase =
  // 16px text: iOS Safari zooms into smaller inputs.
  'w-full bg-elevated/70 border rounded-xl px-3 py-2.5 text-primary text-base transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25';

const border = (error?: string, warning?: string) =>
  error ? ' border-danger' : warning ? ' border-warning' : ' border-strong';

interface ShellProps {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  htmlFor?: string;
  children: ReactNode;
}

function Shell({ label, hint, error, warning, htmlFor, children }: ShellProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="text-sm text-secondary block mb-1.5 truncate" title={hint}>
        {label}
      </label>
      {children}
      {(error || warning) && (
        <p className={`text-xs mt-1 ${error ? 'text-danger' : 'text-warning'}`}>{error ?? warning}</p>
      )}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  hint?: string;
  error?: string;
  warning?: string;
  step?: number;
}

/**
 * Numeric input that accepts Persian/Arabic digits. Keeps the raw text while the
 * user types (so "0." or "۱٫" work) and reports only valid numbers upward.
 */
export function NumberField({ label, value, onChange, suffix, hint, error, warning }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (parseLocaleNumber(draft) !== value) setDraft(Number.isFinite(value) ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external value changes
  }, [value]);

  return (
    <Shell label={label} hint={hint} error={error} warning={warning} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          className={`${controlBase}${border(error, warning)} num text-left${suffix ? ' pr-12' : ''}`}
          value={draft}
          aria-invalid={!!error}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseLocaleNumber(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </Shell>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
  placeholder?: string;
  hint?: string;
  error?: string;
  ltr?: boolean;
}

export function TextField({ label, value, onChange, type = 'text', placeholder, hint, error, ltr }: TextFieldProps) {
  const id = useId();
  return (
    <Shell label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        type={type}
        dir={ltr || type === 'date' ? 'ltr' : undefined}
        placeholder={placeholder}
        className={`${controlBase}${border(error)}${ltr ? ' font-mono text-xs' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
}

export function SelectField<T extends string>({ label, value, onChange, options, hint }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <Shell label={label} hint={hint} htmlFor={id}>
      <div className="relative">
        <select
          id={id}
          className={`${controlBase} border-strong appearance-none pl-8`}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          aria-hidden
        />
      </div>
    </Shell>
  );
}
