import type { ExitPlan } from '../../lib/calculators/exit-plan';
import { formatUSDCompact } from '../../lib/utils/formatting';

const W = 600;
const H = 200;
const PAD = { top: 16, right: 56, bottom: 22, left: 8 };

/**
 * Result of selling YT on each day until maturity: cash only (amber) and with the
 * airdrop (green). The red band is the accepted loss; markers show the plan.
 * Time runs left→right.
 */
export function ExitChart({ plan, days }: { plan: ExitPlan; days: number }) {
  const s = plan.series;
  const values = [...s.map((x) => x.cash), ...s.map((x) => x.total), 0, -plan.lossBudget];
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
  const path = (key: 'cash' | 'total') => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const marker = (day: number, color: string, dashed = false) => (
    <line x1={x(day)} x2={x(day)} y1={PAD.top} y2={H - PAD.bottom} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '4 4' : undefined} />
  );

  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="نتیجه‌ی فروش YT در هر روز تا سررسید">
        {/* Accepted-loss band */}
        <rect x={PAD.left} width={W - PAD.left - PAD.right} y={y(0)} height={Math.max(0, y(-plan.lossBudget) - y(0))} fill="#F2545B" opacity={0.1} />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#45455A" />
        <text x={W - PAD.right + 6} y={y(0) + 4} fontSize={12} fill="#85848F">
          $0
        </text>
        <text x={W - PAD.right + 6} y={y(hi) + 4} fontSize={12} fill="#85848F">
          {formatUSDCompact(hi)}
        </text>
        <text x={W - PAD.right + 6} y={y(lo) + 4} fontSize={12} fill="#85848F">
          {formatUSDCompact(lo)}
        </text>

        {plan.horizon < days && marker(plan.horizon, '#4285F4', true)}
        {plan.bestTotal.day !== plan.recommended.day && marker(plan.bestTotal.day, '#15BE53', true)}
        {marker(plan.recommended.day, '#7662FD')}

        <path d={path('total')} fill="none" stroke="#15BE53" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={path('cash')} fill="none" stroke="#FF6201" strokeWidth={2.5} strokeLinejoin="round" />
        <circle cx={x(plan.recommended.day)} cy={y(plan.recommended.cash)} r={5} fill="#7662FD" stroke="#0B0B14" strokeWidth={2} />

        <text x={PAD.left} y={H - 4} fontSize={12} fill="#85848F">
          امروز
        </text>
        <text x={W - PAD.right} y={H - 4} fontSize={12} fill="#85848F" textAnchor="end">
          سررسید
        </text>
      </svg>
      <div dir="rtl" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary mt-2">
        <Legend cls="bg-warning" label="نتیجه‌ی نقدی" />
        <Legend cls="bg-success" label="با ایردراپ" />
        <Legend cls="bg-accent" label="زمان پیشنهادی فروش" />
        {plan.horizon < days && <Legend cls="bg-brand2" label="اسنپ‌شات" />}
        <Legend cls="bg-danger/40" label="محدوده‌ی ضرر قابل قبول" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={`inline-block w-3 h-1.5 rounded ${cls}`} /> {label}
    </span>
  );
}
