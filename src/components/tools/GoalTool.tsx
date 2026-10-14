'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Lock, Sparkles, Waves } from 'lucide-react';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';
import { CERTAINTY_LABEL, goalOptions, requiredReturn, type Certainty, type GoalOption, type GoalResult } from '../../lib/opportunity/goal';
import { HORIZONS, type HorizonDays } from '../../lib/opportunity/policy';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatMultiplier, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { Identity } from '../market/MarketAnalysis';
import { NearPaths } from './NearPaths';

interface Settings {
  capital: number;
  target: number;
  days: HorizonDays;
}
const initial: Settings = { capital: 1000, target: 100, days: 90 };

const GROUPS: { id: Certainty; icon: typeof Lock; text: string }[] = [
  { id: 'locked', icon: Lock, text: 'سود هنگام ورود معلوم است: PT تا سررسید (برابری دلار تأییدشده)، وام‌دهی نرخ ثابت، لوپ PT با وام نرخ ثابت برای کل دوره.' },
  { id: 'variable', icon: Waves, text: 'به نرخی بسته است که می‌تواند عوض شود: سپرده و خزانه، لوپ با وام متغیر، PT با برابری تأییدنشده.' },
  { id: 'speculative', icon: Sparkles, text: 'بیشتر سودش پاداش، پوینت یا YT است: بی‌ضمانت.' },
];

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const signedUsd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/**
 * «هدف سود»: capital, the dollar profit wanted and the period → the yearly rate that
 * needs, and the best real options across every strategy the market analysis
 * estimates, grouped by how sure their dollars are. Same estimates as the ranking.
 */
export function GoalTool() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    const saved = readLocal<Partial<Settings>>(STORAGE_KEYS.goal, {});
    setS({ ...initial, ...saved, days: HORIZONS.includes(saved.days as HorizonDays) ? (saved.days as HorizonDays) : initial.days });
  }, []);
  useEffect(() => {
    if (s) writeLocal(STORAGE_KEYS.goal, s);
  }, [s]);
  const patch = (p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x));
  const capital = s?.capital ?? 0;
  const m = useMarketAnalysis(capital);
  const res = useMemo(() => (m.analysis && s && s.capital > 0 && s.target > 0 ? goalOptions(m.analysis.rows, s.days, s.capital, s.target) : null), [m.analysis, s]);

  if (!s)
    return (
      <div className="grid place-items-center py-16 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </div>
    );
  const need = requiredReturn(s.capital, s.target, s.days);

  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="سرمایه" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
          <NumberField label="سود دلاری مورد نظر" value={s.target} onChange={(v) => patch({ target: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        </div>
        <Segmented<`${HorizonDays}`> value={`${s.days}`} onChange={(v) => patch({ days: Number(v) as HorizonDays })} label="مدت" options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
        {s.capital > 0 && s.target > 0 && Number.isFinite(need.apyPct) && (
          <p className="text-sm">
            لازم است: <Num className="font-semibold">{formatPercent(need.periodPct, 1)}</Num> در <Num>{formatNumber(s.days, 0)}</Num> روز، یعنی نرخ سالانه‌ی حدود <Num className="font-semibold">{formatPercent(need.apyPct, need.apyPct >= 100 ? 0 : 1)}</Num>.
          </p>
        )}
      </section>

      {m.loading && !m.analysis ? (
        <div className="grid place-items-center py-12 text-secondary" aria-busy="true">
          <Loader2 className="animate-spin" aria-label="در حال دریافت بازارها" />
        </div>
      ) : !res ? (
        <Empty>{m.failed ? 'داده‌ی بازارها دریافت نشد.' : 'سرمایه و سود مورد نظر را وارد کنید.'}</Empty>
      ) : (
        <>
          <Verdict res={res} target={s.target} capital={s.capital} days={s.days} pending={m.pending} />
          {res.reachedBy !== 'locked' && m.analysis && <NearPaths analysis={m.analysis} days={s.days} capital={s.capital} target={s.target} />}
          {GROUPS.map((g) => (
            <Group key={g.id} id={g.id} icon={g.icon} text={g.text} options={res.groups[g.id]} target={s.target} days={s.days} />
          ))}
          <p className="text-xs text-secondary leading-6">
            همه‌ی عددها از همان برآورد رتبه‌بندی بازار برای این سرمایه و مدت می‌آیند: هزینه‌ها و گس کم شده‌اند، فقط گزینه‌های قابل‌برآورد آمده‌اند (<Num>{formatNumber(res.excluded, 0)}</Num> گزینه‌ی دیگر برای این مبلغ و مدت سود مثبت قابل‌برآورد ندارند). «قفل‌شده» یعنی نرخ هنگام ورود ثابت می‌شود؛ ریسک ناشر و برابری دارایی با دلار سر جایش است.
          </p>
        </>
      )}
    </div>
  );
}

function Verdict({ res, target, capital, days, pending }: { res: GoalResult; target: number; capital: number; days: number; pending: boolean }) {
  const best = res.best;
  const locked = res.groups.locked[0];
  const tone = res.reachedBy === 'locked' ? 'border-success/40 bg-success/8' : res.reachedBy ? 'border-warning/40 bg-warning/8' : 'border-danger/40 bg-danger/8';
  return (
    <section className={`rounded-lg border p-4 flex flex-col gap-1.5 ${tone} ${pending ? 'opacity-60' : ''}`} aria-live="polite">
      {res.reachedBy === 'locked' && (
        <p className="font-semibold">
          شدنی با سود قفل‌شده: <Num>{usd(locked.net)}</Num> در <Num>{formatNumber(days, 0)}</Num> روز.
        </p>
      )}
      {res.reachedBy === 'variable' && (
        <p className="font-semibold">
          با سود قفل‌شده نمی‌رسد؛ فقط با گزینه‌های متغیر (نرخ می‌تواند عوض شود): بهترین دلاری <Num>{usd(res.groups.variable.find((x) => x.unit === 'usd')?.net ?? 0)}</Num>.
        </p>
      )}
      {res.reachedBy === 'speculative' && <p className="font-semibold">فقط با پاداش، پوینت یا YT می‌رسد؛ یعنی بی‌ضمانت.</p>}
      {!res.reachedBy && (
        <p className="font-semibold">
          با بازار امروز شدنی نیست. بهترین نتیجه‌ی واقعی برای <Num>{usd(capital)}</Num> در <Num>{formatNumber(days, 0)}</Num> روز: {best ? <Num>{usd(best.net)}</Num> : 'هیچ'} ({best ? CERTAINTY_LABEL[best.certainty] : '—'}).
        </p>
      )}
      {locked && res.reachedBy !== 'locked' && (
        <p className="text-sm">
          بهترین سود قفل‌شده‌ی تک‌گزینه: <Num>{usd(locked.net)}</Num> (<Num>{formatPercent((locked.net / target) * 100, 0)}</Num> هدف).
        </p>
      )}
      {!locked && <p className="text-sm">برای این مبلغ و مدت هیچ گزینه‌ی قفل‌شده‌ای سود مثبت ندارد.</p>}
    </section>
  );
}

function Group({ id, icon: Icon, text, options, target, days }: { id: Certainty; icon: typeof Lock; text: string; options: GoalOption[]; target: number; days: number }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold flex items-center gap-1.5">
        <Icon size={16} aria-hidden /> {CERTAINTY_LABEL[id]}
        <span className="text-xs text-secondary font-normal">— {text}</span>
      </h3>
      {options.length ? options.map((x) => <OptionRow key={x.key} x={x} target={target} days={days} />) : <p className="text-sm text-secondary">گزینه‌ای با سود مثبت نیست.</p>}
    </section>
  );
}

function Bar({ x }: { x: GoalOption }) {
  const p = Math.max(0, Math.min(1, x.progress));
  return (
    <div className="h-1.5 rounded-full bg-hover overflow-hidden" role="img" aria-label={`${formatPercent(x.progress * 100, 0)} هدف`}>
      <div className={`h-full rounded-full ${x.progress >= 1 ? 'bg-success' : 'bg-accent'}`} style={{ width: `${p * 100}%` }} />
    </div>
  );
}

function OptionRow({ x, target, days }: { x: GoalOption; target: number; days: number }) {
  const lev = x.e.leverage;
  const term = x.o.loop?.debt.side.fixedTermDays;
  return (
    <article className="sx-card p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <Identity row={x} />
        <div className="flex flex-col items-end shrink-0">
          <Num className={`font-semibold ${x.net >= target ? 'text-success' : 'text-primary'}`}>{signedUsd(x.net)}</Num>
          <span className="text-xs text-secondary">
            <Num>{formatPercent(x.progress * 100, 0)}</Num> هدف
          </span>
        </div>
      </div>
      <Bar x={x} />
      {x.unit !== 'usd' && (
        <p className="text-xs text-warning">
          سود به {x.unit === 'other' ? 'دارایی غیر دلاری' : <bdi dir="ltr">{x.unit.toUpperCase()}</bdi>} است؛ عدد دلاری با قیمت امروز حساب شده و با قیمت آن عوض می‌شود. در سبدهای پیشنهادی نیست.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        {Math.abs(x.lockedUsd) >= 0.005 && (
          <span>
            قفل‌شده <Num className="text-primary">{signedUsd(x.lockedUsd)}</Num>
          </span>
        )}
        {Math.abs(x.variableUsd) >= 0.005 && (
          <span>
            متغیر <Num className={x.variableUsd < 0 ? 'text-danger' : 'text-primary'}>{signedUsd(x.variableUsd)}</Num>
          </span>
        )}
        {Math.abs(x.speculativeUsd) >= 0.005 && (
          <span>
            پاداش <Num className="text-primary">{signedUsd(x.speculativeUsd)}</Num>
          </span>
        )}
        {x.e.earningDays < days - 0.5 && (
          <span>
            پول <Num>{formatNumber(Math.round(x.e.earningDays), 0)}</Num> روز کار می‌کند
          </span>
        )}
        {lev && <span>اهرم <Num>{formatMultiplier(lev.leverage, 2)}</Num> · افت تا لیکوییدشدن <Num>{formatPercent(lev.liquidationDrop * 100, 1)}</Num></span>}
      </div>
      {lev && (
        <div className="flex flex-wrap gap-1.5 items-center text-xs">
          {x.borrowLocked ? (
            <Pill tone="success">وام نرخ ثابت <Num>{formatNumber(Math.round(term ?? 0), 0)}</Num> روزه: هر دو طرف قفل</Pill>
          ) : (
            <>
              {term !== undefined && <Pill tone="warning">وام نرخ ثابت فقط <Num>{formatNumber(Math.round(term), 0)}</Num> روز؛ بعد تمدید با نرخ روز</Pill>}
              {x.zeroProfitBorrowPct != null && (
                <span className="text-secondary">
                  زیان‌ده اگر میانگین نرخ وام از <Num className="text-danger">{formatPercent(x.zeroProfitBorrowPct, 1)}</Num> بالاتر برود
                </span>
              )}
              {x.ptEqualBorrowPct != null && (
                <span className="text-secondary">
                  · از نگه‌داشتن ساده‌ی همین PT بهتر فقط تا نرخ وام <Num>{formatPercent(x.ptEqualBorrowPct, 1)}</Num>
                </span>
              )}
              <span className="text-secondary">
                (امروز <Num>{formatPercent(lev.borrowPct, 2)}</Num>)
              </span>
            </>
          )}
        </div>
      )}
      {x.o.url && (
        <a href={x.o.url} target="_blank" rel="noreferrer" className="tap self-start inline-flex items-center gap-1 text-xs text-accent">
          صفحه‌ی {x.o.protocol.name} <ExternalLink size={12} aria-hidden />
        </a>
      )}
    </article>
  );
}
