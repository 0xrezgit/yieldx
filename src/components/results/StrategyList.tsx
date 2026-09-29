'use client';

import type { ReactNode } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import type { Analysis, StrategyId, StrategySummary } from '../../lib/analysis';
import type { Insight, Verdict } from '../../lib/risk/advisor';
import type { ScenarioParams, ScenarioSetter } from '../../types/scenario';
import { formatCompact, formatMultiplier, formatNumber, formatPercent, formatRateCapped, formatUSD } from '../../lib/utils/formatting';
import { CappedRate, FinancialNumber } from '../ui/financial';
import { Badge, riskLabel, riskTone, strategyColor } from '../ui/badge';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import type { FieldMessages } from '../forms/messages';
import { InsightRow } from './InsightList';

const TAGLINE: Record<StrategyId, string> = {
  pt: 'سود ثابت تا سررسید',
  loop: 'سود ثابت با اهرم',
  yt: 'بازده متغیر + پوینت',
  clmm: 'کارمزد + پوینت',
};

interface Props {
  p: ScenarioParams;
  a: Analysis;
  verdict: Verdict;
  insights: Insight[];
  /** Omit to render read-only (history pages). */
  set?: ScenarioSetter;
  msg?: FieldMessages;
  columns?: 1 | 2;
}

export function StrategyList({ p, a, verdict, insights, set, msg, columns = 1 }: Props) {
  return (
    <div className={`grid gap-3 ${columns === 2 ? 'md:grid-cols-2' : ''}`}>
      {a.strategies.map((s) => (
        <StrategyItem
          key={s.id}
          s={s}
          best={verdict.best?.id === s.id}
          insights={insights.filter((i) => i.strategy === s.id && i.severity !== 'info')}
        >
          <Details id={s.id} p={p} a={a} set={set} msg={msg} />
        </StrategyItem>
      ))}
    </div>
  );
}

function StrategyItem({
  s,
  best,
  insights,
  children,
}: {
  s: StrategySummary;
  best: boolean;
  insights: Insight[];
  children: ReactNode;
}) {
  const c = strategyColor[s.id];
  const problems = insights.filter((i) => i.severity === 'critical' || i.severity === 'warning').length;
  return (
    <details
      className={`group rounded-lg border bg-surface min-w-0 transition-colors ${best ? 'border-accent' : 'border-default'} ${s.available ? '' : 'border-dashed'}`}
    >
      <summary className="tap flex items-center gap-3 p-4">
        <span className={`self-stretch w-1 rounded-full ${c.bg}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-primary">{s.name}</span>
            {best && (
              <Badge tone="accent">
                <Star size={11} aria-hidden /> پیشنهاد
              </Badge>
            )}
            {!s.available && <Badge tone="muted">فقط برای مقایسه</Badge>}
          </div>
          <div className="text-sm text-muted flex items-center gap-2 flex-wrap">
            {TAGLINE[s.id]}
            <Badge tone={riskTone[s.risk]}>{riskLabel[s.risk]}</Badge>
            {problems > 0 && <Badge tone="danger">{formatNumber(problems, 0)} هشدار</Badge>}
          </div>
        </div>
        <div className="text-left shrink-0 flex flex-col items-end">
          {Number.isFinite(s.pnl) && (s.available || s.id === 'clmm') ? (
            <>
              <FinancialNumber value={s.pnl} kind="usd" digits={0} signed tone className="text-lg font-semibold" />
              <span className="text-xs text-secondary">
                <Num>{formatPercent(s.roi, 1, true)}</Num> · نقدی
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">—</span>
          )}
        </div>
        <ChevronDown size={18} className="text-muted transition-transform group-open:rotate-180 shrink-0" />
      </summary>
      <div className="px-4 pb-4 flex flex-col gap-4">
        {s.unavailableReason && <p className="text-sm text-warning">{s.unavailableReason}</p>}
        {insights.length > 0 && (
          <ul className="flex flex-col gap-2">
            {insights.map((i) => (
              <InsightRow key={i.id} insight={i} />
            ))}
          </ul>
        )}
        {children}
      </div>
    </details>
  );
}

function Facts({ items }: { items: [string, ReactNode, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map(([label, value, color]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className={`font-semibold ${color ?? 'text-primary'}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const n = (s: string) => <Num>{s}</Num>;

function Details({
  id,
  p,
  a,
  set,
  msg,
}: {
  id: StrategyId;
  p: ScenarioParams;
  a: Analysis;
  set?: ScenarioSetter;
  msg?: FieldMessages;
}) {
  if (id === 'pt') {
    return (
      <Facts
        items={[
          ['بازده ثابت سالانه', n(formatPercent(a.implied.impliedAPY))],
          ['سود تا سررسید', n(formatUSD(a.pt.fixedReturn))],
        ]}
      />
    );
  }

  if (id === 'yt') {
    const yt = a.yt;
    return (
      <Facts
        items={[
          ['اهرم بازده', n(formatMultiplier(yt.leverage, 1))],
          ['بازده تا سررسید', n(formatUSD(yt.yieldBase))],
          ['APY سربه‌سر', n(formatPercent(yt.breakEvenAPY)), yt.breakEvenAPY > p.baseAPY ? 'text-warning' : 'text-success'],
          ['پوینت', n(formatCompact(yt.points))],
          ['ارزش فرضی ایردراپ (سناریو)', n(formatUSD(yt.airdropValue)), 'text-secondary'],
          ['سوخت سرمایه', n(formatUSD(yt.valuation.burn)), yt.valuation.burn > 0 ? 'text-danger' : 'text-success'],
        ]}
      />
    );
  }

  if (id === 'loop') {
    const l = a.looping;
    const fill = Math.min(100, (l.aggregateLTV / p.liquidationThreshold) * 100);
    return (
      <>
        {set && msg && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="LTV هر حلقه" value={p.ltv} onChange={(v) => set('ltv', v)} suffix="%" error={msg.error('ltv')} />
            <NumberField label="تعداد حلقه" value={p.loops} onChange={(v) => set('loops', v)} error={msg.error('loops')} />
            <NumberField label="نرخ وام" value={p.borrowAPY} onChange={(v) => set('borrowAPY', v)} suffix="%" />
            <NumberField
              label="آستانه‌ی لیکوئید"
              value={p.liquidationThreshold}
              onChange={(v) => set('liquidationThreshold', v)}
              suffix="%"
            />
          </div>
        )}
        <Facts
          items={[
            ['اهرم', n(formatMultiplier(l.leverage, 2))],
            ['APY خالص', n(formatPercent(l.netAPY)), l.netAPY >= 0 ? 'text-success' : 'text-danger'],
            ['لیکوئید در Implied', <CappedRate key="liq" x={l.liquidation.liquidationImpliedAPY} />],
          ['بدهی', n(formatUSD(l.debt, 0))],
          ['Health Factor', n(Number.isFinite(l.liquidation.healthFactor) ? formatNumber(l.liquidation.healthFactor, 2) : '∞')],
            ['نرخ وام سربه‌سر', n(formatPercent(l.breakEvenBorrowAPY))],
          ]}
        />
        <div>
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>سلامت موقعیت</span>
            <Num>
              {formatPercent(l.aggregateLTV, 0)} / {formatPercent(p.liquidationThreshold, 0)}
            </Num>
          </div>
          <div className="relative h-2 rounded-full bg-linear-to-l from-success via-warning to-danger">
            <i className="absolute -top-1 h-4 w-1 rounded bg-white shadow" style={{ right: `${fill}%` }} />
          </div>
        </div>
      </>
    );
  }

  // CLMM
  const c = a.clmm;
  const implied = a.implied.impliedAPY;
  const width = p.rangeUpperAPY - p.rangeLowerAPY;
  const lo = p.rangeLowerAPY - width * 0.25;
  const span = width * 1.5 || 1;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;
  return (
    <>
      {set && msg && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="کف بازه"
            value={p.rangeLowerAPY}
            onChange={(v) => set('rangeLowerAPY', v)}
            suffix="%"
            error={msg.error('rangeLowerAPY')}
          />
          <NumberField label="سقف بازه" value={p.rangeUpperAPY} onChange={(v) => set('rangeUpperAPY', v)} suffix="%" />
          <NumberField label="APY کارمزد" value={p.feeAPY} onChange={(v) => set('feeAPY', v)} suffix="%" />
          <NumberField label="ضریب پوینت LP" value={p.lpMultiplier} onChange={(v) => set('lpMultiplier', v)} suffix="×" />
        </div>
      )}
      <div dir="ltr" className="relative h-6" aria-label="جای نرخ فعلی در بازه">
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1.5 rounded-full bg-elevated" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-st-clmm/70"
          style={{ left: pos(p.rangeLowerAPY), right: `calc(100% - ${pos(p.rangeUpperAPY)})` }}
        />
        {Number.isFinite(implied) && (
          <i
            className={`absolute top-0 h-6 w-1 rounded ${c.inRange ? 'bg-white' : 'bg-danger'}`}
            style={{ left: pos(implied) }}
          />
        )}
      </div>
      <Facts
        items={[
          ['درآمد کارمزد', n(formatUSD(c.feeIncome))],
          ['پوینت LP', n(formatCompact(c.points))],
          ['IL در کف بازه', n(formatPercent(c.ilAtLowerEdge)), 'text-warning'],
          ['IL در سقف بازه', n(formatPercent(c.ilAtUpperEdge)), 'text-warning'],
        ]}
      />
    </>
  );
}
