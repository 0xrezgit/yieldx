'use client';

import { useShell, type MobileTab } from '../layout/AppShell';
import { MarketForm } from '../forms/MarketForm';
import { AlertRules } from '../alerts/AlertRules';
import { Num } from '../ui/num';
import { button, FinancialNumber } from '../ui/financial';
import { formatNumber } from '../../lib/utils/formatting';
import { hasMarket, type ReadyDashboard } from './useDashboard';
import { focusStrategy, LoadingResult, MarketHeader, ResultSections, ResultSummary, StartState, Warnings } from './ResultView';
import { PageHeader } from './WebDashboard';
import { InsightList } from '../results/InsightList';

/** Mobile / PWA: the same analysis in three in-page tabs (the bottom bar holds the app's destinations). */
export function MobileDashboard({ d }: { d: ReadyDashboard }) {
  const { tab, setTab, alertCount } = useShell();
  const started = hasMarket(d.p);
  const current: MobileTab = started ? tab : 'market';
  const loading = !!d.p.marketId && !d.p.dataMeta && !d.p.manualEntry && d.md.state === 'loading';
  const s = focusStrategy(d.analysis, d.verdict, d.focus);

  const tabs: { id: MobileTab; label: string; count?: number }[] = [
    { id: 'market', label: 'ورودی' },
    { id: 'result', label: 'نتیجه' },
    { id: 'alerts', label: 'هشدارها', count: alertCount },
  ];

  return (
    <main className="sx px-4 py-4 flex flex-col gap-4 max-w-2xl mx-auto">
      <PageHeader d={d} />
      {started && (
        <div role="tablist" aria-label="بخش‌های تحلیل" className="sticky top-14 z-20 -mx-4 px-4 py-2 bg-canvas/95 backdrop-blur grid grid-cols-3 gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={current === t.id}
              onClick={() => setTab(t.id)}
              className={`tap min-h-11 rounded-lg text-[15px] inline-flex items-center justify-center gap-1.5 ${current === t.id ? 'bg-elevated text-primary font-semibold ring-1 ring-accent' : 'text-secondary'}`}
            >
              {t.label}
              {!!t.count && <span className="min-w-5 h-5 px-1 rounded-full bg-danger text-xs leading-5 text-[var(--c-bg)] font-semibold"><Num>{formatNumber(t.count, 0)}</Num></span>}
            </button>
          ))}
        </div>
      )}

      {current === 'market' && (
        <>
          <section className="sx-card p-4 flex flex-col gap-5" aria-label="ورودی‌ها">
            <MarketForm d={d} />
          </section>
          {!started ? (
            <StartState onManual={d.startManual} />
          ) : (
            // In the page flow (not floating), so it never covers the form or its last field.
            <button type="button" onClick={() => setTab('result')} className={`${button.primary} w-full justify-between`}>
              <span>دیدن نتیجه — {s.name}</span>
              {!loading && s.available && <FinancialNumber value={s.pnl} kind="usd" digits={0} signed className="text-white [&_.text-secondary]:text-white" />}
            </button>
          )}
        </>
      )}

      {current === 'result' && (
        <div className="flex flex-col gap-5">
          <MarketHeader d={d} />
          {loading ? (
            <LoadingResult />
          ) : (
            <>
              <ResultSummary p={d.p} a={d.analysis} verdict={d.verdict} focus={d.focus} />
              <Warnings d={d} />
              <ResultSections d={d} />
            </>
          )}
        </div>
      )}

      {current === 'alerts' && (
        <div className="flex flex-col gap-4">
          <InsightList insights={d.insights} verdict={d.verdict} triggered={d.triggered} />
          <section className="sx-card p-4">
            <h2 className="text-base font-semibold text-primary mb-3">هشدارهای من</h2>
            <AlertRules analysis={d.analysis} alerts={d.alerts} />
          </section>
        </div>
      )}
    </main>
  );
}
