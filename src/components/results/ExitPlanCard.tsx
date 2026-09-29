'use client';

import { CalendarClock, CheckCircle2, Info, Target, TriangleAlert, Zap } from 'lucide-react';
import type { Analysis } from '../../lib/analysis';
import type { ScenarioParams, ScenarioSetter } from '../../types/scenario';
import { buildExitSteps, dayToDate, type StepTone } from '../../lib/risk/exit-advice';
import { formatCompact, formatNumber, formatUSD } from '../../lib/utils/formatting';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { NumberField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { ExitChart } from '../charts/ExitChart';

const stepLook: Record<StepTone, { icon: typeof Info; cls: string }> = {
  primary: { icon: Target, cls: 'border-accent/50 bg-accent/12 text-accent' },
  trigger: { icon: Zap, cls: 'border-accent/40 bg-accent/10 text-accent' },
  positive: { icon: CheckCircle2, cls: 'border-success/35 bg-success/10 text-success' },
  warning: { icon: TriangleAlert, cls: 'border-warning/40 bg-warning/10 text-warning' },
  info: { icon: Info, cls: 'border-strong bg-elevated/50 text-secondary' },
};

const money = (x: number) => formatUSD(x, 0, true);

/** When to sell YT: the plan in words, a day-by-day chart and price checkpoints. */
export function ExitPlanCard({ p, a, set }: { p: ScenarioParams; a: Analysis; set?: ScenarioSetter }) {
  const plan = a.exit;
  if (!plan) return null;
  const steps = buildExitSteps(p, a);
  const rec = plan.recommended;

  return (
    <Card
      title="برنامه‌ی خروج از YT"
      icon={<CalendarClock size={18} />}
      actions={plan.earnsPoints ? <Badge tone="accent">پوینت فعال</Badge> : <Badge tone="warning">بدون پوینت</Badge>}
    >
      {/* Headline */}
      <div>
        <div className="rounded-lg border border-default bg-elevated p-4 grid grid-cols-3 gap-3 text-center">
          <div className="min-w-0">
            <div className="text-xs text-muted">فروش در</div>
            <div className="font-extrabold text-primary text-lg leading-tight">{rec.day === 0 ? 'همین حالا' : dayToDate(rec.day)}</div>
            <div className="text-xs text-secondary">
              <Num>{formatNumber(rec.day, 0)}</Num> روز
            </div>
          </div>
          <div className="min-w-0 border-x border-default">
            <div className="text-xs text-muted">پوینت</div>
            <div className="font-extrabold text-st-yt text-lg leading-tight">
              <Num>{formatCompact(rec.points)}</Num>
            </div>
            <div className="text-xs text-secondary truncate">{p.pointsName || 'نام برنامه نامعلوم'}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted">نتیجه‌ی نقدی</div>
            <div className={`font-extrabold text-lg leading-tight ${rec.cash >= 0 ? 'text-success' : 'text-danger'}`}>
              <Num>{money(rec.cash)}</Num>
            </div>
            <div className="text-xs text-secondary">بدون ایردراپ</div>
          </div>
        </div>
      </div>

      {/* Plan in words */}
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const { icon: Icon, cls } = stepLook[s.tone];
          return (
            <li key={i} className={`flex gap-3 border rounded-lg px-3 py-2.5 ${cls}`}>
              <Icon size={18} className="shrink-0 mt-0.5" />
              <div className="min-w-0 text-sm">
                <div className="font-bold">{s.title}</div>
                <p className="text-secondary">{s.text}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <ExitChart plan={plan} days={a.days} />

      {/* Checkpoints */}
      <div>
        <div className="text-sm font-bold text-primary mb-2">قیمت فروش بی‌ضرر در هر مرحله</div>
        <div className="flex flex-col divide-y divide-default rounded-xl border border-default overflow-hidden">
          {plan.milestones.map((m) => (
            <div key={m.day} className={`grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 px-3 py-2.5 text-sm ${m.day === rec.day ? 'bg-accent/10' : ''}`}>
              <div className="text-primary font-medium">
                {dayToDate(m.day)} {m.day === rec.day && <span className="text-accent text-xs">★</span>}
              </div>
              <div className="text-secondary text-left sm:text-right">
                <Num>{formatCompact(m.points)}</Num> پوینت
              </div>
              <div className={m.cash >= 0 ? 'text-success' : 'text-danger'}>
                <Num>{money(m.cash)}</Num>
              </div>
              <div className="text-secondary text-left sm:text-right">
                {m.breakEvenPrice <= 0 ? (
                  'هر قیمتی'
                ) : (
                  <>
                    YT ≥ <Num className="text-primary">{formatNumber(m.breakEvenPrice, 4)}</Num>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {set && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="سقف ضرر قابل قبول" value={p.maxExitLoss} onChange={(v) => set('maxExitLoss', v)} suffix="%" />
          <TextField label="تاریخ اسنپ‌شات" type="date" value={p.snapshotDate} onChange={(v) => set('snapshotDate', v)} />
        </div>
      )}

      <p className="text-xs text-muted">با فرض ثابت ماندن نرخ بازار و ۰٫۵٪ هزینه‌ی فروش. قیمت YT بر حسب {p.dataMeta?.accountingSymbol ? <bdi dir="ltr">{p.dataMeta.accountingSymbol}</bdi> : 'دارایی پایه'} است؛ نتیجه‌ها به دلار آمریکا.</p>
    </Card>
  );
}
