'use client';

import { useDeferredValue, useMemo } from 'react';
import { Compass } from 'lucide-react';
import type { Analysis } from '../../lib/market/analysis';
import { MAX_SHARE, nearestPaths, type Plan } from '../../lib/opportunity/goal-plan';
import type { HorizonDays } from '../../lib/opportunity/policy';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Pill } from '../opportunities/parts';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);

function PlanParts({ p }: { p: Plan }) {
  if (!p.parts.length) return <span className="text-secondary">هیچ گزینه‌ای</span>;
  const idle = p.amount - p.parts.reduce((s, x) => s + x.amount, 0);
  return (
    <ul className="flex flex-col gap-1">
      {p.parts.map((x) => (
        <li key={x.o.key} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">
            <bdi dir="ltr" className="font-medium">
              {x.o.market.name}
            </bdi>{' '}
            <span className="text-secondary">
              · {x.o.protocol.name}
            </span>
          </span>
          <span className="shrink-0 text-secondary">
            <Num>{usd(x.amount)}</Num> ← <Num className="text-primary font-semibold">{usd(x.net)}</Num>
          </span>
        </li>
      ))}
      {idle > p.amount * 0.01 && (
        <li className="text-xs text-warning">
          <Num>{usd(idle)}</Num> جای قابل‌برآوردی پیدا نکرد و بی‌کار می‌ماند.
        </li>
      )}
    </ul>
  );
}

/**
 * «نزدیک‌ترین راه‌های واقعی»: what is in reach when the target is not reached with
 * locked dollars — over every market and strategy, as portfolios (lib/opportunity/goal-plan).
 */
export function NearPaths({ analysis, days, capital, target }: { analysis: Analysis; days: HorizonDays; capital: number; target: number }) {
  const a = useDeferredValue(analysis);
  const r = useMemo(() => nearestPaths(a.rows, a.gas, days, capital, target), [a, days, capital, target]);
  const lockedPct = capital > 0 ? (r.realistic.locked.total / capital) * 100 : 0;
  return (
    <section className="sx-card p-4 flex flex-col gap-4">
      <h3 className="font-semibold flex items-center gap-1.5">
        <Compass size={16} aria-hidden /> نزدیک‌ترین راه‌های واقعی
      </h3>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">۱. هدف واقع‌بینانه با همین سرمایه و مدت</h4>
        <p className="text-sm">
          قفل‌شده تا <Num className="font-semibold">{usd(r.realistic.locked.total)}</Num> (<Num>{formatPercent(lockedPct, 1)}</Num>) · با نرخ متغیر هم تا <Num className="font-semibold">{usd(r.realistic.variable.total)}</Num>
        </p>
        <PlanParts p={r.realistic.locked} />
        {r.realistic.variable.total > r.realistic.locked.total && (
          <details className="text-sm">
            <summary className="cursor-pointer text-secondary">ترکیب با نرخ متغیر</summary>
            <div className="pt-2">
              <PlanParts p={r.realistic.variable} />
            </div>
          </details>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">۲. سرمایه‌ی لازم برای همین هدف، فقط با سود قفل‌شده</h4>
        {r.capitalLocked.reachable && r.capitalLocked.plan ? (
          <>
            <p className="text-sm">
              حدود <Num className="font-semibold">{usd(r.capitalLocked.capital as number)}</Num> برای <Num>{usd(target)}</Num> در <Num>{formatNumber(days, 0)}</Num> روز؛ در هر مبلغ دوباره برآورد شد، نه با تناسب.
            </p>
            <PlanParts p={r.capitalLocked.plan} />
          </>
        ) : (
          <p className="text-sm text-danger">
            با هیچ سرمایه‌ای نمی‌رسد: بازارهای قفل‌شده‌ی امروز در این مدت روی هم حدود <Num>{usd(r.capitalLocked.maxTotal)}</Num> سود جا دارند.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">۳. همین سرمایه در مدت‌های دیگر</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-secondary">
              <th className="text-start font-normal pb-1">مدت</th>
              <th className="text-end font-normal pb-1">قفل‌شده</th>
              <th className="text-end font-normal pb-1">با نرخ متغیر</th>
            </tr>
          </thead>
          <tbody>
            {r.horizons.map((h) => (
              <tr key={h.days} className={`border-t border-default ${h.days === days ? 'bg-accent/8' : ''}`}>
                <td className="py-1.5">
                  <Num>{formatNumber(h.days, 0)}</Num> روز
                </td>
                <td className={`py-1.5 text-end ${h.locked >= target ? 'text-success' : ''}`}>
                  <Num>{usd(h.locked)}</Num>
                </td>
                <td className={`py-1.5 text-end ${h.variable >= target ? 'text-success' : ''}`}>
                  <Num>{usd(h.variable)}</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">۴. کمترین سهم پرریسک برای رسیدن به هدف</h4>
        {r.blend ? (
          <>
            <p className="text-sm">
              <Num className="font-semibold">{formatPercent(r.blend.share * 100, 0)}</Num> سرمایه در گزینه‌های نرخ متغیر و بقیه قفل‌شده: <Num className="font-semibold">{usd(r.blend.total)}</Num>.{' '}
              <Pill tone="warning">بخش متغیر تضمین ندارد</Pill>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-secondary mb-1">متغیر</div>
                <PlanParts p={r.blend.variable} />
              </div>
              <div>
                <div className="text-xs text-secondary mb-1">قفل‌شده</div>
                <PlanParts p={r.blend.locked} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-secondary">{r.realistic.locked.total >= target ? 'لازم نیست.' : 'حتی همه‌ی سرمایه در گزینه‌های متغیر هم به هدف نمی‌رسد.'}</p>
        )}
      </div>

      <p className="text-xs text-secondary leading-6">
        هر سبد بین همه‌ی بازارها و استراتژی‌های دلاری ساخته می‌شود (سود به ETH، BTC یا SOL با قیمت آن‌ها عوض می‌شود و حساب نمی‌شود) و هیچ گزینه‌ای بیش از <Num>{formatPercent(MAX_SHARE * 100, 0)}</Num> آن را نمی‌گیرد؛ هر بخش در مبلغ خودش دوباره برآورد شده (ظرفیت، اثر قیمت، هزینه و گس). پاداش Merkl در این سبدها حساب نشده است.
      </p>
    </section>
  );
}
