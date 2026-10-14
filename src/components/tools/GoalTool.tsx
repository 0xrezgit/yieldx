'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Info, Loader2, Lock, Scale, Sparkles, Target, TrendingUp, Waves } from 'lucide-react';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';
import { CERTAINTY_LABEL, goalOptions, requiredReturn, type Certainty, type GoalOption } from '../../lib/opportunity/goal';
import { nearestPaths, type Allocation, type NearResult } from '../../lib/opportunity/goal-plan';
import { HORIZONS, type HorizonDays } from '../../lib/opportunity/policy';
import { isPlainDollar, stepsFor, type Step } from '../../lib/market/steps';
import { networkByKey } from '../../lib/registry/networks';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatDate, formatMultiplier, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Collapsible } from '../ui/card';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { StepList } from '../market/ActionPlan';
import { Identity } from '../market/MarketAnalysis';

interface Settings {
  capital: number;
  target: number;
  days: HorizonDays;
}
const initial: Settings = { capital: 1000, target: 100, days: 90 };

type PathId = 'safe' | 'balanced' | 'max';
const PATH_META: Record<PathId, { title: string; icon: typeof Lock; text: string }> = {
  safe: { title: 'امن', icon: Lock, text: 'فقط سود قفل‌شده به دلار؛ هنگام ورود معلوم است.' },
  balanced: { title: 'متعادل', icon: Scale, text: 'کمترین سهم پرریسک که به هدف می‌رساند؛ بقیه قفل‌شده.' },
  max: { title: 'پربازده', icon: TrendingUp, text: 'بیشترین سود دلاری؛ نرخ‌ها می‌توانند عوض شوند.' },
};

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);
const ltr = (s: string | null | undefined) => `⁨${s ?? '—'}⁩`;

/** The chosen path as one list of parts (a balanced path is its variable and locked plans together). */
function partsOf(r: NearResult, id: PathId): { parts: Allocation[]; total: number } | null {
  if (id === 'safe') return r.realistic.locked;
  if (id === 'max') return r.realistic.variable;
  if (!r.blend) return null;
  return { parts: [...r.blend.variable.parts, ...r.blend.locked.parts].sort((a, b) => b.net - a.net), total: r.blend.total };
}

/** Steps for one part of the plan: change the money into what it needs first, then the opportunity's own steps. */
function planSteps(a: Allocation): Step[] {
  const own = stepsFor(a.o, a.e);
  const needs = a.o.family === 'leverage' ? a.o.loop?.collateral.token.symbol : a.o.family === 'pt' ? null : a.o.assets.deposit[0]?.symbol;
  const swap: Step[] = needs && !isPlainDollar(needs) && own[0]?.kind !== 'swap' && own[0]?.kind !== 'buy' ? [{ kind: 'swap', short: 'تبدیل', title: `تبدیل ${formatUSD(a.amount, 0)} به ${ltr(needs)}` }] : [];
  return [...swap, ...own];
}

/**
 * «هدف سود»: three numbers in, one answer out — the real dollar profit, a path to pick
 * (safe, balanced, high-yield) and what to do, step by step, to get it. Everything comes
 * from the market analysis (lib/opportunity/goal, goal-plan); the details are folded away.
 */
export function GoalTool() {
  const [s, setS] = useState<Settings | null>(null);
  const [path, setPath] = useState<PathId | null>(null);
  useEffect(() => {
    const saved = readLocal<Partial<Settings>>(STORAGE_KEYS.goal, {});
    setS({ ...initial, ...saved, days: HORIZONS.includes(saved.days as HorizonDays) ? (saved.days as HorizonDays) : initial.days });
  }, []);
  useEffect(() => {
    if (s) writeLocal(STORAGE_KEYS.goal, s);
  }, [s]);
  const patch = (p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x));
  const m = useMarketAnalysis(s?.capital ?? 0);
  const analysis = useDeferredValue(m.analysis);
  const ok = !!(analysis && s && s.capital > 0 && s.target > 0);
  const res = useMemo(() => (ok ? goalOptions(analysis!.rows, s!.days, s!.capital, s!.target) : null), [ok, analysis, s]);
  const near = useMemo(() => (ok ? nearestPaths(analysis!.rows, analysis!.gas, s!.days, s!.capital, s!.target) : null), [ok, analysis, s]);

  // Default path: the surest one that reaches the target, else the safe one.
  const auto: PathId = !near || !s ? 'safe' : near.realistic.locked.total >= s.target ? 'safe' : near.blend ? 'balanced' : 'safe';
  const chosen = path && near && partsOf(near, path) ? path : auto;

  if (!s)
    return (
      <div className="grid place-items-center py-16 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </div>
    );
  const need = requiredReturn(s.capital, s.target, s.days);
  const plan = near ? partsOf(near, chosen) : null;

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <section className="sx-card p-4 flex flex-col gap-3">
        <p className="text-sm text-secondary flex items-center gap-1.5">
          <Target size={15} aria-hidden className="text-accent" /> بگویید چقدر دارید و چقدر سود می‌خواهید؛ مسیر را قدم‌به‌قدم می‌گیرید.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="سرمایه" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
          <NumberField label="سود مورد نظر" value={s.target} onChange={(v) => patch({ target: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        </div>
        <Segmented<`${HorizonDays}`> value={`${s.days}`} onChange={(v) => patch({ days: Number(v) as HorizonDays })} label="مدت" options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
      </section>

      {m.loading && !analysis ? (
        <div className="grid place-items-center py-12 text-secondary gap-2" aria-busy="true">
          <Loader2 className="animate-spin" aria-hidden />
          <span className="text-sm">در حال بررسی همه‌ی بازارها…</span>
        </div>
      ) : !res || !near || !plan ? (
        <Empty>{m.failed ? 'داده‌ی بازارها دریافت نشد.' : 'سرمایه و سود مورد نظر را وارد کنید.'}</Empty>
      ) : (
        <>
          <Answer total={plan.total} target={s.target} days={s.days} path={chosen} periodPct={need.periodPct} apyPct={need.apyPct} pending={m.pending} />

          {m.lending.loading && (
            <p className="text-xs text-warning flex items-center gap-1.5" aria-live="polite">
              <Loader2 size={13} className="animate-spin" aria-hidden /> بازارهای وام و لوپ‌ها هنوز در راه‌اند؛ عددهای «متعادل» و «پربازده» کامل نیستند.
            </p>
          )}

          <PathPicker near={near} value={chosen} onChange={setPath} target={s.target} loading={m.lending.loading} />

          <Suggestions near={near} settings={s} total={plan.total} onPatch={patch} />

          <section className="flex flex-col gap-3" aria-label="مسیر شما">
            <h3 className="font-semibold">مسیر شما، قدم‌به‌قدم</h3>
            {plan.parts.length ? (
              plan.parts.map((a, i) => <PartCard key={a.o.key} a={a} n={i + 1} days={s.days} />)
            ) : (
              <Empty>برای این مبلغ و مدت گزینه‌ی دلاری قابل‌برآوردی پیدا نشد.</Empty>
            )}
            {plan.parts.length > 0 && (
              <p className="text-sm text-secondary">
                جمع: <Num className="font-semibold text-primary">{usd(plan.total)}</Num> سود تخمینی در <Num>{formatNumber(s.days, 0)}</Num> روز، پس از هزینه و گس.
              </p>
            )}
          </section>

          <Collapsible title="همه‌ی گزینه‌ها و جزئیات" icon={<Info size={16} aria-hidden />}>
            <Details res={res} near={near} target={s.target} days={s.days} />
          </Collapsible>
        </>
      )}
    </div>
  );
}

export function Answer({ total, target, days, path, periodPct, apyPct, pending }: { total: number; target: number; days: number; path: PathId; periodPct: number; apyPct: number; pending: boolean }) {
  const reached = total >= target - 0.005;
  const p = Math.max(0, Math.min(1, target > 0 ? total / target : 0));
  return (
    <section className={`rounded-2xl border p-5 flex flex-col gap-3 ${reached ? 'border-success/40 bg-success/6' : 'border-default bg-surface'} ${pending ? 'opacity-60' : ''}`} aria-live="polite">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col">
          <span className="text-xs text-secondary">سود واقعی شما در {formatNumber(days, 0)} روز</span>
          <Num className={`text-3xl font-bold leading-tight ${reached ? 'text-success' : 'text-primary'}`}>{usd(total)}</Num>
        </div>
        <span className="text-sm text-secondary">
          هدف <Num className="text-primary font-semibold">{usd(target)}</Num>
        </span>
      </div>
      <div className="h-2 rounded-full bg-hover overflow-hidden" role="img" aria-label={`${formatPercent(p * 100, 0)} هدف`}>
        <div className={`h-full rounded-full transition-[width] ${reached ? 'bg-success' : 'bg-accent'}`} style={{ width: `${p * 100}%` }} />
      </div>
      <p className="text-sm leading-6">
        {reached ? (
          <>با مسیر «{PATH_META[path].title}» به هدف می‌رسید.</>
        ) : (
          <>
            بازار امروز با مسیر «{PATH_META[path].title}» <Num>{formatPercent(p * 100, 0)}</Num> هدف را می‌دهد. هدف شما <Num>{formatPercent(periodPct, 1)}</Num> در این مدت می‌خواهد، یعنی حدود <Num>{formatPercent(apyPct, apyPct >= 100 ? 0 : 1)}</Num> در سال.
          </>
        )}
      </p>
    </section>
  );
}

function PathPicker({ near, value, onChange, target, loading }: { near: NearResult; value: PathId; onChange: (p: PathId) => void; target: number; loading: boolean }) {
  const ids: PathId[] = ['safe', 'balanced', 'max'];
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="مسیر">
      {ids.map((id) => {
        const p = partsOf(near, id);
        const on = value === id;
        const Icon = PATH_META[id].icon;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!p}
            onClick={() => onChange(id)}
            title={PATH_META[id].text}
            className={`tap rounded-xl border p-3 flex flex-col items-start gap-1 text-start transition-colors disabled:opacity-40 ${on ? 'border-accent bg-accent/10' : 'border-default bg-surface hover:bg-elevated'}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon size={14} aria-hidden className={id === 'safe' ? 'text-success' : id === 'balanced' ? 'text-warning' : 'text-danger'} /> {PATH_META[id].title}
            </span>
            {loading && id !== 'safe' ? (
              <Loader2 size={18} className="animate-spin text-secondary my-1" aria-label="در حال دریافت" />
            ) : (
              <Num className={`text-lg font-bold ${p && p.total >= target ? 'text-success' : 'text-primary'}`}>{p ? usd(p.total) : '—'}</Num>
            )}
            <span className="text-[11px] text-secondary leading-4">{loading && id !== 'safe' ? 'در حال دریافت بازارهای وام…' : p ? PATH_META[id].text : 'به هدف نمی‌رسد'}</span>
          </button>
        );
      })}
    </div>
  );
}

function Suggestions({ near, settings, total, onPatch }: { near: NearResult; settings: Settings; total: number; onPatch: (p: Partial<Settings>) => void }) {
  if (total >= settings.target - 0.005) return null;
  const lockedTarget = near.realistic.locked.total;
  const chip = 'tap inline-flex items-center gap-1 rounded-full border border-default bg-surface px-3 min-h-9 text-sm hover:bg-elevated';
  const step = lockedTarget >= 100 ? 10 : 1;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-secondary">برای رسیدن، یکی را بزنید:</span>
      <div className="flex flex-wrap gap-2">
        {lockedTarget > 1 && (
          <button type="button" className={chip} onClick={() => onPatch({ target: round(Math.floor(lockedTarget / step) * step, step) })}>
            هدف را <Num className="font-semibold">{usd(round(Math.floor(lockedTarget / step) * step, step))}</Num> کن (امن)
          </button>
        )}
        {near.capitalLocked.reachable && near.capitalLocked.capital !== null && (
          <button type="button" className={chip} onClick={() => onPatch({ capital: Math.ceil(near.capitalLocked.capital as number / 100) * 100 })}>
            سرمایه را <Num className="font-semibold">{usd(Math.ceil(near.capitalLocked.capital / 100) * 100)}</Num> کن (امن)
          </button>
        )}
        {near.horizons
          .filter((h) => h.days > settings.days && h.locked > total + 0.5)
          .slice(0, 1)
          .map((h) => (
            <button key={h.days} type="button" className={chip} onClick={() => onPatch({ days: h.days })}>
              مدت را <Num className="font-semibold">{formatNumber(h.days, 0)}</Num> روز کن
            </button>
          ))}
      </div>
      {!near.capitalLocked.reachable && (
        <p className="text-xs text-secondary">
          با سود قفل‌شده و هیچ سرمایه‌ای نمی‌رسد: بازارهای قفل‌شده‌ی امروز روی هم حدود <Num>{usd(near.capitalLocked.maxTotal)}</Num> سود جا دارند.
        </p>
      )}
    </div>
  );
}

export function PartCard({ a, n, days }: { a: Allocation; n: number; days: number }) {
  const net = networkByKey(a.o.chain);
  const lev = a.e.leverage;
  return (
    <article className="sx-card p-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="grid place-items-center size-6 shrink-0 rounded-full bg-accent text-on-brand text-xs font-bold mt-1">
            <Num>{formatNumber(n, 0)}</Num>
          </span>
          <Identity row={a} />
        </div>
        <div className="flex flex-col items-end shrink-0">
          <Num className="font-semibold text-success">{formatUSD(a.net, Math.abs(a.net) >= 100 ? 0 : 2, true)}</Num>
          <span className="text-xs text-secondary">
            با <Num>{usd(a.amount)}</Num>
          </span>
        </div>
      </header>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={a.certainty === 'locked' ? 'success' : 'warning'}>{CERTAINTY_LABEL[a.certainty]}</Pill>
        <Pill>{net.nameFa}</Pill>
        {a.o.maturity && <Pill>سررسید {formatDate(a.o.maturity)}</Pill>}
        {lev && (
          <Pill tone="warning">
            اهرم <Num>{formatMultiplier(lev.leverage, 1)}</Num> · لیکویید با افت <Num>{formatPercent(lev.liquidationDrop * 100, 0)}</Num>
          </Pill>
        )}
        {a.e.earningDays < days - 0.5 && (
          <Pill>
            <Num>{formatNumber(Math.round(a.e.earningDays), 0)}</Num> روز کار می‌کند
          </Pill>
        )}
      </div>
      <StepList steps={planSteps(a)} />
    </article>
  );
}

function Details({ res, near, target, days }: { res: ReturnType<typeof goalOptions>; near: NearResult; target: number; days: number }) {
  const groups: { id: Certainty; icon: typeof Lock }[] = [
    { id: 'locked', icon: Lock },
    { id: 'variable', icon: Waves },
    { id: 'speculative', icon: Sparkles },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">همین سرمایه در مدت‌های دیگر</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-secondary">
              <th className="text-start font-normal pb-1">مدت</th>
              <th className="text-end font-normal pb-1">امن</th>
              <th className="text-end font-normal pb-1">پربازده</th>
            </tr>
          </thead>
          <tbody>
            {near.horizons.map((h) => (
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
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <g.icon size={14} aria-hidden /> {CERTAINTY_LABEL[g.id]}
          </h4>
          {res.groups[g.id].length ? res.groups[g.id].map((x) => <OptionLine key={x.key} x={x} />) : <p className="text-xs text-secondary">گزینه‌ای با سود مثبت نیست.</p>}
        </div>
      ))}
      <p className="text-xs text-secondary leading-6">
        عددها از همان برآورد رتبه‌بندی بازار برای این سرمایه و مدت می‌آیند: هزینه و گس کم شده است. مسیرها فقط سود دلاری را حساب می‌کنند و هیچ بازاری بیش از نصف سبد را نمی‌گیرد؛ پاداش Merkl در مسیرها نیست. «قفل‌شده» یعنی نرخ هنگام ورود ثابت می‌شود؛ ریسک ناشر و برابری با دلار سر جایش است. <Num>{formatNumber(res.excluded, 0)}</Num> گزینه‌ی دیگر برای این مبلغ و مدت سود مثبت قابل‌برآورد ندارند.
      </p>
    </div>
  );
}

function OptionLine({ x }: { x: GoalOption }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-t border-default first:border-t-0">
      <div className="min-w-0 flex flex-col gap-0.5">
        <Identity row={x} />
        {x.unit !== 'usd' && (
          <span className="text-[11px] text-warning">
            سود به {x.unit === 'other' ? 'دارایی غیر دلاری' : <bdi dir="ltr">{x.unit.toUpperCase()}</bdi>}؛ با قیمت آن عوض می‌شود.
          </span>
        )}
        {x.zeroProfitBorrowPct != null && (
          <span className="text-[11px] text-secondary">
            زیان‌ده اگر نرخ وام از <Num>{formatPercent(x.zeroProfitBorrowPct, 1)}</Num> بالاتر برود
          </span>
        )}
      </div>
      <Num className="shrink-0 font-semibold">{usd(x.net)}</Num>
    </div>
  );
}
