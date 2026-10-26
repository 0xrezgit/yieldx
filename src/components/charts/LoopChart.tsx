'use client';

import { useCallback } from 'react';
import { formatDateTime, formatPercent } from '../../lib/utils/formatting';
import { C, LegendItem, Tip, useHover } from './chart-kit';

export interface LoopChartPoint {
  /** Unix seconds. */
  t: number;
  /** % a year; null where the source has none. */
  fixedPct: number | null;
  borrowPct: number;
}

const W = 640;
const H = 220;
const PAD = { top: 16, right: 56, bottom: 26, left: 8 };

/**
 * PendleLoop's chart: the PT's fixed APY (solid) and the loan's borrow APY (dashed) hour by hour,
 * as Pendle recorded them — the gap between the two is what a loop multiplies. Time left → right.
 */
export function LoopChart({ points, yieldLabel = 'نرخ ثابت PT' }: { points: LoopChartPoint[]; yieldLabel?: string }) {
  const n = points.length;
  const t0 = points[0]?.t ?? 0;
  const t1 = points[n - 1]?.t ?? 1;
  const x = useCallback((t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right), [t0, t1]);
  const toIndex = useCallback(
    (px: number) => {
      const t = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
      return best;
    },
    [points, n, t0, t1],
  );
  const hover = useHover(W, toIndex);
  if (n < 2) return <p className="text-sm text-secondary rounded-lg border border-dashed border-strong px-4 py-6 text-center">تاریخچه‌ی نرخ‌های این لوپ هنوز نیامده یا خالی است.</p>;

  const values = points.flatMap((p) => [p.borrowPct, ...(p.fixedPct !== null ? [p.fixedPct] : [])]).filter(Number.isFinite);
  // A few broken hours (thousands of %) would flatten the chart: the axis stops at the 99th percentile.
  const sorted = [...values].sort((a, b) => a - b);
  const cap = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const lo = Math.max(0, Math.min(...values) - 1);
  const hi = cap + 1;
  const y = (v: number) => PAD.top + (1 - (Math.min(v, hi) - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const path = (get: (p: LoopChartPoint) => number | null) => {
    let d = '';
    let pen = false;
    for (const p of points) {
      const v = get(p);
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const dt = (t: number) => formatDateTime(new Date(t * 1000).toISOString());
  const h = hover.i !== null ? points[hover.i] : null;
  const last = points[n - 1];

  return (
    <figure className="flex flex-col gap-2">
      <div dir="ltr" className="relative">
        {h && (
          <Tip x={x(h.t)} width={W}>
            {dt(h.t)} · {yieldLabel} <b className="num">{h.fixedPct === null ? '—' : formatPercent(h.fixedPct, 2)}</b> · وام <b className="num">{formatPercent(h.borrowPct, 2)}</b>
          </Tip>
        )}
        <svg
          ref={hover.ref}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto touch-pan-y"
          role="img"
          aria-label={`${yieldLabel} و بهره‌ی وام، ساعت به ساعت`}
          onPointerMove={hover.onMove}
          onPointerDown={hover.onMove}
          onPointerLeave={hover.onLeave}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={C.grid} />
              <text x={W - PAD.right + 6} y={y(v) + 4} fontSize={12} fill={C.axis}>
                {formatPercent(v, 1)}
              </text>
            </g>
          ))}
          <path d={path((p) => p.fixedPct)} fill="none" stroke={C.success} strokeWidth={2.5} strokeLinejoin="round" />
          <path d={path((p) => p.borrowPct)} fill="none" stroke={C.warning} strokeWidth={1.75} strokeDasharray="4 3" strokeLinejoin="round" />
          {h && <line x1={x(h.t)} x2={x(h.t)} y1={PAD.top} y2={H - PAD.bottom} stroke={C.zero} strokeDasharray="3 3" />}
          <text x={PAD.left} y={H - 6} fontSize={12} fill={C.axis}>
            {formatDateTime(new Date(t0 * 1000).toISOString())}
          </text>
          <text x={x(last.t)} y={H - 6} fontSize={12} fill={C.axis} textAnchor="end">
            اکنون
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <LegendItem color={C.success} label={yieldLabel} />
        <LegendItem color={C.warning} label="بهره‌ی وام" dashed />
      </div>
      <figcaption className="sr-only">
        {yieldLabel} آخرین ساعت {last.fixedPct === null ? '—' : formatPercent(last.fixedPct, 2)} و بهره‌ی وام {formatPercent(last.borrowPct, 2)}.
      </figcaption>
    </figure>
  );
}
