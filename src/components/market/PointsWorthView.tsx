'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BellPlus, Check, Scale, ShieldAlert, Target } from 'lucide-react';
import type { YtPlan } from '../../lib/calculators/yt-plan';
import { fdvFor, holdAlternative, pointsWorth, type Band, type PointsWorth } from '../../lib/calculators/points-worth';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatCompact, formatDate, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const plain = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const tone = (x: number) => (x >= 0 ? 'text-success' : 'text-danger');

/** The buyer's own yardsticks: the safe alternative and the extra profit worth their time (% a year). */
export interface PointsSettings {
  safePct: number;
  extraPct: number;
}
export const DEFAULT_POINTS_SETTINGS: PointsSettings = { safePct: 8, extraPct: 5 };
export const PointsSettingsContext = createContext<PointsSettings>(DEFAULT_POINTS_SETTINGS);

const BAND: Record<Band, { label: string; dot: string; text: string; note: string }> = {
  loss: { label: 'ضرر خالص', dot: 'bg-danger', text: 'text-danger', note: 'ایردراپ صفر' },
  'small-loss': { label: 'ضرر کم', dot: 'bg-warning', text: 'text-warning', note: 'ایردراپ بخشی از ضرر را می‌پوشاند' },
  even: { label: 'سر به سر', dot: 'bg-muted', text: 'text-secondary', note: 'پول برمی‌گردد، کمتر از جایگزین امن' },
  thin: { label: 'سود ناچیز', dot: 'bg-accent', text: 'text-accent', note: 'کمتر از حداقل سودی که برایتان می‌ارزد' },
  good: { label: 'سود خوب', dot: 'bg-success', text: 'text-success', note: 'بیشتر از حداقل سود شما' },
};

/** Saved per-program season ends (ISO dates), keyed by program name: no points count after them. */
const SEASON_EVENT = 'yieldx-season-ends';
export const readSeasonEnds = () => readLocal<Record<string, string>>(STORAGE_KEYS.seasonEnds, {});
export function useSeasonEnds() {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = () => setMap(readSeasonEnds());
    load();
    window.addEventListener(SEASON_EVENT, load);
    return () => window.removeEventListener(SEASON_EVENT, load);
  }, []);
  return map;
}
function setSeasonEnd(program: string, iso: string | null) {
  const next = { ...readSeasonEnds() };
  if (iso) next[program] = iso;
  else delete next[program];
  writeLocal(STORAGE_KEYS.seasonEnds, next);
  window.dispatchEvent(new Event(SEASON_EVENT));
}
/** Days from now to a season end, or null when none is set. */
export const daysUntil = (iso: string | undefined, now = Date.now()) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - now) / 86_400_000)) : null);

/** Saved exit targets: «sell when the implied rate reaches X by day Y». */
export interface ExitTarget {
  id: string;
  name: string;
  targetPct: number;
  by: string;
  impliedAtSave: number;
  savedAt: string;
}
export const readTargets = () => readLocal<ExitTarget[]>(STORAGE_KEYS.ytTargets, []).filter((t) => t && typeof t.id === 'string' && Number.isFinite(t.targetPct));
export const writeTargets = (list: ExitTarget[]) => {
  writeLocal(STORAGE_KEYS.ytTargets, list);
  window.dispatchEvent(new Event('yieldx-yt-targets'));
};
export function useTargets() {
  const [list, setList] = useState<ExitTarget[]>([]);
  useEffect(() => {
    const load = () => setList(readTargets());
    load();
    window.addEventListener('yieldx-yt-targets', load);
    return () => window.removeEventListener('yieldx-yt-targets', load);
  }, []);
  return list;
}

function Stat({ label, children, cls = 'text-primary' }: { label: string; children: ReactNode; cls?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`text-sm font-semibold ${cls}`}>{children}</span>
    </div>
  );
}

/**
 * «اگر ایردراپ صفر باشد»: the first thing on any points position — the result with no
 * airdrop, a pessimistic one (`lowLabel`), and the real cost once the safe alternative counts.
 */
export function ZeroCard({ w, capital, lowLabel, extra }: { w: PointsWorth; capital: number; lowLabel: string; extra?: ReactNode }) {
  const s = useContext(PointsSettingsContext);
  const bad = w.zeroUsd < 0;
  return (
    <div className={`relative overflow-hidden rounded-xl border border-default bg-surface px-4 py-3 ${bad ? 'shadow-[inset_-3px_0_0_var(--c-danger)]' : 'shadow-[inset_-3px_0_0_var(--c-success)]'}`}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <ShieldAlert size={14} aria-hidden className={bad ? 'text-danger' : 'text-success'} /> اگر ایردراپ صفر باشد
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold leading-tight ${tone(w.zeroUsd)}`}><Num>{usd(w.zeroUsd)}</Num></span>
        <span className="text-xs text-muted"><Num>{formatPercent((w.zeroUsd / capital) * 100, 1)}</Num> سرمایه</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-default pt-2.5">
        <Stat label={lowLabel} cls={tone(w.zeroLowUsd)}><Num>{usd(w.zeroLowUsd)}</Num></Stat>
        <Stat label={`جایگزین امن ${formatNumber(s.safePct, 1)}٪`} cls="text-secondary"><Num>{plain(w.safeUsd)}</Num></Stat>
        <Stat label="هزینه‌ی واقعی پوینت" cls={w.realCostUsd > 0 ? 'text-danger' : 'text-success'}><Num>{plain(w.realCostUsd)}</Num></Stat>
      </div>
      {extra}
    </div>
  );
}

/** Top of the YT statement. */
export function WorstCase({ plan, days }: { plan: YtPlan; days: number }) {
  const s = useContext(PointsSettingsContext);
  return <ZeroCard w={pointsWorth(plan, days, s.safePct, s.extraPct)} capital={plan.capital} lowLabel="با بازده پایه‌ی بدبینانه" />;
}

/**
 * The outcome ladder — no forecast: how large the buyer's whole airdrop must be for each
 * outcome; per 1M points and the token's FDV beside it when the points are known.
 */
export function LadderView({ w, program }: { w: PointsWorth; program?: string | null }) {
  const [total, setTotal] = useState(0);
  const [alloc, setAlloc] = useState(0);
  const [buffer, setBuffer] = useState(20);
  const perM = w.points !== null && w.points > 0;
  const fdv = (v: number | null) => (v === null ? null : fdvFor(v, total, alloc, buffer));
  const showFdv = perM && fdv(1) !== null;
  const seasons = useSeasonEnds();
  const season = program ? seasons[program] : undefined;
  const bound = (a: number, b: number | null, f: (x: number) => string) => (b === null ? <>≥ <Num>{f(a)}</Num></> : <><Num>{f(a)}</Num> – <Num>{f(b)}</Num></>);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-primary flex items-center gap-2">
          <Scale size={15} aria-hidden className="text-accent" /> ایردراپ شما باید چقدر شود؟
        </h5>
        <span className="text-[11px] text-muted">پیش‌بینی نیست</span>
      </div>

      <div className="flex h-1.5 overflow-hidden rounded-full gap-0.5" aria-hidden>
        {w.ladder.map((r) => (
          <span key={r.band} className={`flex-1 ${BAND[r.band].dot} ${r.band === 'even' ? 'opacity-50' : 'opacity-80'}`} />
        ))}
      </div>

      <ul className="flex flex-col divide-y divide-default rounded-xl border border-default bg-surface">
        {w.ladder.map((r) => (
          <li key={r.band} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
            <span className="flex items-start gap-2.5 min-w-0">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${BAND[r.band].dot}`} aria-hidden />
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${BAND[r.band].text}`}>{BAND[r.band].label}</span>
                <span className="block text-[11px] text-muted leading-5">{BAND[r.band].note}</span>
              </span>
            </span>
            <span className="flex flex-col items-end text-left">
              <span className="text-sm text-primary whitespace-nowrap">{r.band === 'loss' ? <Num>{plain(0)}</Num> : bound(r.fromUsd, r.toUsd, plain)}</span>
              {perM && r.band !== 'loss' && r.fromPerM !== null && (
                <span className="text-[11px] text-muted whitespace-nowrap">
                  هر ۱M پوینت {bound(r.fromPerM, r.toPerM, plain)}
                  {showFdv && <> · FDV {bound(fdv(r.fromPerM)!, fdv(r.toPerM), (x) => formatUSDCompact(x))}</>}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted leading-5">
        ایردراپ خوبِ یک پروژه چیزی درباره‌ی پروژه‌ی دیگر یا فصل بعد نمی‌گوید؛ این‌جا فقط شرط هر نتیجه آمده و قضاوت با شماست.
      </p>

      {(perM || program) && (
        <details className="group rounded-xl border border-default bg-surface px-3 py-2 text-xs text-secondary">
          <summary className="cursor-pointer select-none text-secondary">فصل، کل پوینت‌ها و FDV</summary>
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
            {program && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span>پایان فصل <bdi dir="ltr">{program}</bdi> — پوینت بعد از آن شمرده نمی‌شود</span>
                <span className="flex items-center gap-2">
                  <input type="date" value={season ? season.slice(0, 10) : ''} onChange={(e) => setSeasonEnd(program, e.target.value ? new Date(e.target.value).toISOString() : null)} className="px-2 text-sm !min-h-9" aria-label="تاریخ پایان فصل" />
                  {season && <span className="text-muted"><Num>{formatNumber(daysUntil(season) ?? 0, 0)}</Num> روز دیگر</span>}
                </span>
              </label>
            )}
            {perM && (
              <>
                <label className="flex flex-col gap-1">
                  کل پوینت‌های برنامه در پایان فصل
                  <input type="number" min={0} value={total || ''} placeholder="50000000000" onChange={(e) => setTotal(Math.max(0, e.target.valueAsNumber || 0))} className="px-2 text-sm !min-h-9" aria-label="کل پوینت‌های برنامه" />
                </label>
                <label className="flex flex-col gap-1">
                  سهم ایردراپ از کل توکن ٪
                  <input type="number" min={0} max={100} value={alloc || ''} placeholder="3.5" onChange={(e) => setAlloc(Math.min(100, Math.max(0, e.target.valueAsNumber || 0)))} className="px-2 text-sm !min-h-9" aria-label="درصد ایردراپ" />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  حاشیه‌ی رقیق‌شدن ٪ — کل پوینت‌ها معمولاً از پیش‌بینی امروز بیشتر می‌شود
                  <input type="number" min={0} value={buffer} onChange={(e) => setBuffer(Math.max(0, e.target.valueAsNumber || 0))} className="px-2 text-sm !min-h-9 sm:w-32" aria-label="حاشیه‌ی رقیق‌شدن" />
                </label>
                {total > 0 && w.points !== null && (
                  <p className="sm:col-span-2 text-muted">
                    سهم شما از کل: <Num>{formatPercent((w.points / (total * (1 + buffer / 100))) * 100, 4)}</Num>
                  </p>
                )}
              </>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * «آیا این پوینت می‌ارزد؟» under the YT statement: the ladder, points per dollar at risk
 * next to simply holding the asset or LP, and an exit target that does not need the airdrop.
 */
export function PointsWorthView({ plan, days, unitUsd, watch }: { plan: YtPlan; days: number; unitUsd?: number | null; watch?: { id: string; name: string; impliedPct: number } }) {
  const s = useContext(PointsSettingsContext);
  const w = pointsWorth(plan, days, s.safePct, s.extraPct);
  const alt = holdAlternative(plan, days, s.safePct, unitUsd ?? 1);
  return (
    <div className="flex flex-col gap-5">
      <LadderView w={w} program={plan.program?.name ?? null} />

      {alt && w.points !== null && (
        <section className="flex flex-col gap-2">
          <h5 className="text-sm font-semibold text-primary">پوینت به ازای هر دلار ریسک</h5>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { k: 'خرید YT', p: w.points, r: w.riskUsd, per: w.pointsPerRiskUsd as number | null, accent: true },
              { k: 'نگه داشتن دارایی', p: alt.hold.points, r: alt.hold.riskUsd, per: alt.hold.pointsPerRiskUsd as number | null, accent: false },
              ...(alt.lp ? [{ k: `LP (ضریب ${formatNumber(alt.lp.multiplier, 1)}×)`, p: alt.lp.points, r: null as number | null, per: null as number | null, accent: false }] : []),
            ].map((x) => (
              <li key={x.k} className={`rounded-xl border bg-surface px-3 py-2.5 ${x.accent ? 'border-accent/40' : 'border-default'}`}>
                <div className="text-xs text-muted">{x.k}</div>
                <div className="mt-1 text-base font-semibold text-primary">
                  {x.per === null ? <span className="text-sm text-muted">ریسک برآورد نمی‌شود</span> : x.per === Infinity ? <span className="text-success text-sm">بدون ریسک دلاری</span> : <><Num>{formatCompact(x.per)}</Num> <span className="text-xs font-normal text-muted">در هر دلار</span></>}
                </div>
                <div className="text-[11px] text-muted">
                  {x.r === null ? 'تا ' : ''}<Num>{formatCompact(x.p)}</Num> پوینت{x.r !== null && <> · ریسک <Num>{plain(x.r)}</Num></>}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted leading-5">ریسک = آنچه نسبت به جایگزین امن از دست می‌رود اگر ایردراپ صفر و بازده پایه بدبینانه باشد. ریسک جدا شدن از دلار در همه هست. پوینت LP سقف است: معمولاً فقط سهم SY استخر پوینت می‌گیرد.</p>
        </section>
      )}

      {watch && <ExitGoal plan={plan} watch={watch} />}
    </div>
  );
}

/** An exit that does not depend on the airdrop: the implied rate at which selling the YT gives the money back. */
function ExitGoal({ plan, watch }: { plan: YtPlan; watch: { id: string; name: string; impliedPct: number } }) {
  const finite = plan.exits.filter((x) => Number.isFinite(x.breakEvenPct));
  // A mid-term sale: late enough for the rate to move, early enough to matter.
  const mid = finite[Math.floor((finite.length - 1) / 2)] ?? null;
  const targets = useTargets();
  if (!mid) return null;
  const saved = targets.some((t) => t.id === watch.id);
  const by = new Date(Date.now() + mid.day * 86_400_000).toISOString();
  const save = () =>
    writeTargets([
      ...readTargets().filter((t) => t.id !== watch.id),
      { id: watch.id, name: watch.name, targetPct: mid.breakEvenPct, by, impliedAtSave: watch.impliedPct, savedAt: new Date().toISOString() },
    ]);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-default bg-surface px-4 py-3">
      <h5 className="text-sm font-semibold text-primary flex items-center gap-2">
        <Target size={15} aria-hidden className="text-accent" /> هدف خروج، مستقل از ایردراپ
      </h5>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-accent"><Num>{formatPercent(mid.breakEvenPct, 2)}</Num></span>
        <span className="text-xs text-muted">تا روز <Num>{formatNumber(mid.day, 0)}</Num> ({formatDate(by)}) · الان <Num>{formatPercent(watch.impliedPct, 2)}</Num></span>
      </div>
      <p className="text-xs text-secondary leading-6">
        اگر نرخ ضمنی به این عدد یا بیشتر برسد، با فروش YT پولتان برمی‌گردد و
        {mid.points !== null ? <> <Num>{formatCompact(mid.points)}</Num> پوینتِ</> : ' پوینت‌های'} جمع‌شده رایگان می‌شود.
      </p>
      <div>
        <button type="button" onClick={save} disabled={saved} className="tap inline-flex items-center gap-1.5 rounded-full border border-control px-3 min-h-8 text-xs text-secondary hover:text-primary hover:bg-elevated disabled:opacity-70">
          {saved ? <Check size={14} aria-hidden className="text-success" /> : <BellPlus size={14} aria-hidden />} {saved ? 'در «اهداف خروج من»' : 'پیگیری این هدف'}
        </button>
      </div>
    </section>
  );
}
