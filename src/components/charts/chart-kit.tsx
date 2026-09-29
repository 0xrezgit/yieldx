'use client';

import { useCallback, useRef, useState, type ReactNode, type PointerEvent } from 'react';

/** Shared chart colours — the same tokens as the rest of the UI. */
export const C = {
  grid: 'var(--c-border)',
  axis: 'var(--c-muted)',
  zero: 'var(--c-secondary)',
  accent: 'var(--c-accent)',
  success: 'var(--c-success)',
  danger: 'var(--c-danger)',
  warning: 'var(--c-warning)',
  info: 'var(--c-info)',
  text: 'var(--c-text)',
  surface: 'var(--c-surface)',
};

/**
 * Nearest-point hover for touch and mouse (pointer events). `toIndex` maps the
 * pointer's x in viewBox units to a data index. Time always runs left → right,
 * so the chart itself is LTR even inside RTL pages.
 */
export function useHover(width: number, toIndex: (x: number) => number) {
  const ref = useRef<SVGSVGElement>(null);
  const [i, setI] = useState<number | null>(null);
  const onMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      setI(toIndex(((e.clientX - r.left) / r.width) * width));
    },
    [toIndex, width],
  );
  return { ref, i, onMove, onLeave: () => setI(null), setI };
}

/** Tooltip box placed inside the chart's LTR frame; its text is RTL Persian. */
export function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = `${Math.min(78, Math.max(0, (x / width) * 100 - 11))}%`;
  return (
    <div dir="rtl" className="pointer-events-none absolute top-1 z-10 rounded-md border border-strong bg-elevated px-2.5 py-1.5 text-xs leading-5 text-primary shadow-lg whitespace-nowrap" style={{ left }} role="status">
      {children}
    </div>
  );
}

export function LegendItem({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden>
        <line x1="0" x2="18" y1="3" y2="3" stroke={color} strokeWidth="3" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  );
}
