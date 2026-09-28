'use client';

import { ArrowLeft, Bell, Gift, SlidersHorizontal } from 'lucide-react';
import { useShell } from '../layout/AppShell';
import { Card, Collapsible } from '../ui/card';
import { Num } from '../ui/num';
import { MarketForm } from '../forms/MarketForm';
import { AirdropForm } from '../forms/AirdropForm';
import { VerdictHero } from '../results/VerdictHero';
import { InsightList } from '../results/InsightList';
import { KeyNumbers } from '../results/KeyNumbers';
import { StrategyList } from '../results/StrategyList';
import { PointsPanel } from '../results/PointsPanel';
import { ApyOutlook } from '../results/ApyOutlook';
import { SensitivityPanel } from '../results/SensitivityPanel';
import { ExitPlanCard } from '../results/ExitPlanCard';
import { MarketBrief } from '../results/MarketBrief';
import { AlertRules } from '../alerts/AlertRules';
import { SaveBar } from './SaveBar';
import type { ReadyDashboard } from './useDashboard';
import { formatUSD, formatUSDCompact } from '../../lib/utils/formatting';

const ctaTone = { go: 'bg-success', caution: 'bg-warning', stop: 'bg-danger' } as const;

/** Mobile / PWA: three screens switched by the bottom bar. */
export function MobileDashboard({ d }: { d: ReadyDashboard }) {
  const { tab, setTab } = useShell();
  const { p, analysis: a, verdict, insights, msg } = d;

  if (tab === 'market') {
    return (
      <main className="px-4 py-4 flex flex-col gap-3 max-w-lg mx-auto">
        <Card title="بازار" icon={<SlidersHorizontal size={18} />}>
          <MarketForm p={p} set={d.set} replace={d.setP} msg={msg} />
        </Card>
        <Collapsible
          title="پوینت و ایردراپ"
          icon={<Gift size={18} />}
          badge={
            <span className="text-xs text-muted font-normal">
              FDV <Num>{formatUSDCompact(p.fdv)}</Num>
            </span>
          }
        >
          <AirdropForm p={p} set={d.set} msg={msg} />
        </Collapsible>

        {/* Sticky shortcut to the result, coloured by verdict. */}
        <button
          type="button"
          onClick={() => setTab('result')}
          className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] mt-2 flex items-center justify-between gap-3 rounded-2xl bg-elevated border border-strong px-4 py-3 shadow-xl shadow-black/40"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className={`size-2.5 rounded-full shrink-0 ${ctaTone[verdict.level]}`} />
            <span className="font-bold text-primary truncate">{verdict.title}</span>
          </span>
          <span className="flex items-center gap-1 text-accent font-medium shrink-0">
            {verdict.best && <Num className="text-success">{formatUSD(verdict.best.pnl, 0)}</Num>}
            <ArrowLeft size={18} />
          </span>
        </button>
      </main>
    );
  }

  if (tab === 'alerts') {
    return (
      <main className="px-4 py-4 flex flex-col gap-3 max-w-lg mx-auto">
        <Card title="هشدارهای فعلی" icon={<Bell size={18} />}>
          <InsightList insights={insights} verdict={verdict} triggered={d.triggered} />
        </Card>
        <Card title="هشدارهای من">
          <AlertRules analysis={a} alerts={d.alerts} />
        </Card>
      </main>
    );
  }

  return (
    <main className="px-4 py-4 flex flex-col gap-3 max-w-lg mx-auto">
      <VerdictHero verdict={verdict} compact />
      <InsightList insights={insights} verdict={verdict} triggered={d.triggered} />
      <MarketBrief p={p} a={a} />
      <KeyNumbers p={p} a={a} />
      <h2 className="font-bold text-primary mt-2">استراتژی‌ها</h2>
      <StrategyList p={p} a={a} verdict={verdict} insights={insights} set={d.set} msg={msg} />
      <ExitPlanCard p={p} a={a} set={d.set} />
      <PointsPanel p={p} a={a} />
      <ApyOutlook p={p} a={a} />
      <SensitivityPanel p={p} days={a.days} />
      <div className="mt-2">
        <SaveBar d={d} />
      </div>
    </main>
  );
}
