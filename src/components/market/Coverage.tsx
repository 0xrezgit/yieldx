'use client';

import type { SourceStatus } from '../../lib/lending/types';
import type { Placement } from '../../types/opportunity';
import { COVERAGE, COVERAGE_CHECKED_AT, COVERAGE_LABEL, type CoverageStatus } from '../../lib/market/coverage';
import { PLACEMENT_LABEL } from '../../lib/market/labels';
import { formatAgo, formatDate, formatNumber } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

const DOT = { ok: 'bg-success', stale: 'bg-warning', error: 'bg-danger' } as const;
const STATE = { ok: 'سالم', stale: 'قدیمی', error: 'در دسترس نیست' } as const;
const TONE: Record<CoverageStatus, string> = { supported: 'text-success', partial: 'text-warning', insufficient: 'text-danger', unavailable: 'text-muted' };

/** Live source health, why opportunities are not ranked, and the product coverage matrix. */
export function Coverage({ sources, counts, total }: { sources: SourceStatus[]; counts: Record<Placement, number> | null; total: number }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return (
    <div className="flex flex-col gap-4 text-sm">
      <ul className="flex flex-col gap-1" aria-label="وضعیت منابع">
        {sources.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-secondary">
            <span className={`size-2 rounded-full shrink-0 ${DOT[s.state]}`} aria-hidden />
            <bdi dir="ltr" className="text-primary">
              {s.name}
            </bdi>
            <span>{STATE[s.state]}</span>
            {s.state !== 'error' && (
              <span>
                · <Num>{formatNumber(s.count, 0)}</Num>
              </span>
            )}
            {s.fetchedAt && <span className="text-muted">· {formatAgo(new Date(s.fetchedAt).getTime())}</span>}
          </li>
        ))}
      </ul>

      {counts && (
        <div>
          <h3 className="text-xs text-muted mb-1">
            <Num>{formatNumber(total, 0)}</Num> فرصت بررسی‌شده در این افق
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {(Object.keys(PLACEMENT_LABEL) as Placement[])
              .filter((p) => counts[p] > 0)
              .map((p) => (
                <li key={p} className="flex justify-between py-1 border-b border-default">
                  <span className="text-secondary">{PLACEMENT_LABEL[p]}</span>
                  <Num>{formatNumber(counts[p], 0)}</Num>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="text-right text-muted mb-1">پوشش محصولات · بررسی {formatDate(COVERAGE_CHECKED_AT)}</caption>
          <thead className="text-muted">
            <tr className="border-b border-default">
              <th className="text-right font-normal py-1 pe-2">پروتکل و محصول</th>
              <th className="text-right font-normal py-1 pe-2">شبکه</th>
              <th className="text-right font-normal py-1 pe-2">وضعیت</th>
              <th className="text-right font-normal py-1">علت</th>
            </tr>
          </thead>
          <tbody>
            {COVERAGE.map((r, i) => {
              const live = r.source ? byId.get(r.source) : undefined;
              return (
                <tr key={i} className="border-b border-default align-top">
                  <td className="py-1.5 pe-2 whitespace-nowrap">
                    <bdi dir="ltr">{r.protocol}</bdi> · {r.product}
                    {r.version && (
                      <span className="text-muted">
                        {' '}
                        <bdi dir="ltr">{r.version}</bdi>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pe-2 text-secondary">{r.networks}</td>
                  <td className={`py-1.5 pe-2 whitespace-nowrap ${TONE[r.status]}`}>
                    {COVERAGE_LABEL[r.status]}
                    {live && live.state !== 'ok' && <span className="text-danger"> · {STATE[live.state]}</span>}
                    {!r.ranked && <span className="text-muted"> · بدون رتبه</span>}
                  </td>
                  <td className="py-1.5 text-secondary">{r.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
