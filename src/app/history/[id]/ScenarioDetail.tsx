'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Pencil } from 'lucide-react';
import { loadScenario } from '../../../hooks/useScenarios';
import { analyzeScenario } from '../../../lib/analysis';
import { buildInsights, buildVerdict } from '../../../lib/risk/advisor';
import { formatDate } from '../../../lib/utils/formatting';
import type { SavedScenario } from '../../../types/scenario';
import { VerdictHero } from '../../../components/results/VerdictHero';
import { InsightList } from '../../../components/results/InsightList';
import { KeyNumbers } from '../../../components/results/KeyNumbers';
import { StrategyList } from '../../../components/results/StrategyList';
import { PointsPanel } from '../../../components/results/PointsPanel';
import { ExitPlanCard } from '../../../components/results/ExitPlanCard';
import { MarketBrief } from '../../../components/results/MarketBrief';

/** A saved scenario, re-analysed with today's date (read-only). */
export default function ScenarioDetail({ id }: { id: string }) {
  const [s, setS] = useState<SavedScenario | null | undefined>(undefined);

  useEffect(() => {
    loadScenario(id).then(setS);
  }, [id]);

  const view = useMemo(() => {
    if (!s) return null;
    const a = analyzeScenario(s.data);
    const insights = buildInsights(s.data, a);
    return { a, insights, verdict: buildVerdict(a, insights) };
  }, [s]);

  if (s === undefined) return <Loader2 className="animate-spin text-secondary mx-auto my-24" />;
  if (s === null || !view) {
    return (
      <main className="max-w-matrix mx-auto px-4 py-10 flex flex-col items-start gap-3">
        <p className="text-secondary">سناریو پیدا نشد.</p>
        <Link href="/history" className="text-accent">
          بازگشت
        </Link>
      </main>
    );
  }

  const p = s.data;
  const { a, insights, verdict } = view;

  return (
    <main className="max-w-4xl mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/history" className="inline-flex items-center gap-1 text-sm text-secondary">
            <ArrowRight size={14} /> سناریوها
          </Link>
          <h1 className="text-3xl lg:text-4xl font-medium tracking-tight text-primary truncate">{s.name}</h1>
          <p className="text-xs text-muted">آخرین تغییر {formatDate(s.updatedAt)}</p>
        </div>
        <Link
          href={`/dashboard?scenario=${encodeURIComponent(s.id)}`}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-white brand-gradient shrink-0"
        >
          <Pencil size={15} /> ویرایش
        </Link>
      </div>

      <VerdictHero verdict={verdict} />
      <InsightList insights={insights} verdict={verdict} triggered={[]} />
      <MarketBrief p={p} a={a} />
      <KeyNumbers p={p} a={a} />
      <StrategyList p={p} a={a} verdict={verdict} insights={insights} columns={2} />
      <ExitPlanCard p={p} a={a} />
      <PointsPanel p={p} a={a} />
    </main>
  );
}
