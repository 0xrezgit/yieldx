'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { BellPlus, Check, Scale, ShieldAlert, Target } from 'lucide-react';
import type { YtPlan } from '../../lib/calculators/yt-plan';
import { fdvFor, holdAlternative, pointsWorth, type Band } from '../../lib/calculators/points-worth';
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

const BAND: Record<Band, { label: string; dot: string; note: string }> = {
  loss: { label: 'ضرر خالص', dot: 'bg-danger', note: 'ایردراپ صفر' },
  'small-loss': { label: 'ضرر کم', dot: 'bg-warning', note: 'ایردراپ بخشی از ضرر را می‌پوشاند' },
  even: { label: 'سر به سر', dot: 'bg-muted', note: 'پول برمی‌گردد، ولی کمتر از جایگزین امن' },
  thin: { label: 'سود ناچیز', dot: 'bg-info', note: 'بیشتر از جایگزین امن، کمتر از حداقل سود شما' },
  good: { label: 'سود خوب', dot: 'bg-success', note: 'بیشتر از حداقل سودی که برایتان می‌ارزد' },
};

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

/** Top of the YT statement: what is lost if the airdrop is zero — always shown, before anything else. */
export function WorstCase({ plan, days }: { plan: YtPlan; days: number }) {
  const s = useContext(PointsSettingsContext);
  const w = pointsWorth(plan, days, s.safePct, s.extraPct);
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 leading-7 ${w.zeroUsd < 0 ? 'border-danger/40 bg-danger/[0.06]' : 'border-success/40 bg-success/[0.06]'}`}>
      <ShieldAlert size={18} aria-hidden className={`mt-1 shrink-0 ${w.zeroUsd < 0 ? 'text-danger' : 'text-success'}`} />
      <p className="text-secondary">
        اگر ایردراپ <b className="text-primary">صفر</b> باشد:{' '}
        <b className={tone(w.zeroUsd)}>
          <Num>{usd(w.zeroUsd)}</Num> (<Num>{formatPercent((w.zeroUsd / plan.capital) * 100, 1)}</Num>)
        </b>
        {w.zeroLowUsd < w.zeroUsd - 0.5 && (
          <>
            ؛ اگر بازده پایه هم بدبینانه شود: <b className={tone(w.zeroLowUsd)}><Num>{usd(w.zeroLowUsd)}</Num></b>
          </>
        )}
        . همین مبلغ در جایگزین امن (<Num>{formatPercent(s.safePct, 1)}</Num> سالانه) <Num>{plain(w.safeUsd)}</Num> سود می‌داد؛ هزینه‌ی واقعی پوینت‌ها{' '}
        <b className={w.realCostUsd > 0 ? 'text-danger' : 'text-success'}><Num>{plain(w.realCostUsd)}</Num></b> است.
      </p>
    </div>
  );
}

/**
 * «آیا این پوینت می‌ارزد؟»: no forecast — the value 1M points must reach for each outcome,
 * the FDV that means when the program's size is known, points per dollar at risk next to
 * simply holding the asset or LP, and an exit target that does not depend on the airdrop.
 */
export function PointsWorthView({ plan, days, unitUsd, watch }: { plan: YtPlan; days: number; unitUsd?: number | null; watch?: { id: string; name: string; impliedPct: number } }) {
  const s = useContext(PointsSettingsContext);
  const w = pointsWorth(plan, days, s.safePct, s.extraPct);
  const [total, setTotal] = useState(0);
  const [alloc, setAlloc] = useState(0);
  const alt = holdAlternative(plan, days, s.safePct, unitUsd ?? 1);
  const fdv = (perM: number) => fdvFor(perM, total, alloc);
  const range = (a: number, b: number | null) =>
    b === null ? <>≥ <Num>{plain(a)}</Num></> : a === b ? <Num>{plain(a)}</Num> : <><Num>{plain(a)}</Num> تا <Num>{plain(b)}</Num></>;
  return (
    <div className="flex flex-col gap-4">
      {w.ladder && (
        <section className="flex flex-col gap-2">
          <h5 className="text-sm font-semibold text-primary flex items-center gap-2">
            <Scale size={15} aria-hidden className="text-accent" /> پله‌های نتیجه — پیش‌بینی نیست
          </h5>
          <p className="text-xs text-muted leading-6">
            ایردراپ خوبِ یک پروژه چیزی درباره‌ی پروژه‌ی دیگر یا فصل بعد نمی‌گوید. این جدول فقط نشان می‌دهد هر ۱M پوینت چقدر باید بیرزد تا به هر نتیجه برسید؛ واقع‌بینانه بودنش با شماست.
          </p>
          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="py-2 px-2 text-right font-medium">نتیجه</th>
                  <th className="py-2 px-2 text-right font-medium">ارزش هر ۱M پوینت</th>
                  {fdv(1) !== null && <th className="py-2 px-2 text-right font-medium">یعنی FDV توکن</th>}
                  <th className="py-2 px-2 text-right font-medium">نتیجه‌ی دلاری از</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {w.ladder.map((r) => (
                  <tr key={r.band}>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className="flex items-center gap-1.5 text-primary">
                        <span className={`size-2 rounded-full ${BAND[r.band].dot}`} aria-hidden /> {BAND[r.band].label}
                      </span>
                      <span className="block text-[11px] text-muted whitespace-normal">{BAND[r.band].note}</span>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">{r.band === 'loss' ? <Num>{plain(0)}</Num> : range(r.fromPerM, r.toPerM)}</td>
                    {fdv(1) !== null && (
                      <td className="py-2 px-2 whitespace-nowrap">
                        {r.band === 'loss' ? '—' : r.toPerM === null ? <>≥ <Num>{formatUSDCompact(fdv(r.fromPerM)!)}</Num></> : <><Num>{formatUSDCompact(fdv(r.fromPerM)!)}</Num> تا <Num>{formatUSDCompact(fdv(r.toPerM)!)}</Num></>}
                      </td>
                    )}
                    <td className={`py-2 px-2 whitespace-nowrap ${tone(r.resultUsd)}`}><Num>{usd(r.resultUsd)}</Num></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-secondary">
            <span>برای تبدیل به FDV:</span>
            <label className="flex items-center gap-1.5">
              کل پوینت برنامه
              <input type="number" min={0} value={total || ''} placeholder="مثلاً 50000000000" onChange={(e) => setTotal(Math.max(0, e.target.valueAsNumber || 0))} className="w-36 px-2 text-sm !min-h-9" aria-label="کل پوینت‌های برنامه" />
            </label>
            <label className="flex items-center gap-1.5">
              سهم ایردراپ
              <input type="number" min={0} max={100} value={alloc || ''} placeholder="10" onChange={(e) => setAlloc(Math.min(100, Math.max(0, e.target.valueAsNumber || 0)))} className="w-16 px-2 text-sm !min-h-9" aria-label="درصد ایردراپ از کل توکن" />
              ٪
            </label>
            {total > 0 && w.points !== null && (
              <span>
                سهم شما از کل پوینت‌ها: <Num>{formatPercent((w.points / total) * 100, 4)}</Num> — اگر امتیاز روزانه‌ی کل برنامه بالا برود، این سهم کم می‌شود.
              </span>
            )}
          </div>
        </section>
      )}

      {alt && w.points !== null && (
        <section className="flex flex-col gap-2">
          <h5 className="text-sm font-semibold text-primary">پوینت به ازای هر دلار ریسک</h5>
          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="py-2 px-2 text-right font-medium">با <Num>{plain(plan.capital)}</Num></th>
                  <th className="py-2 px-2 text-right font-medium">پوینت تا سررسید</th>
                  <th className="py-2 px-2 text-right font-medium whitespace-normal">ضرر اگر ایردراپ صفر</th>
                  <th className="py-2 px-2 text-right font-medium">پوینت هر ۱ دلار ریسک</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {[
                  { k: 'خرید YT', p: w.points, r: w.riskUsd, per: w.pointsPerRiskUsd },
                  { k: 'نگه داشتن خود دارایی', p: alt.hold.points, r: alt.hold.riskUsd, per: alt.hold.pointsPerRiskUsd },
                ].map((x) => (
                  <tr key={x.k}>
                    <td className="py-2 px-2 text-primary whitespace-nowrap">{x.k}</td>
                    <td className="py-2 px-2"><Num>{formatCompact(x.p)}</Num></td>
                    <td className="py-2 px-2 text-danger"><Num>{plain(x.r)}</Num></td>
                    <td className="py-2 px-2 font-medium">{x.per === null ? '—' : x.per === Infinity ? <span className="text-success">بدون ریسک دلاری</span> : <Num>{formatCompact(x.per)}</Num>}</td>
                  </tr>
                ))}
                {alt.lp && (
                  <tr>
                    <td className="py-2 px-2 text-primary whitespace-nowrap">LP (ضریب <Num>{formatNumber(alt.lp.multiplier, 1)}×</Num>)</td>
                    <td className="py-2 px-2">تا <Num>{formatCompact(alt.lp.points)}</Num></td>
                    <td className="py-2 px-2 text-muted" colSpan={2}>معمولاً کم؛ برآورد نمی‌شود</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted leading-6">
            ریسک = آنچه نسبت به جایگزین امن از دست می‌رود اگر ایردراپ صفر و بازده پایه بدبینانه باشد. ریسک جدا شدن دارایی از دلار (depeg) در هر سه هست و حساب نشده. پوینت LP سقف است: معمولاً فقط سهم SY استخر پوینت می‌گیرد.
          </p>
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
    <section className="flex flex-col gap-2 rounded-lg border border-default bg-surface px-3 py-2.5">
      <h5 className="text-sm font-semibold text-primary flex items-center gap-2">
        <Target size={15} aria-hidden className="text-accent" /> هدف خروج، مستقل از ایردراپ
      </h5>
      <p className="text-secondary leading-7">
        اگر نرخ ضمنی تا روز <Num>{formatNumber(mid.day, 0)}</Num> ({formatDate(by)}) به <b className="text-primary"><Num>{formatPercent(mid.breakEvenPct, 2)}</Num></b> یا بیشتر برسد (الان <Num>{formatPercent(watch.impliedPct, 2)}</Num>)، با فروش YT پولتان برمی‌گردد و
        {mid.points !== null ? <> <Num>{formatCompact(mid.points)}</Num> پوینتِ</> : ' پوینت‌های'} جمع‌شده رایگان می‌شود.
      </p>
      <div>
        <button type="button" onClick={save} disabled={saved} className="tap inline-flex items-center gap-1.5 rounded-md border border-control px-2.5 min-h-9 text-xs text-secondary hover:text-primary hover:bg-elevated disabled:opacity-70">
          {saved ? <Check size={14} aria-hidden /> : <BellPlus size={14} aria-hidden />} {saved ? 'در «اهداف خروج من» است' : 'پیگیری این هدف'}
        </button>
      </div>
    </section>
  );
}
