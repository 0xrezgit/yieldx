import { Gift } from 'lucide-react';
import type { Analysis } from '../../lib/analysis';
import type { ScenarioParams } from '../../types/scenario';
import { formatCompact, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Num } from '../ui/num';

const rec = {
  buy: { tone: 'success', label: 'ارزش دارد' },
  wait: { tone: 'warning', label: 'مرزی' },
  avoid: { tone: 'danger', label: 'گران' },
} as const;

/** Cost of points vs what they may be worth, plus the airdrop outlook. */
export function PointsPanel({ p, a }: { p: ScenarioParams; a: Analysis }) {
  const v = a.yt.valuation;
  const free = v.burn <= 0;
  const finiteCost = Number.isFinite(v.costPerMillion);
  const max = Math.max(finiteCost ? v.costPerMillion : 0, v.valuePerMillion, 1e-9);
  const pct = (x: number) => `${Math.min(100, (x / max) * 100)}%`;

  return (
    <Card
      title={`پوینت ${p.pointsName} و ایردراپ`}
      icon={<Gift size={18} />}
      actions={<Badge tone={rec[v.recommendation].tone}>{rec[v.recommendation].label}</Badge>}
    >
      {free ? (
        <p className="text-success text-sm">بازده YT سرمایه را برمی‌گرداند؛ پوینت‌ها عملاً رایگان‌اند.</p>
      ) : finiteCost ? (
        <div className="flex flex-col gap-3">
          <Bar label="هزینه‌ی ۱M پوینت" value={formatUSD(v.costPerMillion, 0)} width={pct(v.costPerMillion)} tone="bg-danger" />
          <Bar label="ارزش ۱M پوینت" value={formatUSD(v.valuePerMillion, 0)} width={pct(v.valuePerMillion)} tone="bg-success" />
        </div>
      ) : (
        <p className="text-danger text-sm">این موقعیت پوینت نمی‌گیرد.</p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Item label="پوینت این موقعیت" value={formatCompact(a.yt.points)} />
        <Item label="FDV سربه‌سر" value={free || !finiteCost ? '—' : formatUSDCompact(v.breakEvenFDV)} />
        <Item label="کل پوینت‌های شما" value={formatCompact(a.airdrop.totalPoints)} />
        <Item label="سهم از کل" value={formatPercent(a.airdrop.share * 100, 4)} />
        <Item label="ارزش هر پوینت" value={formatUSD(a.airdrop.valuePerPoint, 6)} />
        <Item label="ارزش کل ایردراپ" value={formatUSD(a.airdrop.value)} color="text-success" />
      </dl>
    </Card>
  );
}

function Item({ label, value, color = 'text-primary' }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-semibold ${color}`}>
        <Num>{value}</Num>
      </dd>
    </div>
  );
}

function Bar({ label, value, width, tone }: { label: string; value: string; width: string; tone: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-secondary">{label}</span>
        <Num className="font-bold text-primary">{value}</Num>
      </div>
      <div className="h-2.5 rounded-full bg-elevated overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width }} />
      </div>
    </div>
  );
}
