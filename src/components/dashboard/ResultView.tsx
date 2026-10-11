'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChartCandlestick, OctagonAlert, PencilLine, RefreshCw, Search, ShieldAlert, TriangleAlert } from 'lucide-react';
import protocols from '../../config/protocols.json';
import type { Analysis, StrategyId, StrategySummary } from '../../lib/analysis';
import type { Insight, Verdict } from '../../lib/risk/advisor';
import type { ScenarioParams } from '../../types/scenario';
import { formatDate, formatDateTime, formatGregorian, formatNumber, formatPercent, formatRateCapped, formatUSD } from '../../lib/utils/formatting';
import { protocolIdentity } from '../../lib/registry/identity';
import { AssetIdentity } from '../ui/asset-identity';
import { DataStatus } from '../ui/data-status';
import { button, CappedRate, EmptyState, FinancialNumber, MetricCard } from '../ui/financial';
import { InlineHelp } from '../ui/inline-help';
import { Badge, riskLabel, riskTone } from '../ui/badge';
import { Num } from '../ui/num';
import { InsightList } from '../results/InsightList';
import { StrategyList } from '../results/StrategyList';
import { ExitPlanCard } from '../results/ExitPlanCard';
import { PointsPanel } from '../results/PointsPanel';
import { ApyOutlook } from '../results/ApyOutlook';
import { SensitivityPanel } from '../results/SensitivityPanel';
import { MarketBrief } from '../results/MarketBrief';
import { AlertRules } from '../alerts/AlertRules';

/** Before a market is chosen: what the page does, and how to start. No sample result is shown as real. */
export function StartState({ onManual }: { onManual: () => void }) {
  return (
    <EmptyState
      icon={<ChartCandlestick size={24} aria-hidden />}
      title="یک بازار انتخاب کنید"
      action={
        <button type="button" onClick={onManual} className={button.ghost}>
          <PencilLine size={15} aria-hidden /> ورود دستی مقادیر
        </button>
      }
    >
      بازار و سرمایه را انتخاب کنید.
      <span className="block mt-2 text-muted">
        <Search size={13} className="inline -mt-0.5" aria-hidden /> بازار مناسب را نمی‌دانید؟ از{' '}
        <Link href="/" className="text-accent underline underline-offset-4">
          تحلیل بازار
        </Link>{' '}
        شروع کنید.
      </span>
    </EmptyState>
  );
}

/** Placeholder with the final layout's size while a new market loads (no layout jump, no stale numbers). */
export function LoadingResult() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">در حال دریافت داده‌ی بازار…</span>
      <div className="h-[76px] rounded-lg bg-surface border border-default animate-pulse" />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="col-span-full h-[112px] rounded-lg bg-surface border border-default animate-pulse" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[104px] rounded-lg bg-surface border border-default animate-pulse" />
        ))}
      </div>
      <div className="h-40 rounded-lg bg-surface border border-default animate-pulse" />
    </div>
  );
}


const MISSING_FA: Record<string, string> = {
  underlyingPrice: 'قیمت دلاری دارایی',
  baseAPY: 'بازده پایه',
  apyHistory: 'تاریخچه‌ی APY',
  liquidity: 'نقدینگی',
};
const missingLabel = (k: string) => MISSING_FA[k] ?? k;

/** The strategy the summary talks about: the user's choice, or the recommendation. */
export function focusStrategy(a: Analysis, verdict: Verdict, focus: StrategyId | 'auto'): StrategySummary {
  if (focus !== 'auto') return a.strategies.find((s) => s.id === focus) ?? a.strategies[0];
  return verdict.best ?? a.ranked[0] ?? a.strategies[0];
}

const LEVEL = {
  go: { icon: CheckCircle2, cls: 'text-success' },
  caution: { icon: TriangleAlert, cls: 'text-warning' },
  stop: { icon: OctagonAlert, cls: 'text-danger' },
} as const;

/** At most four figures for the chosen strategy. The headline is the estimated CASH result — never the airdrop. */
export function ResultSummary({ p, a, verdict, focus }: { p: ScenarioParams; a: Analysis; verdict: Verdict; focus: StrategyId | 'auto' }) {
  const s = focusStrategy(a, verdict, focus);
  const lv = LEVEL[verdict.level];
  const LvIcon = lv.icon;
  const loop = a.looping;
  const isAuto = focus === 'auto';

  return (
    <section className="flex flex-col gap-3" aria-labelledby="result-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="result-title" className="text-xl font-semibold text-primary">
          {s.name}
        </h2>
        <Badge tone={riskTone[s.risk]}>{riskLabel[s.risk]}</Badge>
        {isAuto && (
          <span className={`inline-flex items-center gap-1 text-sm ${lv.cls}`}>
            <LvIcon size={16} aria-hidden /> {verdict.level === 'go' ? `پیشنهاد: ${verdict.title}` : verdict.title}
          </span>
        )}
      </div>
      {!s.available && <p className="text-sm text-warning">{s.unavailableReason}</p>}
      {isAuto && !verdict.best && <p className="text-sm text-secondary">{verdict.summary}</p>}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <MetricCard
          emphasis
          label="نتیجه‌ی نقدی تخمینی تا سررسید"
          help={<InlineHelp term="نتیجه‌ی نقدی">سود یا زیان دلاری با فرض ثابت ماندن نرخ‌ها، بدون هیچ ارزشی برای پوینت یا ایردراپ. ایردراپ جداگانه در «پوینت و فرض‌ها» آمده است.</InlineHelp>}
          sub="بدون ارزش فرضی ایردراپ"
        >
          {s.available ? <FinancialNumber value={s.pnl} kind="usd" digits={0} signed tone word /> : <FinancialNumber value={null} missing={s.unavailableReason} />}
        </MetricCard>
        <MetricCard label="بازده روی سرمایه" sub={<>سرمایه <Num>{formatUSD(p.capital, 0)}</Num></>}>
          {s.available ? <FinancialNumber value={s.roi} kind="pct" digits={2} signed tone /> : <FinancialNumber value={null} />}
        </MetricCard>
        {s.id === 'loop' ? (
          <MetricCard label="بازده خالص سالانه (با اهرم)" sub={<>اهرم <Num>{formatNumber(loop.leverage, 2)}×</Num></>}>
            <FinancialNumber value={loop.netAPY} kind="pct" />
          </MetricCard>
        ) : s.id === 'yt' ? (
          <MetricCard label="بازده پایه در برابر نرخ بازار" sub={<>نرخ بازار (Implied) <Num>{formatPercent(a.implied.impliedAPY)}</Num></>}>
            <FinancialNumber value={p.baseAPY} kind="pct" missing="بازده پایه معلوم نیست" />
          </MetricCard>
        ) : (
          <MetricCard label="نرخ ثابت بازار (Implied APY)" sub={Number.isFinite(p.baseAPY) ? <>بازده شناور <Num>{formatPercent(p.baseAPY)}</Num></> : 'بازده شناور: نامعلوم'}>
            <FinancialNumber value={a.implied.impliedAPY} kind="pct" />
          </MetricCard>
        )}
        <MetricCard label="تا سررسید" sub={<span title={`میلادی: ${formatGregorian(p.maturity)}`}>{formatDate(p.maturity)}</span>}>
          <span>
            <Num>{formatNumber(a.days, 0)}</Num> <span className="text-base font-normal">روز</span>
          </span>
        </MetricCard>
      </div>

      {s.id === 'loop' && <LoopHealth p={p} a={a} />}
    </section>
  );
}

/** Loop: health, debt and liquidation shown as prominently as the yield. */
function LoopHealth({ p, a }: { p: ScenarioParams; a: Analysis }) {
  const l = a.looping;
  const liq = l.liquidation;
  const fill = Math.min(100, (l.aggregateLTV / p.liquidationThreshold) * 100);
  const tone = liq.risk === 'high' ? 'text-danger' : liq.risk === 'medium' ? 'text-warning' : 'text-success';
  return (
    <div className="rounded-lg border border-default bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <ShieldAlert size={16} className={tone} aria-hidden /> سلامت پوزیشن (Health Factor){' '}
        <InlineHelp term="Health Factor">زیر ۱ یعنی لیکوئید.</InlineHelp>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="text-secondary text-xs">Health Factor</dt>
          <dd className={`text-lg font-semibold ${tone}`}>{Number.isFinite(liq.healthFactor) ? <Num>{formatNumber(liq.healthFactor, 2)}</Num> : '∞'}</dd>
        </div>
        <div>
          <dt className="text-secondary text-xs">بدهی (وام)</dt>
          <dd className="text-lg font-semibold text-primary">
            <FinancialNumber value={l.debt} kind="usd" digits={0} />
          </dd>
        </div>
        <div>
          <dt className="text-secondary text-xs">LTV کل / آستانه</dt>
          <dd className="text-lg font-semibold text-primary">
            <Num>{formatPercent(l.aggregateLTV, 1)}</Num> <span className="text-sm text-secondary">/ <Num>{formatPercent(p.liquidationThreshold, 0)}</Num></span>
          </dd>
        </div>
        <div>
          <dt className="text-secondary text-xs">لیکوئید اگر نرخ بازار برسد به</dt>
          <dd className={`text-lg font-semibold ${tone}`}>
            <CappedRate x={liq.liquidationImpliedAPY} />
          </dd>
        </div>
      </dl>
      <div className="h-2 rounded-full bg-elevated overflow-hidden" dir="ltr" role="meter" aria-label="LTV نسبت به آستانه‌ی لیکوئید" aria-valuenow={Math.round(fill)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${liq.risk === 'high' ? 'bg-danger' : liq.risk === 'medium' ? 'bg-warning' : 'bg-success'}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}


type Section = 'compare' | 'exit' | 'points' | 'alerts';

