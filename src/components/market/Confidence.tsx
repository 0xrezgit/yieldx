'use client';

import { Num } from '../ui/num';
import { formatUSD } from '../../lib/utils/formatting';

const money = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/**
 * How far a dollar figure can be trusted, beside the figure: «قیمت اجرایی» (an executable
 * quote for this amount), «داده‌ی مشکوک» (ranked on a conservative value, with the range),
 * or «برآورد». `why` explains a doubt on hover and to screen readers.
 */
export function Confidence({ confidence, range, why }: { confidence?: 'executable' | 'suspect'; range?: { low: number; high: number } | null; why?: string[] }) {
  const label = confidence === 'executable' ? 'قیمت اجرایی' : confidence === 'suspect' ? 'داده‌ی مشکوک' : 'برآورد';
  const tone = confidence === 'executable' ? 'bg-success/12 text-success' : confidence === 'suspect' ? 'bg-warning/12 text-warning' : 'bg-hover text-muted';
  const title = why?.length ? why.join(' ') : undefined;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`} title={title}>
        {label}
        {title && <span className="sr-only">: {title}</span>}
      </span>
      {range && Math.abs(range.high - range.low) >= 0.5 && (
        <span className="text-[11px] text-muted">
          بازه <Num>{money(range.low)}</Num> تا <Num>{money(range.high)}</Num>
        </span>
      )}
    </span>
  );
}
