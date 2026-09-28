import type { ReactNode } from 'react';
import type { Analysis } from '../../lib/analysis';
import type { ScenarioParams } from '../../types/scenario';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

const gapColor = { safe: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;

function Tile({ label, value, sub, color = 'text-primary' }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="bg-surface/80 border border-default rounded-2xl p-4 min-w-0">
      <div className="text-sm text-secondary truncate">{label}</div>
      <div className={`text-xl md:text-2xl font-extrabold mt-1 leading-tight ${color}`}>
        {typeof value === 'string' ? <Num>{value}</Num> : value}
      </div>
      {sub && <div className="text-xs text-muted mt-1 truncate">{sub}</div>}
    </div>
  );
}

/** Four numbers that summarise the market. */
export function KeyNumbers({ p, a }: { p: ScenarioParams; a: Analysis }) {
  const v = a.yt.valuation;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        label="نرخ بازار (Implied)"
        value={formatPercent(a.implied.impliedAPY)}
        color={gapColor[a.implied.status]}
        sub={
          <>
            بازده فعلی <Num>{formatPercent(p.baseAPY)}</Num>
          </>
        }
      />
      <Tile
        label="هزینه‌ی ۱M پوینت"
        value={v.burn <= 0 ? <span>رایگان</span> : formatUSD(v.costPerMillion, 0)}
        color={v.recommendation === 'avoid' ? 'text-danger' : v.recommendation === 'wait' ? 'text-warning' : 'text-success'}
        sub={
          <>
            ارزش <Num>{formatUSD(v.valuePerMillion, 0)}</Num>
          </>
        }
      />
      <Tile
        label="نتیجه‌ی خرید YT"
        value={formatUSD(a.yt.netPnL, 0)}
        color={a.yt.netPnL >= 0 ? 'text-success' : 'text-danger'}
        sub="با احتساب ایردراپ"
      />
      <Tile
        label="تا سررسید"
        value={
          <span>
            <Num>{formatNumber(a.days, 0)}</Num> روز
          </span>
        }
        sub={p.marketName || undefined}
      />
    </div>
  );
}
