'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, History, Target, Ticket, Trash2 } from 'lucide-react';
import type { BudgetPick } from '../../lib/calculators/points-worth';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { usePortfolioView } from '../../hooks/usePortfolioView';
import { formatCompact, formatDate, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { readTargets, useTargets, writeTargets } from './PointsWorthView';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const plain = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);

/**
 * «بودجه‌ی بلیت»: airdrops behave like tickets — most small or zero, a few large — so
 * no winner is picked: a loss budget is spread over several programs so that even if
 * every airdrop is zero the loss stays within it.
 */
export function BudgetPanel({ picks, budget, markets }: { picks: BudgetPick[]; budget: number; markets: Map<string, OpportunityListing> }) {
  const worst = picks.reduce((s, p) => s + p.worstUsd, 0);
  const spent = picks.reduce((s, p) => s + p.amountUsd, 0);
  return (
    <section className="sx-card p-3 sm:p-4 flex flex-col gap-3 text-sm" aria-label="بودجه‌ی بلیت">
      <h2 className="flex items-center gap-2 font-semibold text-primary">
        <Ticket size={17} className="text-accent" aria-hidden /> بودجه‌ی بلیت — به‌جای انتخاب برنده
      </h2>
      <p className="text-xs text-secondary leading-6">
        نتیجه‌ی ایردراپ‌ها را نمی‌شود پیش‌بینی کرد؛ این‌جا بودجه‌ی ضرر <Num>{plain(budget)}</Num> بین برنامه‌های مختلف (از هر برنامه بهترین بازار به ازای هر دلار ریسک) پخش شده تا حتی اگر <b>همه</b> صفر شوند، ضرر از بودجه بیشتر نشود.
      </p>
      {picks.length === 0 ? (
        <p className="text-secondary">بازار پوینت‌داری با داده‌ی قابل اتکا برای این بودجه نیست.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="py-2 px-2 text-right font-medium">بازار</th>
                  <th className="py-2 px-2 text-right font-medium">برنامه</th>
                  <th className="py-2 px-2 text-right font-medium">خرید YT</th>
                  <th className="py-2 px-2 text-right font-medium whitespace-normal">بدترین حالت</th>
                  <th className="py-2 px-2 text-right font-medium">پوینت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {picks.map((p) => {
                  const m = markets.get(p.id);
                  const likely = p.plan.maturity.find((x) => x.kind === 'likely')!;
                  return (
                    <tr key={p.id}>
                      <td className="py-2 px-2 min-w-[10rem]">{m ? <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} /> : p.id}</td>
                      <td className="py-2 px-2 whitespace-nowrap"><bdi dir="ltr">{p.plan.program?.name ?? '—'}</bdi></td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-primary"><Num>{plain(p.amountUsd)}</Num></td>
                      <td className="py-2 px-2 whitespace-nowrap text-danger"><Num>{usd(-p.worstUsd)}</Num></td>
                      <td className="py-2 px-2 whitespace-nowrap">{likely.points === null ? '—' : <Num>{formatCompact(likely.points)}</Num>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-secondary leading-6">
            جمع خرید <Num>{plain(spent)}</Num>؛ اگر همه‌ی ایردراپ‌ها صفر و بازده پایه بدبینانه شود، ضرر کل <b className="text-danger"><Num>{plain(worst)}</Num></b>. یک ایردراپ خوب می‌تواند هزینه‌ی بقیه را بپوشاند — ولی هیچ‌کدام تضمین نیست.
            مبلغ هر بازار تقریبی است (بدون قیمت اجرایی) و پوینت برنامه‌های مختلف با هم قابل مقایسه نیست.
          </p>
        </>
      )}
    </section>
  );
}

/** Saved «sell when the implied rate reaches X» targets, against today's rate. */
export function TargetsPanel({ markets }: { markets: Map<string, OpportunityListing> }) {
  const targets = useTargets();
  if (!targets.length) return null;
  const now = Date.now();
  return (
    <section className="sx-card p-3 sm:p-4 flex flex-col gap-2 text-sm" aria-label="اهداف خروج من">
      <h2 className="flex items-center gap-2 font-semibold text-primary">
        <Target size={17} className="text-accent" aria-hidden /> اهداف خروج من
      </h2>
      <ul className="flex flex-col divide-y divide-default">
        {targets.map((t) => {
          const m = markets.get(t.id);
          const cur = m?.impliedAPY ?? null;
          const late = new Date(t.by).getTime() < now;
          const hit = cur !== null && cur >= t.targetPct;
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <bdi dir="ltr" className="text-primary">{t.name}</bdi>
                <span className="block text-xs text-muted">
                  هدف <Num>{formatPercent(t.targetPct, 2)}</Num> تا {formatDate(t.by)} · الان {cur === null ? 'نامعلوم' : <Num>{formatPercent(cur, 2)}</Num>}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className={`text-xs font-medium ${hit ? 'text-success' : late ? 'text-danger' : 'text-muted'}`}>
                  {hit ? 'رسید — فروش YT پول را برمی‌گرداند' : late ? 'مهلت گذشت' : cur === null ? '' : <>فاصله <Num>{formatNumber(t.targetPct - cur, 2)}</Num> واحد</>}
                </span>
                <button type="button" onClick={() => writeTargets(readTargets().filter((x) => x.id !== t.id))} className="tap p-1.5 text-muted hover:text-danger" aria-label={`حذف هدف ${t.name}`}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">با نرخ همین صفحه مقایسه می‌شود؛ برای به‌روز شدن صفحه را دوباره باز کنید.</p>
    </section>
  );
}

/** The user's own record: what their past points cost and what the airdrops paid — their judgement, not a project's luck. */
export function MyRecord() {
  const [open, setOpen] = useState(false);
  return (
    <section className="sx-card p-3 sm:p-4 flex flex-col gap-2 text-sm" aria-label="کارنامه‌ی پوینت من">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="tap flex items-center justify-between gap-2 font-semibold text-primary text-right">
        <span className="flex items-center gap-2">
          <History size={17} className="text-accent" aria-hidden /> کارنامه‌ی پوینت من
        </span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <RecordBody />}
    </section>
  );
}

function RecordBody() {
  const { views, airdrops } = usePortfolioView();
  const rows = useMemo(() => {
    const used = new Set<string>();
    return airdrops.map((program) => {
      const own = views.filter((x) => program.positionIds.includes(x.p.id) && !used.has(x.p.id));
      own.forEach((x) => used.add(x.p.id));
      const cash = own.reduce((s, x) => s + x.v.pnlUsd, 0);
      const summary = views.flatMap((x) => x.airdrops).find((a) => a.program.id === program.id)?.summary ?? null;
      const drop = program.noAirdrop ? 0 : summary?.totalUsd ?? null;
      return { id: program.id, name: program.name, season: program.season, cash, drop, net: drop === null ? null : cash + drop };
    });
  }, [views, airdrops]);
  if (!rows.length) return <p className="text-secondary leading-6">هنوز برنامه‌ی پوینتی در پورتفوی ثبت نکرده‌اید. پوزیشن YT را در پورتفوی ثبت و به برنامه‌ی پوینت وصل کنید تا این‌جا نتیجه‌ی تصمیم‌های خودتان جمع شود.</p>;
  const settled = rows.filter((r) => r.net !== null);
  const sum = (f: (r: (typeof rows)[number]) => number) => settled.reduce((s, r) => s + f(r), 0);
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-default">
        <table className="w-full text-xs sm:text-sm">
          <thead className="bg-canvas text-xs text-muted">
            <tr>
              <th className="py-2 px-2 text-right font-medium">برنامه</th>
              <th className="py-2 px-2 text-right font-medium">نتیجه‌ی نقدی YT</th>
              <th className="py-2 px-2 text-right font-medium">ایردراپ</th>
              <th className="py-2 px-2 text-right font-medium">جمع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 px-2 whitespace-nowrap"><bdi dir="ltr">{r.name}</bdi>{r.season !== null && <> · فصل <Num>{formatNumber(r.season, 0)}</Num></>}</td>
                <td className={`py-2 px-2 ${r.cash >= 0 ? 'text-success' : 'text-danger'}`}><Num>{usd(r.cash)}</Num></td>
                <td className="py-2 px-2">{r.drop === null ? <span className="text-muted">در انتظار</span> : <Num>{plain(r.drop)}</Num>}</td>
                <td className={`py-2 px-2 font-medium ${r.net === null ? 'text-muted' : r.net >= 0 ? 'text-success' : 'text-danger'}`}>{r.net === null ? '—' : <Num>{usd(r.net)}</Num>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {settled.length > 0 && (
        <p className="text-secondary leading-6">
          از <Num>{formatNumber(settled.length, 0)}</Num> برنامه‌ی تمام‌شده: <Num>{formatNumber(settled.filter((r) => r.net! > 0).length, 0)}</Num> سودده، <Num>{formatNumber(settled.filter((r) => r.net! <= 0).length, 0)}</Num> بی‌سود یا زیان‌ده. جمع: <b className={sum((r) => r.net!) >= 0 ? 'text-success' : 'text-danger'}><Num>{usd(sum((r) => r.net!))}</Num></b>.
        </p>
      )}
      <p className="text-xs text-muted">نتیجه‌ی قضاوت خودتان است، نه پیش‌بینی برنامه‌ی بعدی.</p>
    </>
  );
}
