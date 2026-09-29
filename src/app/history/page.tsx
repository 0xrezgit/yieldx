'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ChevronLeft, FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react';
import { useScenarios } from '../../hooks/useScenarios';
import { analyzeScenario } from '../../lib/analysis';
import { buildInsights, buildVerdict } from '../../lib/risk/advisor';
import { formatDate, formatPercent } from '../../lib/utils/formatting';
import { Num } from '../../components/ui/num';
import { AssetIdentity } from '../../components/ui/asset-identity';
import { button, EmptyState, FinancialNumber } from '../../components/ui/financial';

const dot = { go: 'bg-success', caution: 'bg-warning', stop: 'bg-danger' } as const;

/** Saved what-if analyses — clearly apart from real, recorded positions (پرتفوی من). */
export default function HistoryPage() {
  const { items, loading, remove } = useScenarios();
  const rows = useMemo(
    () =>
      items.map((s) => {
        const a = analyzeScenario(s.data);
        return { s, a, verdict: buildVerdict(a, buildInsights(s.data, a)) };
      }),
    [items],
  );

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">سناریوها</h1>
          <p className="text-sm text-secondary max-w-2xl">
            تحلیل‌های «چه می‌شد اگر» که ذخیره کرده‌اید. سناریو معامله‌ی واقعی نیست؛ خریدهای واقعی در{' '}
            <Link href="/portfolio" className="text-accent underline underline-offset-4">
              پرتفوی من
            </Link>{' '}
            ثبت می‌شوند.
          </p>
        </div>
        {rows.length > 0 && (
          <Link href="/dashboard" className={button.primary}>
            <Plus size={16} aria-hidden /> سناریوی جدید
          </Link>
        )}
      </header>

      {loading && <Loader2 className="animate-spin text-secondary mx-auto my-10" aria-label="در حال بارگذاری" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon={<FlaskConical size={24} aria-hidden />}
          title="هنوز سناریویی ندارید"
          action={
            <Link href="/dashboard" className={button.primary}>
              <Plus size={16} aria-hidden /> ساخت اولین سناریو
            </Link>
          }
        >
          در «تحلیل بازار» یک بازار و سرمایه انتخاب کنید و نتیجه را با نامی ذخیره کنید تا بعداً با تاریخ روز دوباره تحلیل شود.
        </EmptyState>
      )}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ s, a, verdict }) => (
          <li key={s.id} className="rounded-lg border border-dashed border-strong bg-surface p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/history/${encodeURIComponent(s.id)}`} className="min-w-0 flex-1 flex flex-col gap-2 group">
                <span className="inline-flex items-center gap-1.5 text-xs text-info">
                  <FlaskConical size={13} aria-hidden /> سناریوی فرضی
                </span>
                <span className="font-semibold text-primary truncate group-hover:text-accent">{s.name}</span>
                {s.data.marketName && <AssetIdentity symbol={s.data.marketName} icon={s.data.marketIcon} chain={s.data.chain} protocol={s.data.protocol} maturity={s.data.maturity} size={24} />}
              </Link>
              <button type="button" onClick={() => confirm(`«${s.name}» حذف شود؟`) && remove(s.id)} className="tap grid place-items-center size-10 rounded-lg text-secondary hover:text-danger" aria-label={`حذف سناریوی ${s.name}`}>
                <Trash2 size={16} aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className={`size-2.5 rounded-full shrink-0 ${dot[verdict.level]}`} aria-hidden />
              <span className="text-secondary truncate">{verdict.title}</span>
              {verdict.best && <FinancialNumber value={verdict.best.pnl} kind="usd" digits={0} signed tone className="mr-auto font-semibold" />}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">
                ذخیره {formatDate(s.updatedAt)} · نرخ بازار <Num className="text-primary">{formatPercent(a.implied.impliedAPY)}</Num>
                {new Date(s.data.maturity).getTime() <= Date.now() && <span className="text-danger"> · سررسیدشده</span>}
              </span>
              <Link href={`/dashboard?scenario=${encodeURIComponent(s.id)}`} className="tap flex items-center gap-1 text-accent font-semibold">
                باز کردن <ChevronLeft size={16} aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
