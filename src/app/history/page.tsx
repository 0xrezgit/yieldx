'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ChevronLeft, FolderOpen, Loader2, Trash2 } from 'lucide-react';
import protocols from '../../config/protocols.json';
import { useScenarios } from '../../hooks/useScenarios';
import { analyzeScenario } from '../../lib/analysis';
import { buildInsights, buildVerdict } from '../../lib/risk/advisor';
import { formatDate, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../../components/ui/num';
import { TokenLogo } from '../../components/ui/token-logo';

const dot = { go: 'bg-success', caution: 'bg-warning', stop: 'bg-danger' } as const;

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
    <main className="max-w-matrix mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold text-primary">سناریوها</h1>

      {loading && <Loader2 className="animate-spin text-secondary mx-auto my-10" />}

      {!loading && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 text-center bg-surface/80 border border-default rounded-2xl p-10">
          <FolderOpen size={36} className="text-muted" />
          <p className="text-secondary">هنوز سناریویی ذخیره نکرده‌اید.</p>
          <Link href="/dashboard" className="rounded-xl px-4 py-2 text-white brand-gradient">
            رفتن به داشبورد
          </Link>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ s, a, verdict }) => (
          <div key={s.id} className="bg-surface/80 border border-default rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/history/${encodeURIComponent(s.id)}`} className="min-w-0 flex-1 group flex items-center gap-3">
                <TokenLogo src={s.data.marketIcon} name={s.data.marketName || s.name} size={40} />
                <span className="min-w-0">
                  <span className="block font-bold text-primary truncate group-hover:text-accent">{s.name}</span>
                  <span className="block text-xs text-muted truncate">
                    {protocols[s.data.protocol]?.name ?? s.data.protocol}
                    {s.data.chain ? ` · ${s.data.chain}` : ''} · {formatDate(s.updatedAt)}
                  </span>
                </span>
              </Link>
              {new Date(s.data.maturity).getTime() <= Date.now() && (
                <span className="shrink-0 rounded-full bg-danger/15 text-danger text-[11px] px-2 py-0.5">منقضی</span>
              )}
              <button
                type="button"
                onClick={() => confirm(`«${s.name}» حذف شود؟`) && remove(s.id)}
                className="p-1.5 text-muted hover:text-danger"
                aria-label="حذف"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className={`size-2.5 rounded-full shrink-0 ${dot[verdict.level]}`} />
              <span className="text-secondary truncate">{verdict.title}</span>
              {verdict.best && (
                <Num className={`mr-auto font-bold ${verdict.best.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatUSD(verdict.best.pnl, 0)}
                </Num>
              )}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">
                نرخ بازار <Num className="text-primary">{formatPercent(a.implied.impliedAPY)}</Num>
              </span>
              <Link
                href={`/dashboard?scenario=${encodeURIComponent(s.id)}`}
                className="flex items-center gap-1 text-accent font-medium"
              >
                باز کردن <ChevronLeft size={16} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
