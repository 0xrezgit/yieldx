'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import type { MultiplyFeed, MultiplyRow } from '../../lib/multiply/types';
import { analyzeMultiply, leverageOf, maxLeverageOf, SCENARIOS, STRATEGIES, type MultiplyAnalysis, type ScenarioResult } from '../../lib/multiply/model';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatMultiplier, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { PairLogo } from '../ui/asset-identity';
import { Empty, Metric, Pill, Segmented } from '../opportunities/parts';

const STORE = STORAGE_KEYS.multiply;
const CHAIN = 'solana:mainnet';
const LEVERAGES = [1.5, 2, 2.5, 3, 4, 5] as const;
const PERIODS = [7, 30, 90, 180] as const;

interface Settings {
  key: string | null;
  capital: number;
  leverage: number;
  days: number;
  swapPct: number;
}
const initial: Settings = { key: null, capital: 10_000, leverage: 2, days: 30, swapPct: 0.2 };

function useMultiply() {
  const [feed, setFeed] = useState<MultiplyFeed | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/multiply', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MultiplyFeed>) : Promise.reject(new Error(String(r.status)))))
      .then((f) => live && setFeed(f))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return { feed, failed };
}

const signedUsd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const tone = (x: number) => (x > 0.005 ? 'text-success' : x < -0.005 ? 'text-danger' : 'text-secondary');

/**
 * «Multiply پرنوسان»: a leveraged long on Kamino (SOL, JLP, cbBTC, HYPE, tokenised
 * stocks… against a dollar). Not in the dollar ranking — its result is the price path.
 * Shows where liquidation is, and six price paths sized by the pair's own volatility,
 * each played under five ways of managing the position.
 */
export function MultiplyTool() {
  const { feed, failed } = useMultiply();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => setS({ ...initial, ...readLocal<Partial<Settings>>(STORE, {}) }), []);
  useEffect(() => {
    if (s) writeLocal(STORE, s);
  }, [s]);
  const patch = (p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x));

  const rows = feed?.rows ?? [];
  const row = rows.find((r) => r.key === s?.key) ?? rows[0] ?? null;
  const a = useMemo(() => (row && s && s.capital > 0 ? analyzeMultiply(row, { capital: s.capital, leverage: s.leverage, days: s.days, swapPct: s.swapPct }) : null), [row, s]);

  if (!s || (!feed && !failed))
    return (
      <div className="grid place-items-center py-16 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </div>
    );
  if (!rows.length) return <Empty>{failed || feed?.error ? 'داده‌ی Multiply کامینو دریافت نشد.' : 'جفت پرنوسانی برای Multiply پیدا نشد.'}</Empty>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-secondary leading-7">
        Multiply روی دارایی پرنوسان در برابر دلار یعنی خرید اهرمی: سود و زیان از مسیر قیمت می‌آید، نه از نرخ‌ها. برای همین در رتبه‌بندی دلاری نیست. اینجا جای لیکوییدشدن و نتیجه‌ی شش مسیر قیمت با پنج روش مدیریت موقعیت را می‌بینید.
      </p>

      <PairPicker rows={rows} value={row?.key ?? null} onChange={(key) => patch({ key })} />

      {row && (
        <section className="sx-card p-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="سرمایه" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
            <NumberField label="هزینه‌ی هر سواپ (کارمزد و اسلیپیج)" value={s.swapPct} onChange={(v) => patch({ swapPct: Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : 0 })} suffix="٪" />
          </div>
          <Segmented<string>
            value={String(s.leverage)}
            onChange={(v) => patch({ leverage: Number(v) })}
            label="اهرم"
            options={[...LEVERAGES.filter((x) => x <= maxLeverageOf(row.maxLtv) + 1e-9), ...(LEVERAGES.some((x) => Math.abs(x - maxLeverageOf(row.maxLtv)) < 0.01) ? [] : [Math.floor(maxLeverageOf(row.maxLtv) * 100) / 100])].map((x) => ({ id: String(x), label: <Num>{formatMultiplier(x, 2)}</Num> }))}
          />
          <Segmented<string> value={String(s.days)} onChange={(v) => patch({ days: Number(v) })} label="مدت" options={PERIODS.map((d) => ({ id: String(d), label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
          {leverageOf(row, s) < s.leverage - 1e-9 && <p className="text-xs text-warning">اهرم {formatMultiplier(s.leverage, 2)} از سقف وام این جفت بیشتر است؛ با {formatMultiplier(leverageOf(row, s), 2)} حساب شد.</p>}
        </section>
      )}

      {row && a && <Summary row={row} a={a} capital={s.capital} />}
      {row && a && <PayoffChart row={row} a={a} capital={s.capital} days={s.days} />}
      {row && a && (
        <div className="grid gap-3 lg:grid-cols-2">
          {a.scenarios.map((sc) => (
            <ScenarioCard key={sc.scenario} sc={sc} row={row} liq={a.leverage > 1 ? a.liqPrice : 0} />
          ))}
        </div>
      )}
      <StrategyLegend />
      {row && a && <Assumptions row={row} a={a} feed={feed} />}
    </div>
  );
}

function PairPicker({ rows, value, onChange }: { rows: MultiplyRow[]; value: string | null; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto strip pb-1" role="radiogroup" aria-label="جفت">
      {rows.map((r) => {
        const on = r.key === value;
        return (
          <button
            key={r.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r.key)}
            className={`tap shrink-0 rounded-lg border px-3 py-2 flex items-center gap-2 text-start ${on ? 'border-accent bg-accent/10' : 'border-default bg-surface hover:bg-elevated'}`}
          >
            <PairLogo a={{ symbol: r.collateral.symbol, logo: r.collateral.icon }} b={{ symbol: r.debt.symbol, logo: r.debt.icon }} chain={CHAIN} size={24} />
            <span className="flex flex-col leading-tight">
              <bdi dir="ltr" className="text-sm font-semibold">
                {r.collateral.symbol}/{r.debt.symbol}
              </bdi>
              <span className="text-xs text-secondary whitespace-nowrap">
                نوسان <Num>{formatPercent(r.volPct, 0)}</Num> · سقف <Num>{formatMultiplier(maxLeverageOf(r.maxLtv), 1)}</Num>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Summary({ row, a, capital }: { row: MultiplyRow; a: MultiplyAnalysis; capital: number }) {
  const liqUsd = row.collateral.priceUsd * row.debt.priceUsd * a.liqPrice;
  return (
    <section className="sx-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <PairLogo a={{ symbol: row.collateral.symbol, logo: row.collateral.icon }} b={{ symbol: row.debt.symbol, logo: row.debt.icon }} chain={CHAIN} size={32} />
          <div className="flex flex-col">
            <bdi dir="ltr" className="font-semibold">
              {row.collateral.symbol}/{row.debt.symbol}
            </bdi>
            <span className="text-xs text-secondary">{row.market.name} · Kamino</span>
          </div>
        </div>
        <a href={row.url} target="_blank" rel="noreferrer" className="tap inline-flex items-center gap-1 text-sm text-accent">
          صفحه‌ی کامینو <ExternalLink size={14} aria-hidden />
        </a>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="اهرم" hint={<>سقف پروتکل <Num>{formatMultiplier(a.maxLeverage, 2)}</Num></>}>
          <Num>{formatMultiplier(a.leverage, 2)}</Num>
        </Metric>
        <Metric label="قیمت لیکوییدشدن" tone="text-danger" hint={<>قیمت امروز <Num>{formatUSD(row.collateral.priceUsd, row.collateral.priceUsd < 10 ? 4 : 2)}</Num></>}>
          {a.leverage > 1 ? <Num>{formatUSD(liqUsd, liqUsd < 10 ? 4 : 2)}</Num> : 'ندارد'}
        </Metric>
        <Metric label="فاصله تا لیکوییدشدن" tone={a.liqDrop < 0.2 ? 'text-danger' : a.liqDrop < 0.35 ? 'text-warning' : 'text-primary'} hint={<>حدود <Num>{formatNumber(a.liqDrop / Math.max(1e-9, row.volPct / 100 / Math.sqrt(365)), 0)}</Num> روزِ نوسان یک‌سیگمایی</>}>
          {a.leverage > 1 ? <Num>{formatPercent(-a.liqDrop * 100, 1, true)}</Num> : '—'}
        </Metric>
        <Metric label="سلامت" hint={<>حد لیکوییدشدن <Num>{formatPercent(row.liqLtv * 100, 0)}</Num> LTV</>}>
          <Num>{Number.isFinite(a.health) ? formatNumber(a.health, 2) : '∞'}</Num>
        </Metric>
        <Metric label="بازده وثیقه" hint={row.ownYieldPct > 0 ? <>خود دارایی <Num>{formatPercent(row.ownYieldPct, 2)}</Num> + سپرده <Num>{formatPercent(row.supplyPct, 2)}</Num></> : 'فقط سود سپرده'}>
          <Num>{formatPercent(row.collateralYieldPct, 2)}</Num>
        </Metric>
        <Metric label="بهره‌ی وام" hint={row.borrow7dPct !== null ? <>امروز <Num>{formatPercent(row.borrowNowPct, 2)}</Num> · ۷ روز <Num>{formatPercent(row.borrow7dPct, 2)}</Num></> : undefined}>
          <Num>{formatPercent(row.borrowPct, 2)}</Num>
        </Metric>
        <Metric label="بازده با قیمت ثابت" tone={tone(a.carryPct)} hint={<>سالانه روی <Num>{formatUSD(capital, 0)}</Num></>}>
          <Num>{formatPercent(a.carryPct, 2, true)}</Num>
        </Metric>
        <Metric label="نوسان سالانه" hint={<>یک سیگما در این مدت <Num>{formatPercent(a.amplitude * 100, 1)}</Num></>}>
          <Num>{formatPercent(row.volPct, 0)}</Num>
        </Metric>
      </div>
      {a.leverage > 1 && a.liqPriceEnd > a.liqPrice + 1e-6 && (
        <p className="text-xs text-secondary">
          حتی بدون تغییر قیمت، بهره‌ی وام قیمت لیکوییدشدن را تا آخر دوره به <Num>{formatUSD(row.collateral.priceUsd * row.debt.priceUsd * a.liqPriceEnd, 2)}</Num> بالا می‌برد.
        </p>
      )}
      {row.availableUsd !== null && capital * (a.leverage - 1) > row.availableUsd && <p className="text-xs text-warning">نقدینگی قابل وام بازار ({formatUSDCompact(row.availableUsd)}) کمتر از وام این موقعیت است.</p>}
    </section>
  );
}

/** Equity at the end against the price at the end (no path: a straight move), with the six scenario ends marked. */
export function PayoffChart({ row, a, capital, days }: { row: MultiplyRow; a: MultiplyAnalysis; capital: number; days: number }) {
  const W = 640;
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 26 };
  const lo = Math.max(0.2, Math.min(0.5, 1 - 3 * a.amplitude));
  const hi = Math.min(3, Math.max(1.5, 1 + 3 * a.amplitude));
  const L = a.leverage;
  const g = (pct: number) => Math.pow(1 + pct / 100, days / 365);
  const lev = (p: number) => {
    const c = L * g(row.collateralYieldPct);
    const d = (L - 1) * g(row.borrowPct);
    if (L > 1 && d / (c * p) >= row.liqLtv) return 0;
    return Math.max(0, c * p - d) * capital;
  };
  const spot = (p: number) => p * g(row.collateralYieldPct) * capital;
  const xs = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
  const maxY = Math.max(...xs.map(lev), ...xs.map(spot), capital * 1.2);
  const X = (p: number) => pad.l + ((p - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const line = (f: (p: number) => number) => xs.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)},${Y(f(p)).toFixed(1)}`).join(' ');
  const ticks = [lo, (lo + 1) / 2, 1, (1 + hi) / 2, hi];
  return (
    <section className="sx-card p-4 flex flex-col gap-2">
      <h3 className="font-semibold">سرمایه در پایان دوره، بر حسب قیمت پایانی</h3>
      <p className="text-xs text-secondary">حرکت مستقیم تا قیمت پایانی، بدون اقدام؛ نقطه‌ها پایان شش سناریوی پایین‌اند.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="نمودار سرمایه‌ی پایانی بر حسب قیمت">
        <line x1={X(lo)} x2={X(hi)} y1={Y(capital)} y2={Y(capital)} className="stroke-current text-secondary" strokeDasharray="4 4" strokeWidth={1} />
        {L > 1 && a.liqPriceEnd > lo && <rect x={X(lo)} y={pad.t} width={Math.max(0, X(Math.min(hi, a.liqPriceEnd)) - X(lo))} height={H - pad.t - pad.b} className="fill-current text-danger" opacity={0.08} />}
        <path d={line(spot)} className="stroke-current text-secondary" fill="none" strokeWidth={1.5} />
        <path d={line(lev)} className="stroke-current text-accent" fill="none" strokeWidth={2.5} />
        {a.scenarios.map((sc) => (
          <circle key={sc.scenario} cx={X(Math.min(hi, Math.max(lo, sc.endPrice)))} cy={Y(lev(sc.endPrice))} r={4} className="fill-current text-accent" />
        ))}
        {ticks.map((t) => (
          <text key={t} x={X(t)} y={H - 8} textAnchor="middle" className="fill-current text-secondary" fontSize={11}>
            {formatPercent((t - 1) * 100, 0, true)}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-1 rounded bg-accent" /> با اهرم {formatMultiplier(L, 2)}</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-1 rounded bg-secondary" /> بدون اهرم</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2 rounded bg-danger/30" /> ناحیه‌ی لیکوییدشدن</span>
      </div>
    </section>
  );
}

function Spark({ path, liq }: { path: number[]; liq: number }) {
  const W = 120;
  const H = 40;
  const lo = Math.min(...path, liq > 0 ? liq : Infinity, 1) * 0.98;
  const hi = Math.max(...path, 1) * 1.02;
  const X = (i: number) => (i / Math.max(1, path.length - 1)) * W;
  const Y = (v: number) => (1 - (v - lo) / (hi - lo)) * H;
  const up = path[path.length - 1] >= 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-28 h-10 shrink-0" aria-hidden>
      <line x1={0} x2={W} y1={Y(1)} y2={Y(1)} className="stroke-current text-secondary" strokeDasharray="3 3" strokeWidth={1} />
      {liq > 0 && liq > lo && <line x1={0} x2={W} y1={Y(liq)} y2={Y(liq)} className="stroke-current text-danger" strokeWidth={1} />}
      <polyline points={path.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} fill="none" strokeWidth={2} className={`stroke-current ${up ? 'text-success' : 'text-danger'}`} />
    </svg>
  );
}

export function ScenarioCard({ sc, row, liq }: { sc: ScenarioResult; row: MultiplyRow; liq: number }) {
  const meta = SCENARIOS.find((x) => x.id === sc.scenario)!;
  const hold = sc.results.find((r) => r.strategy === 'hold')!;
  const spot = sc.results.find((r) => r.strategy === 'spot')!;
  const Icon = sc.endPrice > 1.001 ? TrendingUp : sc.endPrice < 0.999 ? TrendingDown : ShieldAlert;
  return (
    <section className="sx-card p-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <h3 className="font-semibold flex items-center gap-1.5">
            <Icon size={16} aria-hidden className={sc.endPrice >= 1 ? 'text-success' : 'text-danger'} /> {meta.title}
          </h3>
          <p className="text-xs text-secondary">{meta.text}</p>
          <p className="text-xs">
            <bdi dir="ltr" className="font-semibold">{row.collateral.symbol}</bdi> در پایان <Num className={tone(sc.endPrice - 1)}>{formatPercent((sc.endPrice - 1) * 100, 1, true)}</Num>
            {sc.lowPrice < sc.endPrice - 1e-6 && <> · کف مسیر <Num className="text-danger">{formatPercent((sc.lowPrice - 1) * 100, 1, true)}</Num></>}
          </p>
        </div>
        <Spark path={sc.path} liq={liq} />
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-secondary">
            <th className="text-start font-normal pb-1">روش</th>
            <th className="text-end font-normal pb-1">سود / زیان</th>
            <th className="text-end font-normal pb-1">بازده</th>
          </tr>
        </thead>
        <tbody>
          {sc.results.map((r) => {
            const st = STRATEGIES.find((x) => x.id === r.strategy)!;
            const best = r.strategy === sc.best;
            return (
              <tr key={r.strategy} className={`border-t border-default ${best ? 'bg-accent/8' : ''} ${r.strategy === 'spot' ? 'text-secondary' : ''}`}>
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {st.title}
                    {best && <Pill tone="accent">بهترین</Pill>}
                    {r.liquidated && <Pill tone="danger">لیکویید</Pill>}
                    {r.closedEarly && <Pill tone="warning">بسته شد</Pill>}
                    {r.actions > 0 && !r.closedEarly && <span className="text-xs text-secondary"><Num>{formatNumber(r.actions, 0)}</Num> اقدام</span>}
                  </span>
                </td>
                <td className={`py-1.5 text-end ${tone(r.pnl)}`}>
                  <Num>{signedUsd(r.pnl)}</Num>
                </td>
                <td className={`py-1.5 text-end ${tone(r.pnl)}`}>
                  <Num>{formatPercent(r.pnlPct, 1, true)}</Num>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs leading-6">
        <span className="font-semibold">درس این مسیر: </span>
        {meta.lesson} {hold.pnlPct < spot.pnlPct - 0.05 && sc.endPrice >= 1 ? 'اینجا اهرم حتی از نگه‌داشتن ساده بدتر شد.' : ''}
      </p>
    </section>
  );
}

function StrategyLegend() {
  return (
    <section className="sx-card p-4 flex flex-col gap-2">
      <h3 className="font-semibold">پنج روش مدیریت موقعیت</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {STRATEGIES.map((st) => (
          <li key={st.id}>
            <span className="font-semibold">{st.title}: </span>
            <span className="text-secondary">{st.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Assumptions({ row, a, feed }: { row: MultiplyRow; a: MultiplyAnalysis; feed: MultiplyFeed | null }) {
  const skipped = Object.entries(feed?.skipped ?? {});
  return (
    <section className="text-xs text-secondary leading-6 flex flex-col gap-1">
      <p>
        مسیرها با نوسان واقعی همین جفت ساخته شده‌اند: انحراف معیار سالانه‌ی نسبت قیمت <bdi dir="ltr">{row.collateral.symbol}/{row.debt.symbol}</bdi> در <Num>{formatNumber(row.volDays, 0)}</Num> روز گذشته (<Num>{formatPercent(row.volPct, 0)}</Num>)، یعنی یک سیگما در این مدت <Num>{formatPercent(a.amplitude * 100, 1)}</Num>. پیش‌بینی نیستند؛ نمونه‌هایی از آنچه با این نوسان شدنی است.
      </p>
      <p>
        شبیه‌سازی روزانه: بازده وثیقه و بهره‌ی وام (بیشترینِ امروز و میانگین ۷ روز) ثابت؛ لیکوییدشدن مثل پروتکل: هر بار تا <Num>{formatPercent(row.closeFactor * 100, 0)}</Num> وام بازپرداخت و همان مقدار وثیقه به‌اضافه‌ی <Num>{formatPercent(row.liqBonus * 100, 0)}</Num> پاداش برداشته می‌شود. هر روش فقط روزی یک بار عمل می‌کند؛ حرکت درون روز (سقوط ناگهانی) را نمی‌گیرد.
        {row.elevationGroup > 0 ? <> حدها برای گروه elevation شماره‌ی <Num>{formatNumber(row.elevationGroup, 0)}</Num>.</> : null}
        {row.flashFee ? <> کارمزد فلش‌لون <Num>{formatPercent(row.flashFee * 100, 3)}</Num> روی هر سواپ.</> : null}
      </p>
      <p>منبع: API عمومی کامینو (multiply-pairs، آمار ذخیره‌ها و تاریخچه‌ی قیمت روزانه). اسلیپیج واقعی در حجم بالا می‌تواند بیشتر از عدد بالا باشد.</p>
      {skipped.length > 0 && (
        <p>
          کنار گذاشته شده‌ها:{' '}
          {skipped.map(([why, n], i) => (
            <span key={why}>
              {i ? '، ' : ''}
              {why} (<Num>{formatNumber(n, 0)}</Num>)
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
