'use client';

import { useCallback, useState } from 'react';
import type { ExitPlan } from '../../lib/calculators/exit-plan';
import { DAY_MS } from '../../lib/utils/math';
import { formatCompact, formatDate, formatUSD, MINUS } from '../../lib/utils/formatting';
import { C, LegendItem, Tip, useHover } from './chart-kit';

/** Axis label: compact signed dollars (the unit is in the legend). */
const axis = (x: number) => `${x < 0 ? MINUS : ''}${formatCompact(Math.abs(x))}`;

const W = 640;
const H = 220;
const PAD = { top: 18, right: 60, bottom: 26, left: 8 };

type Mode = 'cash' | 'total';

/**
 * Result of selling YT on each day until maturity. The cash result and the result
 * including the hypothetical airdrop are shown one at a time (toggle), each on its
 * own scale, so a large assumed airdrop can never flatten a real cash loss.
 * Zero line and loss area are drawn; time runs left → right.
 */
export function ExitChart({ plan, days, now = Date.now() }: { plan: ExitPlan; days: number; now?: number }) {
  const [mode, setMode] = useState<Mode>('cash');
  const s = plan.series;
  const toIndex = useCallback(
    (px: number) => {
      const day = ((px - PAD.left) / (W - PAD.left - PAD.right)) * Math.max(1, days);
      let best = 0;
      for (let k = 1; k < s.length; k++) if (Math.abs(s[k].day - day) < Math.abs(s[best].day - day)) best = k;
      return best;
    },
    [s, days],
  );
  const hover = useHover(W, toIndex);
  if (!s.length) return null;

  const key = mode;
  const values = [...s.map((p) => p[key]), 0, -plan.lossBudget];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (d: number) => PAD.left + (d / Math.max(1, days)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const color = mode === 'cash' ? C.warning : C.success;
  const dateAt = (day: number) => formatDate(new Date(now + day * DAY_MS).toISOString());
  const rec = plan.recommended;
  const minCash = Math.min(...s.map((p) => p.cash));
  const summary = `اگر YT را در روزهای مختلف تا سررسید بفروشید، نتیجه‌ی نقدی بین ${formatUSD(minCash, 0)} و ${formatUSD(Math.max(...s.map((p) => p.cash)), 0)} است. فروش پیشنهادی در ${dateAt(rec.day)} با نتیجه‌ی نقدی ${formatUSD(rec.cash, 0)}.`;

  return (
    <figure className="flex flex-col gap-2">
      <div className="seg self-start" role="radiogroup" aria-label="نوع نتیجه در نمودار">
        {(
          [
            ['cash', 'نتیجه‌ی نقدی'],
            ['total', 'با ایردراپ فرضی'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className="tap px-3 min-h-9 text-sm">
            {label}
          </button>
        ))}
      </div>
      <div dir="ltr" className="relative">
        {hover.i !== null && (
          <Tip x={x(s[hover.i].day)} width={W}>
            {dateAt(s[hover.i].day)} (روز {formatCompact(s[hover.i].day)}): نقدی <b className="num">{formatUSD(s[hover.i].cash, 0)}</b> · با ایردراپ فرضی <b className="num">{formatUSD(s[hover.i].total, 0)}</b>
          </Tip>
        )}
        <svg ref={hover.ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-pan-y" role="img" aria-label="نتیجه‌ی فروش YT در هر روز تا سررسید" onPointerMove={hover.onMove} onPointerDown={hover.onMove} onPointerLeave={hover.onLeave}>
          {/* Loss area: everything below zero. */}
          <rect x={PAD.left} width={W - PAD.left - PAD.right} y={y(0)} height={Math.max(0, H - PAD.bottom - y(0))} fill={C.danger} opacity={0.08} />
          <line x1={PAD.left} x2={W - PAD.right} y1={y(-plan.lossBudget)} y2={y(-plan.lossBudget)} stroke={C.danger} strokeDasharray="4 4" opacity={0.7} />
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke={C.zero} />
          <text x={W - PAD.right + 6} y={y(0) + 4} fontSize={12} fill={C.axis}>
            ۰
          </text>
          <text x={W - PAD.right + 6} y={y(hi) + 4} fontSize={12} fill={C.axis}>
            {axis(hi)}
          </text>
          {lo < 0 && (
            <text x={W - PAD.right + 6} y={y(lo) + 4} fontSize={12} fill={C.axis}>
              {axis(lo)}
            </text>
          )}
          {plan.horizon < days && <line x1={x(plan.horizon)} x2={x(plan.horizon)} y1={PAD.top} y2={H - PAD.bottom} stroke={C.info} strokeWidth={2} strokeDasharray="4 4" />}
          <line x1={x(rec.day)} x2={x(rec.day)} y1={PAD.top} y2={H - PAD.bottom} stroke={C.accent} strokeWidth={2} />
          <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx={x(rec.day)} cy={y(rec[key])} r={5} fill={C.accent} stroke={C.surface} strokeWidth={2} />
          {hover.i !== null && <circle cx={x(s[hover.i].day)} cy={y(s[hover.i][key])} r={4} fill={color} />}
          <text x={PAD.left} y={H - 6} fontSize={12} fill={C.axis}>
            امروز
          </text>
          <text x={W - PAD.right} y={H - 6} fontSize={12} fill={C.axis} textAnchor="end">
            سررسید {dateAt(days)}
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <LegendItem color={color} label={mode === 'cash' ? 'نتیجه‌ی نقدی (دلار)' : 'با ایردراپ فرضی (دلار) — سناریو'} />
        <LegendItem color={C.accent} label="زمان پیشنهادی فروش" />
        {plan.horizon < days && <LegendItem color={C.info} label="اسنپ‌شات" dashed />}
        <LegendItem color={C.danger} label="سقف ضرر قابل قبول" dashed />
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
