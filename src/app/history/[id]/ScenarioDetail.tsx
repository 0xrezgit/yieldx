'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Pencil } from 'lucide-react';
import { loadScenario } from '../../../hooks/useScenarios';
import { analyzeScenario } from '../../../lib/analysis';
import { buildInsights, buildVerdict } from '../../../lib/risk/advisor';
import { formatDate } from '../../../lib/utils/formatting';
import type { SavedScenario } from '../../../types/scenario';
import { InsightList } from '../../../components/results/InsightList';
import { ResultSummary } from '../../../components/dashboard/ResultView';
import { AssetIdentity } from '../../../components/ui/asset-identity';
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

  if (s === undefined) return <Loader2 className="animate-spin text-secondary mx-auto my-24" aria-label="در حال بارگذاری" />;
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
    <main className="sx max-w-4xl mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <Link href="/history" className="tap inline-flex items-center gap-1 text-sm text-secondary self-start">
            <ArrowRight size={14} aria-hidden /> سناریوها
          </Link>
          <h1 className="page-title truncate">{s.name}</h1>
          <p className="text-sm text-info">سناریوی فرضی — معامله‌ی واقعی نیست · آخرین تغییر {formatDate(s.updatedAt)} · با تاریخ امروز دوباره تحلیل شده</p>
        </div>
        <Link href={`/dashboard?scenario=${encodeURIComponent(s.id)}`} className="tap flex items-center gap-1.5 rounded-lg px-4 min-h-11 text-white bg-brand font-semibold shrink-0">
          <Pencil size={15} aria-hidden /> ویرایش در تحلیل بازار
        </Link>
      </div>

      {p.marketName && <AssetIdentity symbol={p.marketName} icon={p.marketIcon} chain={p.chain} protocol={p.protocol} platform={p.platform} maturity={p.maturity} size={48} />}
      <ResultSummary p={p} a={a} verdict={verdict} focus="auto" />
      <InsightList insights={insights} verdict={verdict} triggered={[]} />
      <MarketBrief p={p} a={a} />
      <StrategyList p={p} a={a} verdict={verdict} insights={insights} columns={2} />
      <ExitPlanCard p={p} a={a} />
      <PointsPanel p={p} a={a} />
    </main>
  );
}
