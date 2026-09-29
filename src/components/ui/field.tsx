'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatDate, formatGregorian, isPartialNumber, parseLocaleNumber, toLatinDigits, toPersianDigits } from '../../lib/utils/formatting';
import { InlineHelp } from './inline-help';

const controlBase =
  // 16px text: iOS Safari zooms into smaller inputs. 44px min height for touch.
  'w-full bg-elevated border rounded-md px-3 py-2.5 min-h-11 text-primary text-base transition-colors focus:border-accent';

const border = (error?: string, warning?: string) => (error ? ' border-danger' : warning ? ' border-warning' : ' border-control');

interface ShellProps {
  label: string;
  /** Short explanation of the term, opened from a (?) button next to the label. */
  help?: ReactNode;
  /** Kept for callers: shown as help when no `help` is given. */
  hint?: string;
  error?: string;
  warning?: string;
  htmlFor: string;
  /** Visible note under the control (units, source…). */
  note?: ReactNode;
  children: ReactNode;
}

function Shell({ label, help, hint, error, warning, htmlFor, note, children }: ShellProps) {
  const msgId = `${htmlFor}-msg`;
  const tip = help ?? hint;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 mb-1.5 min-w-0">
        <label htmlFor={htmlFor} className="text-sm text-secondary leading-5">
          {label}
        </label>
        {tip && <InlineHelp term={label}>{tip}</InlineHelp>}
      </div>
      {children}
      {(error || warning) && (
        <p id={msgId} role={error ? 'alert' : undefined} className={`text-xs leading-5 mt-1 ${error ? 'text-danger' : 'text-warning'}`}>
          {error ?? warning}
        </p>
      )}
      {note && !error && <div className="text-xs leading-5 mt-1 text-muted">{note}</div>}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  help?: ReactNode;
  hint?: string;
  error?: string;
  warning?: string;
  note?: ReactNode;
  /** Show errors before the user has touched the field (e.g. after a submit attempt). */
  forceErrors?: boolean;
  step?: number;
  /** Show Persian digits while typing (default; any digits are accepted). */
  persian?: boolean;
  placeholder?: string;
}

/**
 * PersianNumericInput. Accepts Persian, Arabic and Latin digits and the usual separators;
 * keeps partial text while typing («۰٫», «−») and reports only valid numbers upward.
 * Digits are shown in Persian 1:1 (same length), and the caret is restored after
 * each keystroke so it never jumps. Grouping («۱۰٬۰۰۰») is added only on blur.
 * The displayed text is never the source of calculations — `value` is.
 */
export function NumberField({ label, value, onChange, suffix, help, hint, error, warning, note, forceErrors, persian = true, placeholder }: NumberFieldProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);
  const show = (s: string) => (persian ? toPersianDigits(s) : s);
  const pretty = (x: number) => (Number.isFinite(x) ? (persian ? groupFa(x) : String(x)) : '');
  const [draft, setDraft] = useState(() => pretty(value));

  // Follow external changes (market fetched, reset) without touching what the user is typing.
  useEffect(() => {
    const typed = parseLocaleNumber(draft);
    if (typed !== value && !(Number.isNaN(typed) && Number.isNaN(value))) setDraft(pretty(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external value changes
  }, [value]);

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [draft]);

  const visibleError = touched || forceErrors ? error : undefined;

  return (
    <Shell label={label} help={help} hint={hint} error={visibleError} warning={warning} htmlFor={id} note={note}>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={`${controlBase}${border(visibleError, warning)} num text-left${suffix ? (suffix.length > 2 ? ' pr-14' : ' pr-10') : ''}`}
          value={draft}
          aria-invalid={!!visibleError}
          aria-describedby={visibleError || warning ? `${id}-msg` : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            caret.current = e.target.selectionStart;
            setDraft(show(toLatinDigits(raw).replace(/[−–]/g, '-')));
            const n = parseLocaleNumber(raw);
            if (Number.isFinite(n)) onChange(n);
            else if (raw.trim() === '') onChange(NaN);
          }}
          onBlur={() => {
            setTouched(true);
            const n = parseLocaleNumber(draft);
            if (Number.isFinite(n)) setDraft(persian ? groupFa(n) : String(n));
            else if (!isPartialNumber(draft)) return;
          }}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">{suffix}</span>}
      </div>
    </Shell>
  );
}

/** Full-precision display with Persian grouping: 10000.125 → «۱۰٬۰۰۰٫۱۲۵» (round-trips through the parser). */
function groupFa(n: number): string {
  const [int, frac] = String(Math.abs(n)).split('.');
  if (/e/i.test(int)) return toPersianDigits(String(n));
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return toPersianDigits(`${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`);
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
  placeholder?: string;
  help?: ReactNode;
  hint?: string;
  error?: string;
  ltr?: boolean;
}

export function TextField({ label, value, onChange, type = 'text', placeholder, help, hint, error, ltr }: TextFieldProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const visibleError = touched ? error : undefined;
  return (
    <Shell
      label={label}
      help={help}
      hint={hint}
      error={visibleError}
      htmlFor={id}
      note={type === 'date' && value ? <>{formatDate(value)} · <span className="text-muted">میلادی {formatGregorian(value)}</span></> : undefined}
    >
      <input
        id={id}
        type={type}
        dir={ltr || type === 'date' ? 'ltr' : undefined}
        placeholder={placeholder}
        className={`${controlBase}${border(visibleError)}${ltr ? ' font-mono text-sm' : ''}`}
        value={value}
        aria-invalid={!!visibleError}
        onBlur={() => setTouched(true)}
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
  help?: ReactNode;
  hint?: string;
}

export function SelectField<T extends string>({ label, value, onChange, options, help, hint }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <Shell label={label} help={help} hint={hint} htmlFor={id}>
      <div className="relative">
        <select id={id} className={`${controlBase} border-control appearance-none pl-8`} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
      </div>
    </Shell>
  );
}
