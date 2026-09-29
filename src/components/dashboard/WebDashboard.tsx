'use client';

import { MarketForm } from '../forms/MarketForm';
import { SaveBar } from './SaveBar';
import { hasMarket, type ReadyDashboard } from './useDashboard';
import { LoadingResult, MarketHeader, ResultSections, ResultSummary, StartState, Warnings } from './ResultView';

/** Page title row, identical position on every page. */
export function PageHeader({ d }: { d: ReadyDashboard }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="page-title">تحلیل بازار</h1>
        <p className="text-sm text-secondary">این استراتژی در این بازار چه نتیجه‌ای دارد؟</p>
      </div>
      {hasMarket(d.p) && <SaveBar d={d} />}
    </header>
  );
}

/** The result column: start state, loading placeholder, or the analysis. */
export function ResultColumn({ d }: { d: ReadyDashboard }) {
  const { p } = d;
  if (!hasMarket(p)) return <StartState onManual={d.startManual} />;
  const loading = !!p.marketId && !p.dataMeta && !p.manualEntry && d.md.state === 'loading';
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <MarketHeader d={d} />
      {loading ? (
        <LoadingResult />
      ) : (
        <>
          <ResultSummary p={p} a={d.analysis} verdict={d.verdict} focus={d.focus} />
          <Warnings d={d} />
          <ResultSections d={d} />
        </>
      )}
    </div>
  );
}

/** Desktop (≥ 1024px): form (340px) beside a flexible result column; one page scroll. */
export function WebDashboard({ d }: { d: ReadyDashboard }) {
  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-6">
      <PageHeader d={d} />
      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
        <aside className="sx-card p-5 flex flex-col gap-5 min-w-0" aria-label="ورودی‌ها">
          <MarketForm d={d} />
        </aside>
        <ResultColumn d={d} />
      </div>
    </main>
  );
}
