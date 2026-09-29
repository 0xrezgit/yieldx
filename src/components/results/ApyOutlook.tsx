import { LineChart } from 'lucide-react';
import type { Analysis } from '../../lib/analysis';
import type { ScenarioParams } from '../../types/scenario';
import { formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Card } from '../ui/card';
import { Badge, riskLabel, riskTone } from '../ui/badge';
import { Num } from '../ui/num';
import { ApyChart } from '../charts/ApyChart';

const CASE_STYLE = { bear: 'border-danger/30', base: 'border-accent/40', bull: 'border-success/30' } as const;
const CASE_LABEL = { bear: 'بد', base: 'عادی', bull: 'خوب' } as const;

/** What happens to a YT position if APY moves — chart plus three outcomes. */
export function ApyOutlook({ p, a }: { p: ScenarioParams; a: Analysis }) {
  const { scenarios } = a.scenarios;
  if (!Number.isFinite(p.baseAPY)) {
    return (
      <Card title="اگر APY تغییر کند" icon={<LineChart size={18} />}>
        <p className="text-sm text-secondary">بازده پایه‌ی این بازار معلوم نیست؛ حالت‌های بد/عادی/خوب قابل محاسبه نیست.</p>
        <ApyChart history={p.apyHistory} impliedAPY={a.implied.impliedAPY} />
      </Card>
    );
  }
  return (
    <Card
      title="اگر APY تغییر کند"
      icon={<LineChart size={18} />}
      actions={a.trend && <Badge tone={riskTone[a.trend.risk]}>روند: {riskLabel[a.trend.risk]}</Badge>}
    >
      <ApyChart history={p.apyHistory} impliedAPY={a.implied.impliedAPY} predicted={a.trend?.predictedNextWeek} />

      <div className="grid grid-cols-3 gap-2">
        {(['bear', 'base', 'bull'] as const).map((k) => {
          const s = scenarios[k];
          return (
            <div key={k} className={`rounded-lg border bg-elevated p-3 text-center min-w-0 ${CASE_STYLE[k]}`}>
              <div className="text-xs text-muted">
                حالت {CASE_LABEL[k]} · <Num>{formatPercent(s.apy, 1)}</Num>
              </div>
              <div className={`font-semibold mt-1 ${s.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                <Num>{formatUSD(s.pnl, 0, true)}</Num>
              </div>
              <div className="text-xs text-muted">
                با ایردراپ فرضی <Num>{formatUSD(s.pnlWithAirdrop, 0, true)}</Num>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">نتیجه‌ی نقدی خرید YT تا سررسید در سه حالت بازده پایه؛ خط دوم با ایردراپ فرضی.</p>
    </Card>
  );
}
