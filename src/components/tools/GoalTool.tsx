'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronDown, Lightbulb, Lock, Loader2, Repeat, Scale, Sparkles, TrendingUp, Waves } from 'lucide-react';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';
import { CERTAINTY_LABEL, goalOptions, liquidationOf, requiredReturn, type Certainty, type GoalOption } from '../../lib/opportunity/goal';
import { finishDay, MAX_SHARE, nearestPaths, type Allocation, type NearResult } from '../../lib/opportunity/goal-plan';
import { HORIZONS, LEVERAGE_PROFILES, type HorizonDays, type LeverageProfileId } from '../../lib/opportunity/policy';
import { levInput, recommend, rowsUnder, type Recommendation } from '../../lib/opportunity/goal-recommend';
import type { Evaluated } from '../../lib/market/analysis';
import { isPlainDollar, stepsFor, type Step } from '../../lib/market/steps';
import { networkByKey } from '../../lib/registry/networks';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatDate, formatMultiplier, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { StepList } from '../market/ActionPlan';
import { LoopHistoryFor } from '../market/LoopHistory';
import { Identity } from '../market/MarketAnalysis';

interface Settings {
  capital: number;
  target: number;
  days: HorizonDays;
  /** At most half the money in one market. */
  diversify: boolean;
  /** Open again what ends before the period, at today's rate. */
  roll: boolean;
  leverage: LeverageProfileId;
}
const initial: Settings = { capital: 1000, target: 100, days: 90, diversify: true, roll: false, leverage: 'cautious' };

type PathId = 'safe' | 'balanced' | 'max';
const PATH: Record<PathId, { title: string; icon: typeof Lock; hint: string }> = {
  safe: { title: 'امن', icon: Lock, hint: 'سود قفل‌شده' },
  balanced: { title: 'متعادل', icon: Scale, hint: 'کمترین ریسکِ رسیدن' },
  max: { title: 'پربازده', icon: TrendingUp, hint: 'بیشترین سود؛ نرخ متغیر' },
};

const PROFILE_TITLE: Record<LeverageProfileId, string> = { cautious: 'محتاط', balanced: 'متعادل', aggressive: 'تهاجمی' };
/** The fall that liquidates a loop opened at a profile's minimum health: 1 − 1 ÷ health. */
const profileDrop = (id: LeverageProfileId) => (1 - 1 / LEVERAGE_PROFILES[id].lev.minHealth) * 100;

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const signed = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const ltr = (s: string | null | undefined) => `⁨${s ?? '—'}⁩`;

function partsOf(r: NearResult, id: PathId): { parts: Allocation[]; total: number } | null {
  if (id === 'safe') return r.realistic.locked;
  if (id === 'max') return r.realistic.variable;
  if (!r.blend) return null;
  return { parts: [...r.blend.variable.parts, ...r.blend.locked.parts].sort((a, b) => b.net - a.net), total: r.blend.total };
}

function planSteps(a: Allocation): Step[] {
  const own = stepsFor(a.o, a.e);
  const needs = a.o.family === 'leverage' ? a.o.loop?.collateral.token.symbol : a.o.family === 'pt' ? null : a.o.assets.deposit[0]?.symbol;
  const swap: Step[] = needs && !isPlainDollar(needs) && own[0]?.kind !== 'swap' && own[0]?.kind !== 'buy' ? [{ kind: 'swap', short: 'تبدیل', title: `تبدیل ${formatUSD(a.amount, 0)} به ${ltr(needs)}` }] : [];
  return [...swap, ...own];
}

/**
 * «هدف سود»: capital, target and period in; the real dollar profit out, a path to pick,
 * and what to do — step by step, with when a loop is liquidated. Leverage profile,
 * «تکرار» and the diversity rule are the user's choices, each with its dollar effect.
 */
export function GoalTool() {
  const [s, setS] = useState<Settings | null>(null);
  const [path, setPath] = useState<PathId | null>(null);
  useEffect(() => {
    const v = readLocal<Partial<Settings>>(STORAGE_KEYS.goal, {});
    setS({
      ...initial,
      ...v,
      days: HORIZONS.includes(v.days as HorizonDays) ? (v.days as HorizonDays) : initial.days,
      diversify: v.diversify !== false,
      roll: v.roll === true,
      leverage: v.leverage && v.leverage in LEVERAGE_PROFILES ? v.leverage : 'cautious',
    });
  }, []);
  useEffect(() => {
    if (s) writeLocal(STORAGE_KEYS.goal, s);
  }, [s]);
  const patch = (p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x));
  const m = useMarketAnalysis(s?.capital ?? 0);
  const analysis = useDeferredValue(m.analysis);
  const ok = !!(analysis && s && s.capital > 0 && s.target > 0);

  // Loops re-estimated under the chosen leverage profile (the analysis uses the cautious one).
  const rows: Evaluated[] | null = useMemo(() => {
    if (!ok) return null;
    return rowsUnder(analysis!.rows, s!.leverage, s!.capital, s!.days, analysis!.gas, Date.now());
  }, [ok, analysis, s]);

  const paths = useMemo(() => {
    if (!rows || !s || !analysis) return null;
    const run = (diversify: boolean, roll: boolean) => nearestPaths(rows, analysis.gas, s.days, s.capital, s.target, { maxShare: diversify ? MAX_SHARE : 1, roll, leverage: levInput(s.leverage) });
    return { near: run(s.diversify, s.roll), flipDiv: run(!s.diversify, s.roll), flipRoll: run(s.diversify, !s.roll) };
  }, [rows, s, analysis]);
  // «همه‌ی گزینه‌ها»: the best 30 of each group (by dollars for this amount and period).
  const res = useMemo(() => (rows && s ? goalOptions(rows, s.days, s.capital, s.target, 30) : null), [rows, s]);
  const near = paths?.near ?? null;

  // «پیشنهاد ما»: every combination of choices, off the main thread's critical path.
  const [rec, setRec] = useState<{ key: string; r: Recommendation | null } | null>(null);
  const recKey = s && analysis ? `${s.capital}|${s.target}|${s.days}|${analysis.rows.length}` : '';
  useEffect(() => {
    if (!ok || !s || !analysis || m.lending.loading) return;
    const id = setTimeout(() => setRec({ key: recKey, r: recommend(analysis.rows, analysis.gas, s.days, s.capital, s.target) }), 30);
    return () => clearTimeout(id);
  }, [recKey, ok, m.lending.loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const totalOf = (r: NearResult | undefined) => (r ? (partsOf(r, chosen)?.total ?? null) : null);

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <section className="sx-card p-4 flex flex-col gap-3">
        <div className="grid gap-3 grid-cols-2">
          <NumberField label="سرمایه" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
          <NumberField label="سود مورد نظر" value={s.target} onChange={(v) => patch({ target: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        </div>
        <Segmented<`${HorizonDays}`> value={`${s.days}`} onChange={(v) => patch({ days: Number(v) as HorizonDays })} label="مدت" options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
      </section>

      {!(s.capital > 0 && s.target > 0) ? (
        <Empty>سرمایه و سود مورد نظر را وارد کنید.</Empty>
      ) : m.failed && !analysis ? (
        <Empty>داده‌ی بازارها دریافت نشد.</Empty>
      ) : !res || !near || !plan ? (
        <div className="grid place-items-center py-12 text-secondary gap-2" aria-busy="true">
          <Loader2 className="animate-spin" aria-hidden />
          <span className="text-sm">{analysis ? 'در حال محاسبه‌ی مسیرها…' : 'در حال بررسی همه‌ی بازارها…'}</span>
        </div>
      ) : (
        <>
          <Answer total={plan.total} target={s.target} days={s.days} finish={finishDay(plan)} rolled={s.roll && plan.parts.some((a) => a.rounds > 1)} periodPct={need.periodPct} apyPct={need.apyPct} pending={m.pending} />

          <Advice rec={rec && rec.key === recKey ? rec.r : undefined} s={s} path={chosen} target={s.target} onApply={(c) => {
            patch({ leverage: c.leverage, roll: c.roll, diversify: c.diversify });
            setPath(c.path);
          }} />

          <PathPicker near={near} value={chosen} onChange={setPath} target={s.target} loading={m.lending.loading} />

          <Controls s={s} patch={patch} here={plan.total} withoutDiv={totalOf(paths?.flipDiv)} withRoll={totalOf(paths?.flipRoll)} />

          <Suggestions near={near} s={s} total={plan.total} onPatch={patch} locked={chosen === 'safe'} />

          {plan.parts.length ? (
            <section className="flex flex-col gap-3" aria-label="مسیر شما">
              <h3 className="font-semibold">مسیر شما</h3>
              <Timeline parts={plan.parts} days={s.days} roll={s.roll} />
              {plan.parts.map((a, i) => (
                <PartCard key={a.o.key} a={a} n={i + 1} />
              ))}
            </section>
          ) : (
            <Empty>برای این مبلغ و مدت گزینه‌ی دلاری قابل‌برآوردی پیدا نشد.</Empty>
          )}

          <Details res={res} near={near} target={s.target} days={s.days} />
        </>
      )}
    </div>
  );
}

export function Answer({ total, target, days, finish, rolled, periodPct, apyPct, pending }: { total: number; target: number; days: number; finish: number; rolled: boolean; periodPct: number; apyPct: number; pending: boolean }) {
  const reached = total >= target - 0.005;
  const p = Math.max(0, Math.min(1, target > 0 ? total / target : 0));
  const end = rolled ? days : Math.ceil(finish > 0 ? Math.min(finish, days) : days);
  return (
    <section className={`rounded-2xl border p-5 flex flex-col gap-3 ${reached ? 'border-success/40 bg-success/6' : 'border-default bg-surface'} ${pending ? 'opacity-60' : ''}`} aria-live="polite">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-secondary">
            سود تا روز <Num>{formatNumber(end, 0)}</Num>
          </span>
          <Num className={`text-3xl font-bold leading-tight ${reached ? 'text-success' : 'text-primary'}`}>{usd(total)}</Num>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-secondary">هدف</span>
          <Num className="text-lg font-semibold">{usd(target)}</Num>
        </div>
      </div>
      <div className="h-2 rounded-full bg-hover overflow-hidden" role="img" aria-label={`${formatPercent(p * 100, 0)} هدف`}>
        <div className={`h-full rounded-full transition-[width] ${reached ? 'bg-success' : 'bg-accent'}`} style={{ width: `${p * 100}%` }} />
      </div>
      <p className="text-sm text-secondary">
        {reached ? (
          end < days ? (
            <>
              <Num>{formatNumber(days - end, 0)}</Num> روز زودتر از مدت انتخابی.
            </>
          ) : (
            'به هدف می‌رسید.'
          )
        ) : (
          <>
            <Num>{formatPercent(p * 100, 0)}</Num> هدف. هدف شما سالانه حدود <Num>{formatPercent(apyPct, apyPct >= 100 ? 0 : 1)}</Num> می‌خواهد (<Num>{formatPercent(periodPct, 1)}</Num> در این مدت).
          </>
        )}
      </p>
    </section>
  );
}

/** «پیشنهاد ما»: the combination to use, as a few short actions, and one tap to apply it. */
function Advice({ rec, s, path, target, onApply }: { rec: Recommendation | null | undefined; s: Settings; path: PathId; target: number; onApply: (c: Recommendation['choice']) => void }) {
  if (rec === undefined)
    return (
      <div className="rounded-xl border border-dashed border-default px-4 py-3 text-sm text-secondary flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" aria-hidden /> در حال یافتن بهترین ترکیب…
      </div>
    );
  if (!rec) return null;
  const c = rec.choice;
  const applied = c.path === path && c.leverage === s.leverage && c.roll === s.roll && c.diversify === s.diversify;
  const steps: React.ReactNode[] = [
    <>مسیر «{PATH[c.path].title}»</>,
    ...(c.leverage !== 'cautious' ? [<>اهرم {PROFILE_TITLE[c.leverage]}؛ لیکویید با افت حدود <Num>{formatPercent(profileDrop(c.leverage), 0)}</Num></>] : []),
    ...(c.roll ? [<>تکرار تا پایان مدت (بعد از دور اول قفل نیست)</>] : []),
    ...(!c.diversify ? [<>تمرکز بیش از نیمی از پول در یک بازار</>] : []),
  ];
  return (
    <section className={`rounded-2xl border p-4 flex flex-col gap-3 ${rec.reached ? 'border-success/40 bg-success/6' : 'border-accent/40 bg-accent/6'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Lightbulb size={15} aria-hidden className="text-accent" /> پیشنهاد ما
          </span>
          <span className="text-xs text-secondary">{rec.reached ? 'کم‌ریسک‌ترین ترکیبی که به هدف می‌رسد' : 'بیشترین سود با ریسک قابل‌قبول؛ به هدف نمی‌رسد'}</span>
        </div>
        <Num className={`text-xl font-bold shrink-0 ${rec.reached ? 'text-success' : 'text-primary'}`}>{usd(rec.total)}</Num>
      </div>
      <ol className="flex flex-col gap-1 text-sm">
        {steps.map((x, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="grid place-items-center size-5 shrink-0 rounded-full bg-accent/15 text-accent text-[11px] font-bold">
              <Num>{formatNumber(i + 1, 0)}</Num>
            </span>
            <span>{x}</span>
          </li>
        ))}
      </ol>
      {rec.aggressive && (
        <p className="text-xs text-danger flex items-start gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden /> با اهرم تهاجمی <Num>{usd(rec.aggressive.total)}</Num> می‌شود، ولی با افت حدود <Num>{formatPercent(profileDrop('aggressive'), 0)}</Num> لیکویید می‌شوید؛ پیشنهاد نمی‌کنیم.
        </p>
      )}
      {!rec.reached && !rec.aggressive && target > rec.total && <p className="text-xs text-secondary">هیچ ترکیبی از بازار امروز به هدف نمی‌رسد؛ از پیشنهادهای پایین کمک بگیرید.</p>}
      <button
        type="button"
        disabled={applied}
        onClick={() => onApply(c)}
        className="tap self-start inline-flex items-center gap-1.5 rounded-md bg-brand px-4 min-h-10 text-sm font-medium text-on-brand disabled:bg-transparent disabled:text-success disabled:px-0"
      >
        {applied ? (
          <>
            <Check size={15} aria-hidden /> اعمال شده
          </>
        ) : (
          'اعمال پیشنهاد'
        )}
      </button>
    </section>
  );
}

function PathPicker({ near, value, onChange, target, loading }: { near: NearResult; value: PathId; onChange: (p: PathId) => void; target: number; loading: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="مسیر">
      {(['safe', 'balanced', 'max'] as PathId[]).map((id) => {
        const p = partsOf(near, id);
        const on = value === id;
        const Icon = PATH[id].icon;
        const wait = loading && id !== 'safe';
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!p && !wait}
            onClick={() => onChange(id)}
            className={`tap rounded-xl border p-3 flex flex-col items-start gap-0.5 text-start transition-colors disabled:opacity-40 ${on ? 'border-accent bg-accent/10' : 'border-default bg-surface hover:bg-elevated'}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon size={14} aria-hidden className={id === 'safe' ? 'text-success' : id === 'balanced' ? 'text-warning' : 'text-danger'} /> {PATH[id].title}
            </span>
            {wait ? <Loader2 size={18} className="animate-spin text-secondary my-1" aria-label="در حال دریافت" /> : <Num className={`text-lg font-bold ${p && p.total >= target ? 'text-success' : 'text-primary'}`}>{p ? usd(p.total) : '—'}</Num>}
            <span className="text-[11px] text-secondary">{wait ? 'در حال دریافت…' : p ? PATH[id].hint : 'به هدف نمی‌رسد'}</span>
          </button>
        );
      })}
    </div>
  );
}

function Switch({ on, onChange, label, note }: { on: boolean; onChange: (v: boolean) => void; label: string; note: React.ReactNode }) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer py-3">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-secondary">{note}</span>
      </span>
      <span className="relative shrink-0 mt-0.5">
        <input type="checkbox" role="switch" className="peer sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span className="block w-10 h-6 rounded-full bg-hover border border-default peer-checked:bg-accent peer-checked:border-accent transition-colors" />
        <span className="absolute top-1 right-1 size-4 rounded-full bg-white shadow transition-transform peer-checked:-translate-x-4" />
      </span>
    </label>
  );
}

/** Leverage profile, «تکرار» and the diversity rule — each with what it does to the profit. */
function Controls({ s, patch, here, withoutDiv, withRoll }: { s: Settings; patch: (p: Partial<Settings>) => void; here: number; withoutDiv: number | null; withRoll: number | null }) {
  const d = withoutDiv === null ? 0 : withoutDiv - here;
  const r = withRoll === null ? 0 : withRoll - here;
  return (
    <section className="sx-card px-4 flex flex-col divide-y divide-[var(--color-border-default)]">
      <div className="flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">اهرم لوپ‌ها</span>
          <span className="text-[11px] text-secondary">
            پیشنهاد ما: <span className="text-success font-medium">محتاط</span>
          </span>
        </div>
        <Segmented<LeverageProfileId> value={s.leverage} onChange={(leverage) => patch({ leverage })} label="اهرم" size="sm" options={(Object.keys(PROFILE_TITLE) as LeverageProfileId[]).map((id) => ({ id, label: PROFILE_TITLE[id] }))} />
        <span className={`text-xs ${s.leverage === 'aggressive' ? 'text-danger' : s.leverage === 'balanced' ? 'text-warning' : 'text-secondary'}`}>
          لیکویید با افت حدود <Num>{formatPercent(profileDrop(s.leverage), 0)}</Num> وثیقه نسبت به وام
          {s.leverage === 'aggressive' ? '؛ یک نوسان معمولی کافی است.' : s.leverage === 'balanced' ? '؛ پایش روزانه لازم است.' : '.'}
        </span>
      </div>
      <Switch
        on={s.roll}
        onChange={(roll) => patch({ roll })}
        label="تکرار تا پایان مدت"
        note={
          s.roll ? (
            r < -0.5 ? (
              <>
                با فرض نرخ‌های امروز: <Num className="text-success">{signed(-r)}</Num>؛ بعد از دور اول قفل نیست.
              </>
            ) : (
              'پول برگشتی با نرخ امروز دوباره گذاشته می‌شود؛ بعد از دور اول قفل نیست.'
            )
          ) : r > 0.5 ? (
            <>
              با فرض نرخ‌های امروز <Num className="text-success">{signed(r)}</Num>؛ بعد از دور اول قفل نیست.
            </>
          ) : (
            'در این مسیر سودی اضافه نمی‌کند.'
          )
        }
      />
      <Switch
        on={s.diversify}
        onChange={(diversify) => patch({ diversify })}
        label="حداکثر نیمی از پول در یک بازار"
        note={
          s.diversify && d > 0.5 ? (
            <>
              ریسک یک ناشر را کم می‌کند؛ هزینه: <Num className="text-warning">{usd(d)}</Num> سود کمتر.
            </>
          ) : !s.diversify && d < -0.5 ? (
            <>
              خاموش: <Num className="text-success">{signed(-d)}</Num> بیشتر، با تمرکز روی یک بازار.
            </>
          ) : (
            'ریسک یک ناشر را کم می‌کند؛ در این مسیر هزینه‌ای ندارد.'
          )
        }
      />
    </section>
  );
}

function Suggestions({ near, s, total, onPatch, locked }: { near: NearResult; s: Settings; total: number; onPatch: (p: Partial<Settings>) => void; locked: boolean }) {
  const chip = 'tap inline-flex items-center gap-1 rounded-full border border-default bg-surface px-3 min-h-9 text-sm hover:bg-elevated';
  if (total >= s.target - 0.005) {
    const sooner = near.horizons.find((h) => h.days < s.days && (locked ? h.locked : h.variable) >= s.target);
    return sooner ? (
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip} onClick={() => onPatch({ days: sooner.days })}>
          در <Num className="font-semibold">{formatNumber(sooner.days, 0)}</Num> روز هم می‌رسد
        </button>
      </div>
    ) : null;
  }
  const lockedTotal = near.realistic.locked.total;
  const step = lockedTotal >= 100 ? 10 : 1;
  const lower = Math.max(step, Math.floor(lockedTotal / step) * step);
  const longer = near.horizons.find((h) => h.days > s.days && h.locked > total + 0.5);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-secondary">برای رسیدن:</span>
      {lockedTotal > 1 && (
        <button type="button" className={chip} onClick={() => onPatch({ target: lower })}>
          هدف <Num className="font-semibold">{usd(lower)}</Num>
        </button>
      )}
      {near.capitalLocked.reachable && near.capitalLocked.capital !== null && (
        <button type="button" className={chip} onClick={() => onPatch({ capital: Math.ceil((near.capitalLocked.capital as number) / 100) * 100 })}>
          سرمایه <Num className="font-semibold">{usd(Math.ceil(near.capitalLocked.capital / 100) * 100)}</Num>
        </button>
      )}
      {longer && (
        <button type="button" className={chip} onClick={() => onPatch({ days: longer.days })}>
          <Num className="font-semibold">{formatNumber(longer.days, 0)}</Num> روز
        </button>
      )}
      {!near.capitalLocked.reachable && (
        <span className="text-xs text-secondary">
          سقف سود قفل‌شده‌ی بازار امروز: <Num>{usd(near.capitalLocked.maxTotal)}</Num>
        </span>
      )}
    </div>
  );
}

function Timeline({ parts, days, roll }: { parts: Allocation[]; days: number; roll: boolean }) {
  return (
    <div className="sx-card p-4 flex flex-col gap-2.5" aria-label="خط زمانی">
      {parts.map((a, i) => {
        const once = Math.min(100, (a.e.earningDays / days) * 100);
        const reps = roll && a.rounds > 1;
        return (
          <div key={a.o.key} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-xs">
              <span className="truncate">
                <Num>{formatNumber(i + 1, 0)}</Num>. <bdi dir="ltr">{a.o.assets.deposit[0]?.symbol ?? a.o.market.name}</bdi>
              </span>
              <span className="text-secondary shrink-0">
                {reps ? (
                  <>
                    <Num>{formatNumber(a.rounds, 1)}</Num> دور · روز <Num>{formatNumber(days, 0)}</Num>
                  </>
                ) : (
                  <>
                    روز <Num>{formatNumber(Math.ceil(a.e.earningDays), 0)}</Num>
                  </>
                )}
                : <Num className="text-primary">{usd(a.amount + a.net)}</Num>
              </span>
            </div>
            <div className="h-2 rounded-full bg-hover overflow-hidden flex gap-px" role="img" aria-label={reps ? 'تکرار تا پایان مدت' : `تا روز ${formatNumber(Math.ceil(a.e.earningDays), 0)}`}>
              {reps ? (
                Array.from({ length: Math.ceil(a.rounds) }, (_, k) => (
                  <div key={k} className={`h-full ${k === 0 ? (a.certainty === 'locked' ? 'bg-success' : 'bg-warning') : 'bg-warning/50'}`} style={{ width: `${Math.max(0, Math.min(once, 100 - k * once))}%` }} />
                ))
              ) : (
                <div className={`h-full rounded-full ${a.certainty === 'locked' ? 'bg-success' : 'bg-warning'}`} style={{ width: `${Math.max(2, once)}%` }} />
              )}
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-[11px] text-secondary">
        <span>امروز</span>
        <span>
          روز <Num>{formatNumber(days, 0)}</Num>
        </span>
      </div>
    </div>
  );
}

/** When this loop is liquidated, in one or two short lines. */
export function Liquidation({ a }: { a: Pick<Allocation, 'o' | 'e'> }) {
  const q = liquidationOf(a.o, a.e);
  if (!q) return null;
  const coll = a.o.loop?.collateral.token.symbol;
  const debt = a.o.loop?.debt.token.symbol;
  const tone = q.dropPct < 6 ? 'border-danger/40 bg-danger/6 text-danger' : q.dropPct < 15 ? 'border-warning/40 bg-warning/6 text-warning' : 'border-default bg-canvas text-secondary';
  const far = (x: number | null) => x === null || x > 200;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs leading-6 ${tone}`}>
      <span className="font-semibold inline-flex items-center gap-1">
        <AlertTriangle size={13} aria-hidden /> لیکویید اگر
      </span>{' '}
      <span className="text-primary">
        ارزش <bdi dir="ltr">{coll}</bdi> نسبت به <bdi dir="ltr">{debt}</bdi> <Num className="font-semibold">{formatPercent(q.dropPct, 1)}</Num> افت کند
        {q.ptRatePct !== null && !far(q.ptRatePct) && (
          <>
            {' '}
            (نرخ بازار PT به <Num className="font-semibold">{formatPercent(q.ptRatePct, 1)}</Num> برسد)
          </>
        )}
        {!far(q.borrowPct) && (
          <>
            ، یا میانگین نرخ وام از <Num className="font-semibold">{formatPercent(q.borrowPct as number, 0)}</Num> بگذرد
          </>
        )}
        .
      </span>
      {q.zeroPct !== null && (
        <span className="block text-secondary">
          بی‌سود اگر میانگین نرخ وام از <Num>{formatPercent(q.zeroPct, 1)}</Num> بگذرد؛ امروز <Num>{formatPercent(a.e.leverage!.borrowPct, 1)}</Num>.
        </span>
      )}
    </div>
  );
}

export function PartCard({ a, n }: { a: Allocation; n: number }) {
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
          <Num className="font-semibold text-success">{signed(a.net)}</Num>
          <span className="text-xs text-secondary">
            با <Num>{usd(a.amount)}</Num>
          </span>
        </div>
      </header>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={a.certainty === 'locked' && a.rounds <= 1 ? 'success' : 'warning'}>{a.rounds > 1 ? 'دور اول قفل، بعد متغیر' : CERTAINTY_LABEL[a.certainty]}</Pill>
        <Pill>{net.nameFa}</Pill>
        {lev && (
          <Pill tone="accent">
            اهرم <Num>{formatMultiplier(lev.leverage, 1)}</Num>
          </Pill>
        )}
        {a.rounds > 1 ? (
          <Pill>
            <Repeat size={12} aria-hidden /> <Num>{formatNumber(a.rounds, 1)}</Num> دور
          </Pill>
        ) : (
          <Pill>
            <CalendarClock size={12} aria-hidden />{' '}
            {a.o.maturity ? (
              `سررسید ${formatDate(a.o.maturity)}`
            ) : (
              <>
                روز <Num>{formatNumber(Math.ceil(a.e.earningDays), 0)}</Num>
              </>
            )}
          </Pill>
        )}
      </div>
      <Liquidation a={a} />
      <LoopHistoryFor o={a.o} leverage={a.e.leverage?.leverage} />
      <StepList steps={planSteps(a)} />
    </article>
  );
}

type Tab = Certainty | 'days';
const TABS: { id: Tab; label: string; icon: typeof Lock }[] = [
  { id: 'locked', label: 'قفل‌شده', icon: Lock },
  { id: 'variable', label: 'متغیر', icon: Waves },
  { id: 'speculative', label: 'سفته‌بازانه', icon: Sparkles },
  { id: 'days', label: 'مدت‌ها', icon: CalendarClock },
];

function Details({ res, near, target, days }: { res: ReturnType<typeof goalOptions>; near: NearResult; target: number; days: number }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('locked');
  return (
    <section className="sx-card">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="tap w-full flex items-center justify-between gap-3 px-4 py-3.5 text-[15px] font-medium">
        بهترین گزینه‌ها
        <ChevronDown size={18} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          <Segmented<Tab> value={tab} onChange={setTab} label="گروه" size="sm" options={TABS.map((t) => ({ id: t.id, label: <><t.icon size={13} aria-hidden /> {t.label}</> }))} />
          {tab === 'days' ? (
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
          ) : res.groups[tab].length ? (
            <div className="flex flex-col">
              {res.groups[tab].map((x) => (
                <OptionLine key={x.key} x={x} target={target} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">گزینه‌ای با سود مثبت نیست.</p>
          )}
          <p className="text-[11px] text-secondary">پس از هزینه و گس؛ پاداش Merkl در مسیرها حساب نشده.</p>
        </div>
      )}
    </section>
  );
}

function OptionLine({ x, target }: { x: GoalOption; target: number }) {
  const q = liquidationOf(x.o, x.e);
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-t border-default first:border-t-0">
      <div className="min-w-0 flex flex-col gap-1">
        <Identity row={x} />
        <div className="flex flex-wrap gap-1.5">
          {x.unit === 'stock' ? <Pill tone="warning">اصل سرمایه: سهم</Pill> : x.unit !== 'usd' && <Pill tone="warning">سود به {x.unit === 'other' ? 'غیر دلار' : <bdi dir="ltr">{x.unit.toUpperCase()}</bdi>}</Pill>}
          {q && (
            <Pill tone={q.dropPct < 6 ? 'danger' : q.dropPct < 15 ? 'warning' : 'muted'}>
              <Num>{formatMultiplier(q.leverage, 1)}</Num> · لیکویید با افت <Num>{formatPercent(q.dropPct, 0)}</Num>
            </Pill>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <Num className={`font-semibold ${x.net >= target ? 'text-success' : ''}`}>{usd(x.net)}</Num>
        <Num className="text-[11px] text-secondary">{formatPercent(x.progress * 100, 0)}</Num>
      </div>
    </div>
  );
}
