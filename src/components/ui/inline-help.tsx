'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * A term's explanation next to its label. Opens on tap/click/Enter (not hover, so it
 * works on touch screens), closes on Escape or a click outside; screen readers get
 * the text through aria-describedby when open.
 */
export function InlineHelp({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`توضیح ${term}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="relative inline-grid place-items-center size-6 -my-1 rounded-full text-muted hover:text-accent before:absolute before:-inset-2.5 before:content-['']"
      >
        <CircleHelp size={15} aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute z-40 top-full mt-1 start-0 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-strong bg-elevated p-3 text-sm leading-6 text-secondary font-normal shadow-xl"
        >
          <b className="block text-primary mb-0.5">{term}</b>
          {children}
        </span>
      )}
    </span>
  );
}
