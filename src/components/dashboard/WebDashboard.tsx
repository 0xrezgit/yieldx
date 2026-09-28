'use client';

import { Bell, Gift, SlidersHorizontal } from 'lucide-react';
import { Card, Collapsible } from '../ui/card';
import { Badge } from '../ui/badge';
import { MarketForm } from '../forms/MarketForm';
import { AirdropForm } from '../forms/AirdropForm';
import { VerdictHero } from '../results/VerdictHero';
import { InsightList } from '../results/InsightList';
import { KeyNumbers } from '../results/KeyNumbers';
import { StrategyList } from '../results/StrategyList';
import { PointsPanel } from '../results/PointsPanel';
import { ApyOutlook } from '../results/ApyOutlook';
import { SensitivityPanel } from '../results/SensitivityPanel';
import { AlertRules } from '../alerts/AlertRules';
import { SaveBar } from './SaveBar';
import type { ReadyDashboard } from './useDashboard';
import { formatNumber } from '../../lib/utils/formatting';

/** Desktop: inputs in a sticky side panel, results in the main column. */
export function WebDashboard({ d }: { d: ReadyDashboard }) {
  const { p, analysis: a, verdict, insights, msg } = d;
  const activeRules = d.triggered.length;

  return (
    <main className="max-w-matrix mx-auto px-6 py-6 grid grid-cols-[22rem_minmax(0,1fr)] gap-6 items-start">
      <aside className="sticky top-22 max-h-[calc(100dvh-7rem)] overflow-y-auto flex flex-col gap-4 pl-1">
        <Card title="بازار" icon={<SlidersHorizontal size={18} />}>
          <MarketForm p={p} set={d.set} replace={d.setP} msg={msg} />
        </Card>
        <Collapsible title="پوینت و ایردراپ" icon={<Gift size={18} />} defaultOpen>
          <AirdropForm p={p} set={d.set} msg={msg} />
        </Collapsible>
      </aside>

      <div className="flex flex-col gap-5 min-w-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-extrabold text-primary truncate">{p.marketName || 'داشبورد'}</h1>
          <SaveBar d={d} />
        </div>

        <VerdictHero verdict={verdict} />
        <InsightList insights={insights} verdict={verdict} triggered={d.triggered} />
        <KeyNumbers p={p} a={a} />

        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-primary">استراتژی‌ها</h2>
          <StrategyList p={p} a={a} verdict={verdict} insights={insights} set={d.set} msg={msg} columns={2} />
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <PointsPanel p={p} a={a} />
          <ApyOutlook p={p} a={a} />
        </div>

        <SensitivityPanel p={p} days={a.days} />

        <Collapsible
          title="هشدارهای من"
          icon={<Bell size={18} />}
          badge={activeRules > 0 && <Badge tone="accent">{formatNumber(activeRules, 0)} فعال</Badge>}
        >
          <AlertRules analysis={a} alerts={d.alerts} />
        </Collapsible>
      </div>
    </main>
  );
}
