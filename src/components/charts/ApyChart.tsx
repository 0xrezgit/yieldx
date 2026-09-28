import { formatPercent } from '../../lib/utils/formatting';

interface Props {
  history: number[];
  impliedAPY: number;
  /** Predicted base APY 7 days after the last point. */
  predicted?: number;
}

const W = 600;
const H = 180;
const PAD = { top: 14, right: 48, bottom: 10, left: 8 };

/** Base APY (area), 7-day projection (dashed) and market implied APY (line). Time runs left→right. */
export function ApyChart({ history, impliedAPY, predicted }: Props) {
  if (history.length < 2) return null;

  const n = history.length;
  const total = predicted !== undefined ? n - 1 + 7 : n - 1;
  const values = [...history, impliedAPY, ...(predicted !== undefined ? [predicted] : [])].filter(Number.isFinite);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const yMin = lo - span * 0.15;
  const yMax = hi + span * 0.15;

  const x = (i: number) => PAD.left + (i / total) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  const line = history.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`;
  const last = history[n - 1];

  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`APY پایه ${n} روز اخیر`}>
        <defs>
          <linearGradient id="apy-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7662FD" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7662FD" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#32323A" />
            <text x={W - PAD.right + 6} y={y(v) + 4} fontSize={12} fill="#85848F">
              {formatPercent(v, 1)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#apy-fill)" />
        <path d={line} fill="none" stroke="#7662FD" strokeWidth={2.5} strokeLinejoin="round" />
        {predicted !== undefined && (
          <line x1={x(n - 1)} y1={y(last)} x2={x(total)} y2={y(predicted)} stroke="#F44BCC" strokeWidth={2} strokeDasharray="6 5" />
        )}
        {Number.isFinite(impliedAPY) && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(impliedAPY)}
            y2={y(impliedAPY)}
            stroke="#FBBF24"
            strokeWidth={1.5}
            strokeDasharray="3 4"
          />
        )}
        <circle cx={x(n - 1)} cy={y(last)} r={4} fill="#7662FD" stroke="#0A0F1E" strokeWidth={2} />
      </svg>
      <div dir="rtl" className="flex flex-wrap gap-4 text-xs text-secondary mt-2">
        <Legend color="bg-accent" label="بازده فعلی" />
        <Legend color="bg-brand2" label="پیش‌بینی" />
        <Legend color="bg-warning" label="نرخ بازار" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={`inline-block w-3 h-1 rounded ${color}`} /> {label}
    </span>
  );
}
