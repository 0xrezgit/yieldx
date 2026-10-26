'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, ChevronDown, Loader2 } from 'lucide-react';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';
import { monthlyIncome, MONTHLY_RISK_LABEL, riskDrop, type MonthlyPart, type MonthlyRisk } from '../../lib/monthly/plan';
import { liquidationOf } from '../../lib/opportunity/goal';
import { stepsFor, type Step } from '../../lib/market/steps';
import { networkByKey } from '../../lib/registry/networks';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatMultiplier, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { StepList } from '../market/ActionPlan';
import { Identity } from '../market/MarketAnalysis';
import { LoopHistoryFor } from '../market/LoopHistory';

interface Settings {
  capital: number;
  target: number;
  risk: MonthlyRisk;
  ethereum: boolean;
  /** Loops on a dollar asset whose peg rests only on its name (opt-in). */
  unverified: boolean;
  /** Dollar PTs, withdrawn at maturity. */
  pt: boolean;
  /** LP of tokenized-stock markets: claimable incentives as the monthly (estimated). */
  lp: boolean;
}
const initial: Settings = { capital: 3000, target: 300, risk: 'balanced', ethereum: false, unverified: false, pt: false, lp: false };

const usd = (x: number) => formatUSD(Math.max(0, x), Math.abs(x) >= 100 ? 0 : 2);
const ltr = (s: string | null | undefined) => `⁨${s ?? '—'}⁩`;
/** Opening steps only: what is done once, before the monthly routine. */
const OPEN = new Set<Step['kind']>(['swap', 'buy', 'deposit', 'collateral', 'loop']);

/**
 * «درآمد ماهانه»: capital typed in, a dollar amount wanted every month → what the market
 * gives as a monthly withdrawal with the capital left working (lib/monthly/plan). One
 * column on a phone (PWA), inputs beside the answer on a wide screen. Independent of
 * «هدف سود».
 */
export function MonthlyIncome() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    const v = readLocal<Partial<Settings>>(STORAGE_KEYS.monthly, {});
    setS({ ...initial, ...v, risk: v.risk && v.risk in MONTHLY_RISK_LABEL ? v.risk : 'balanced', ethereum: v.ethereum === true, unverified: v.unverified === true, pt: v.pt === true, lp: v.lp === true });
  }, []);
  useEffect(() => {
    if (s) writeLocal(STORAGE_KEYS.monthly, s);
  }, [s]);
  const patch = (p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x));
  const m = useMarketAnalysis(s?.capital ?? 0);
  const analysis = useDeferredValue(m.analysis);
  const res = useMemo(() => (analysis && s && s.capital > 0 ? monthlyIncome(analysis.rows, analysis.gas, s.capital, s.target, { risk: s.risk, ethereum: s.ethereum, unverified: s.unverified, pt: s.pt, lp: s.lp, merklCtx: analysis.merklCtx }) : null), [analysis, s]);

  if (!s)
    return (
      <div className="grid place-items-center py-16 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </div>
    );

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <Inputs s={s} patch={patch} />
        {!(s.capital > 0) ? (
          <Empty>سرمایه را وارد کنید.</Empty>
        ) : m.failed && !analysis ? (
          <Empty>داده‌ی بازارها دریافت نشد.</Empty>
        ) : !res ? (
          <div className="sx-card grid place-items-center py-12 text-secondary gap-2" aria-busy="true">
            <Loader2 className="animate-spin" aria-hidden />
            <span className="text-sm">در حال بررسی همه‌ی بازارها…</span>
          </div>
        ) : (
          <Answer monthly={res.plan.monthly} bad={res.plan.bad} incentive={res.plan.parts.reduce((a, p) => a + p.incentive, 0)} target={s.target} oneTime={res.plan.oneTime} need={res.capitalForTarget} max={res.maxMonthly} loading={m.lending.loading} />
        )}
      </div>

      {res && res.plan.parts.length > 0 && (
        <section className="flex flex-col gap-3 min-w-0" aria-label="برنامه">
          <h3 className="font-semibold">برنامه</h3>
          <div className="grid gap-3 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
            {res.plan.parts.map((p, i) => (
              <PartCard key={p.o.key} p={p} n={i + 1} />
            ))}
          </div>
          {res.plan.idle > 1 && (
            <p className="text-xs text-warning">
              <Num>{usd(res.plan.idle)}</Num> جای مناسبی پیدا نکرد و بی‌کار می‌ماند.
            </p>
          )}
        </section>
      )}
      {res && !res.plan.parts.length && <Empty>با این ریسک گزینه‌ی دلاری با برداشت ماهانه پیدا نشد.</Empty>}

      {res && <p className="text-[11px] text-secondary">YT اینجا نیست: تا سررسید صفر می‌شود.</p>}
    </div>
  );
}

function Inputs({ s, patch }: { s: Settings; patch: (p: Partial<Settings>) => void }) {
  const drop = riskDrop(s.risk);
  return (
    <section className="sx-card p-4 flex flex-col gap-3 min-w-0">
      <div className="grid gap-3 grid-cols-2">
        <NumberField label="سرمایه" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        <NumberField label="درآمد ماهانه" value={s.target} onChange={(v) => patch({ target: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-sm">
          <span>ریسک</span>
          <span className="text-[11px] text-secondary">
            پیشنهاد ما: <span className="text-success font-medium">متعادل</span>
          </span>
        </div>
        <Segmented<MonthlyRisk> value={s.risk} onChange={(risk) => patch({ risk })} label="ریسک" size="sm" options={(Object.keys(MONTHLY_RISK_LABEL) as MonthlyRisk[]).map((id) => ({ id, label: MONTHLY_RISK_LABEL[id] }))} />
        <span className={`text-xs ${s.risk === 'boosted' ? 'text-warning' : 'text-secondary'}`}>
          {drop === null ? (
            'بدون اهرم؛ فقط سپرده‌گذاری.'
          ) : (
            <>
              لیکویید با افت حدود <Num>{formatPercent(drop, 1)}</Num> وثیقه نسبت به وام{s.risk === 'boosted' ? '؛ پایش هفتگی.' : '.'}
            </>
          )}
        </span>
      </div>
      <div className="flex flex-col divide-y divide-[var(--color-border-default)] border-t border-default">
        <Toggle on={s.pt} onChange={(pt) => patch({ pt })} label="PT با برداشت در سررسید" note="قفل‌شده؛ برداشت در سررسید، نه هر ماه." />
        {s.risk !== 'stable' && <Toggle on={s.lp} onChange={(lp) => patch({ lp })} label="LP سهام توکنی (پاداش)" note="درآمد از پاداش، تخمینی و نه تضمینی؛ اصل سرمایه سهم است و با قیمتش بالا و پایین می‌رود." danger />}
        {s.risk !== 'stable' && <Toggle on={s.unverified} onChange={(unverified) => patch({ unverified })} label="لوپ با برابری تأییدنشده" note="سود بیشتر، ریسک دی‌پگ بیشتر." danger />}
        <Toggle on={s.ethereum} onChange={(ethereum) => patch({ ethereum })} label="اتریوم هم باشد" note="گس برداشت بیشتر." />
      </div>
    </section>
  );
}

function Toggle({ on, onChange, label, note, danger = false }: { on: boolean; onChange: (v: boolean) => void; label: string; note: string; danger?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer py-2.5">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className={`text-[11px] ${danger && on ? 'text-danger' : 'text-secondary'}`}>{note}</span>
      </span>
      <span className="relative shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span className={`block w-10 h-6 rounded-full bg-hover border border-default transition-colors ${danger ? 'peer-checked:bg-danger peer-checked:border-danger' : 'peer-checked:bg-accent peer-checked:border-accent'}`} />
        <span className="absolute top-1 right-1 size-4 rounded-full bg-white shadow transition-transform peer-checked:-translate-x-4" />
      </span>
    </label>
  );
}

function Answer({ monthly, bad, incentive, target, oneTime, need, max, loading }: { monthly: number; bad: number; incentive: number; target: number; oneTime: number; need: number | null; max: number; loading: boolean }) {
  const reached = target > 0 && monthly >= target - 0.005;
  const p = Math.max(0, Math.min(1, target > 0 ? monthly / target : 0));
  return (
    <section className={`rounded-2xl border p-5 flex flex-col gap-3 h-full ${reached ? 'border-success/40 bg-success/6' : 'border-default bg-surface'}`} aria-live="polite">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-secondary flex items-center gap-1">
            <CalendarCheck size={13} aria-hidden /> هر ماه
          </span>
          <Num className={`text-4xl font-bold leading-tight ${reached ? 'text-success' : 'text-primary'}`}>{usd(monthly)}</Num>
        </div>
        <div className="flex flex-col items-end text-xs text-secondary gap-0.5">
          {target > 0 && (
            <span>
              هدف <Num className="text-primary font-semibold text-sm">{usd(target)}</Num>
            </span>
          )}
          <span>
            ماه بد <Num className="text-warning font-semibold text-sm">{usd(bad)}</Num>
          </span>
        </div>
      </div>
      {target > 0 && (
        <div className="h-2 rounded-full bg-hover overflow-hidden" role="img" aria-label={`${formatPercent(p * 100, 0)} هدف`}>
          <div className={`h-full rounded-full ${reached ? 'bg-success' : 'bg-accent'}`} style={{ width: `${p * 100}%` }} />
        </div>
      )}
      {target > 0 && !reached && (
        <p className="text-sm">
          {need !== null ? (
            <>
              برای <Num>{usd(target)}</Num> در ماه: حدود <Num className="font-semibold">{usd(Math.ceil(need / 100) * 100)}</Num> سرمایه با همین ریسک.
            </>
          ) : (
            <>
              سقف بازار امروز با این ریسک: حدود <Num className="font-semibold">{usd(max)}</Num> در ماه.
            </>
          )}
        </p>
      )}
      {incentive > 0.005 && (
        <p className="text-xs text-warning">
          از این مبلغ <Num className="font-semibold">{usd(incentive)}</Num> پاداش تخمینی LP است، نه درآمد تضمین‌شده؛ با ورود سرمایه‌ی دیگران و پایان کمپین کم می‌شود.
        </p>
      )}
      <p className="text-[11px] text-secondary">
        پس از هزینه‌ی برداشت · ورود یک‌باره <Num>{usd(oneTime)}</Num>
        {loading && (
          <span className="text-warning">
            {' '}
            · <Loader2 size={10} className="inline animate-spin" aria-hidden /> بازارهای وام در راه‌اند
          </span>
        )}
      </p>
    </section>
  );
}

function PartCard({ p, n }: { p: MonthlyPart; n: number }) {
  const [open, setOpen] = useState(false);
  const q = liquidationOf(p.o, p.e);
  const start = stepsFor(p.o, p.e).filter((x) => OPEN.has(x.kind));
  const loop = p.o.family === 'leverage';
  const pt = p.o.family === 'pt';
  const lp = p.o.family === 'lp';
  const every = Math.ceil(p.payoutDays);
  const lpDays = lp && p.o.maturity ? Math.ceil((new Date(p.o.maturity).getTime() - Date.now()) / 86_400_000) : null;
  const monthly = lp
    ? `پاداش‌ها (Merkl و PENDLE) را claim کنید؛ نقدینگی بماند.${lpDays !== null && lpDays > 0 ? ` پاداش‌ها تا سررسید (حدود ${formatNumber(lpDays, 0)} روز دیگر) حساب شده‌اند.` : ''}`
    : pt
    ? `روز ${formatNumber(every, 0)}: PT را بازخرید کنید، سود (حدود ${formatUSD(p.monthly * (p.payoutDays / 30), 2)}) را بردارید و اصل را در PT تازه بگذارید.`
    : loop
      ? `کمی از وام ${ltr(p.o.loop?.debt.token.symbol)} را پس بدهید، همان‌قدر ${ltr(p.o.loop?.collateral.token.symbol)} بردارید و به USDC تبدیل کنید.`
      : 'فقط سود را برداشت کنید؛ اصل پول بماند.';
  return (
    <article className="sx-card p-4 flex flex-col gap-3 min-w-0 overflow-hidden">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="grid place-items-center size-6 shrink-0 rounded-full bg-accent text-on-brand text-xs font-bold mt-1">
            <Num>{formatNumber(n, 0)}</Num>
          </span>
          <Identity row={p} />
        </div>
        <div className="flex flex-col items-end shrink-0">
          <Num className="font-semibold text-success">{usd(p.monthly)}</Num>
          <span className="text-[11px] text-secondary">
            {pt ? 'میانگین ماهانه' : 'در ماه'} · <Num>{usd(p.amount)}</Num>
          </span>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <Pill>{networkByKey(p.o.chain).nameFa}</Pill>
        {p.e.leverage && (
          <Pill tone="accent">
            اهرم <Num>{formatMultiplier(p.e.leverage.leverage, 1)}</Num>
          </Pill>
        )}
        {pt ? (
          <Pill tone="success">
            قفل‌شده · برداشت روز <Num>{formatNumber(every, 0)}</Num>
          </Pill>
        ) : (
          <Pill tone="warning">
            ماه بد <Num>{usd(p.bad)}</Num>
          </Pill>
        )}
        {p.unverified && <Pill tone="danger">برابری تأییدنشده</Pill>}
        {p.incentive > 0 && <Pill tone="warning">تخمینی، تضمین‌شده نیست</Pill>}
        {p.stock && <Pill tone="danger">اصل سرمایه: سهم</Pill>}
      </div>

      {q && (
        <p className={`flex items-start gap-1.5 text-xs leading-5 ${q.dropPct < 8 ? 'text-danger' : 'text-warning'}`}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden />
          <span>
            لیکویید با افت <Num className="font-semibold">{formatPercent(q.dropPct, 1)}</Num> <bdi dir="ltr">{p.o.loop?.collateral.token.symbol}</bdi>
            {q.zeroPct !== null && (
              <>
                {' '}
                · اگر نرخ وام از <Num className="font-semibold">{formatPercent(q.zeroPct, 1)}</Num> گذشت ببندید (امروز <Num>{formatPercent(p.e.leverage!.borrowPct, 1)}</Num>)
              </>
            )}
          </span>
        </p>
      )}
      <LoopHistoryFor o={p.o} leverage={p.e.leverage?.leverage} />

      <div className="rounded-lg bg-canvas border border-default px-3 py-2 text-sm flex items-start gap-2">
        <CalendarCheck size={15} className="shrink-0 mt-0.5 text-accent" aria-hidden />
        <span>
          <span className="font-medium">{pt ? 'در سررسید: ' : 'هر ماه: '}</span>
          {monthly}
        </span>
      </div>

      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="tap self-start inline-flex items-center gap-1 text-xs text-secondary hover:text-primary">
        شروع، یک بار <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <StepList steps={start} />}
    </article>
  );
}
