'use client';

import { useCallback } from 'react';
import { DAY_MS } from '../../lib/utils/math';
import { formatDate, formatNumber, formatPercent } from '../../lib/utils/formatting';
import { C, LegendItem, Tip, useHover } from './chart-kit';

interface Props {
  /** Daily base APY in %, oldest first, ending today. Never padded or invented. */
  history: number[];
  impliedAPY: number;
  /** Model estimate of base APY 7 days after the last point (not observed data). */
  predicted?: number;
  now?: number;
}

const W = 640;
const H = 200;
const PAD = { top: 16, right: 56, bottom: 26, left: 8 };

/**
 * Observed base APY (solid), a 7-day model estimate (dashed, labelled) and the
 * market's implied APY (dotted). Time runs left → right. Hover or touch for values;
 * a text summary is always present for screen readers.
 */
export function ApyChart({ history, impliedAPY, predicted, now = Date.now() }: Props) {
  const n = history.length;
  const total = predicted !== undefined ? n - 1 + 7 : n - 1;
  const x = (i: number) => PAD.left + (i / Math.max(1, total)) * (W - PAD.left - PAD.right);
  const toIndex = useCallback((px: number) => Math.max(0, Math.min(n - 1, Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * total))), [n, total]);
  const hover = useHover(W, toIndex);

  if (n < 2) {
    return (
      <p className="text-sm text-secondary rounded-lg border border-dashed border-strong px-4 py-6 text-center">
        تاریخچه‌ی روزانه‌ی APY برای این بازار در دسترس نیست؛ نمودار با داده‌ی ساختگی پر نمی‌شود.
      </p>
    );
  }

  const values = [...history, impliedAPY, ...(predicted !== undefined ? [predicted] : [])].filter(Number.isFinite);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const yMin = Math.max(0, lo - span * 0.15);
  const yMax = hi + span * 0.15;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const dateOf = (i: number) => new Date(now - (n - 1 - i) * DAY_MS).toISOString();

  const line = history.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = history[n - 1];
  const ticks = [yMin + (yMax - yMin) * 0.1, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.1];
  const summary = `بازده پایه در ${formatNumber(n, 0)} روز گذشته بین ${formatPercent(lo, 1)} و ${formatPercent(hi, 1)} بوده و آخرین مقدار ${formatPercent(last, 2)} است. نرخ بازار (Implied) ${formatPercent(impliedAPY, 2)} است${predicted !== undefined ? `؛ تخمین مدل برای هفته‌ی بعد ${formatPercent(predicted, 2)} (داده‌ی مشاهده‌شده نیست)` : ''}.`;

  return (
    <figure className="flex flex-col gap-2">
      <div dir="ltr" className="relative">
        {hover.i !== null && (
          <Tip x={x(hover.i)} width={W}>
            {formatDate(dateOf(hover.i))}: بازده پایه <b className="num">{formatPercent(history[hover.i], 2)}</b>
          </Tip>
        )}
        <svg
          ref={hover.ref}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto touch-pan-y"
          role="img"
          aria-label={`نمودار بازده پایه‌ی ${formatNumber(n, 0)} روز اخیر`}
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
          <path d={line} fill="none" stroke={C.accent} strokeWidth={2.5} strokeLinejoin="round" />
          {predicted !== undefined && <line x1={x(n - 1)} y1={y(last)} x2={x(total)} y2={y(predicted)} stroke={C.info} strokeWidth={2} strokeDasharray="6 5" />}
          {Number.isFinite(impliedAPY) && <line x1={PAD.left} x2={W - PAD.right} y1={y(impliedAPY)} y2={y(impliedAPY)} stroke={C.warning} strokeWidth={1.5} strokeDasharray="2 4" />}
          <circle cx={x(n - 1)} cy={y(last)} r={4} fill={C.accent} stroke={C.surface} strokeWidth={2} />
          {hover.i !== null && <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD.top} y2={H - PAD.bottom} stroke={C.zero} strokeDasharray="3 3" />}
          <text x={PAD.left} y={H - 6} fontSize={12} fill={C.axis}>
            {formatDate(dateOf(0))}
          </text>
          <text x={x(n - 1)} y={H - 6} fontSize={12} fill={C.axis} textAnchor="middle">
            امروز
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <LegendItem color={C.accent} label="بازده پایه (مشاهده‌شده)" />
        {predicted !== undefined && <LegendItem color={C.info} label="تخمین مدل — ۷ روز" dashed />}
        <LegendItem color={C.warning} label="نرخ بازار (Implied)" dashed />
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
