'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, XCircle } from 'lucide-react';
import type { LongShortFeed, LongShortRow } from '../../lib/longshort/types';
import { analyzeLongShort, borrowPctOf, holdingPctOf, LEVERAGE_MIN, maxLeverageOf, type LongShortAnalysis, type LongShortInput } from '../../lib/longshort/model';
import { reviewLongShort, type ReviewTone } from '../../lib/longshort/review';
import { networkByChainId } from '../../lib/registry/networks';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatMultiplier, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { PairLogo } from '../ui/asset-identity';
import { Empty, Metric, Pill, Segmented } from '../opportunities/parts';

const STORE = STORAGE_KEYS.longShort;
const LEVERAGES = [1.1, 1.5, 2, 2.5, 3, 4, 5, 6] as const;
const PERIODS = [7, 30, 90, 180] as const;

type Side = 'long' | 'short';
type Category = 'all' | 'crypto' | 'stocks';
interface Settings extends LongShortInput {
  key: string | null;
  side: Side;
  category: Category;
}
// PendleLoop's own slippage default is 0.1%; Hyperliquid's base taker fee 0.045%.
const initial: Settings = { key: null, side: 'long', category: 'all', capital: 1000, leverage: 2, days: 30, swapPct: 0.1, perpFeePct: 0.045 };

function useLongShort() {
  const [feed, setFeed] = useState<LongShortFeed | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/longshort', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<LongShortFeed>) : Promise.reject(new Error(String(r.status)))))
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
const price = (x: number) => formatUSD(x, x < 10 ? 4 : 2);
const RISK: Record<string, { tone: 'success' | 'warning' | 'danger' | 'muted'; label: string }> = {
  none: { tone: 'success', label: 'اوراکل: بدون ریسک' },
  low: { tone: 'success', label: 'اوراکل: ریسک کم' },
  medium: { tone: 'warning', label: 'اوراکل: ریسک متوسط' },
  high: { tone: 'danger', label: 'اوراکل: ریسک زیاد' },
};

/**
 * «Long/Short»: PendleLoop's price views (crypto and tokenised stocks, long or short) built on
 * Aave and Morpho. Not in the dollar ranking — the result is the price. For the market picked:
 * liquidation, holding cost, the outcome of a price move, the same view as a Hyperliquid perp,
 * and the checks that market needs.
 */
export function LongShortTool() {
  const { feed, failed } = useLongShort();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => setS({ ...initial, ...readLocal<Partial<Settings>>(STORE, {}) }), []);
  useEffect(() => {
    if (s) writeLocal(STORE, s);
  }, [s]);
  const patch = (p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x));

  const all = feed?.rows ?? [];
  const rows = all.filter((r) => r.side === s?.side && (s.category === 'all' || r.category === s.category));
  const row = rows.find((r) => r.key === s?.key) ?? rows[0] ?? null;
  const a = useMemo(() => (row && s && s.capital > 0 ? analyzeLongShort(row, s) : null), [row, s]);

  if (!s || (!feed && !failed))
    return (
      <div className="grid place-items-center py-16 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </div>
    );
  if (!all.length) return <Empty>{failed || feed?.error ? 'داده‌ی Long/Short پندل دریافت نشد.' : 'بازار Long/Short در PendleLoop پیدا نشد.'}</Empty>;

  const count = (side: Side) => all.filter((r) => r.side === side).length;
  const max = row ? maxLeverageOf(row) : LEVERAGE_MIN;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-secondary leading-7">
        Long/Short در PendleLoop خرید یا فروش اهرمی روی یک بازار وام (Aave یا Morpho) است، نه یک قرارداد پرپچوال: در Long دارایی وثیقه می‌شود و دلار وام گرفته می‌شود، در Short دلار وثیقه می‌شود و خود دارایی وام گرفته و فروخته می‌شود. سود و زیان از قیمت می‌آید، برای همین در رتبه‌بندی سود نیست. کنار هر بازار همان موقعیت روی پرپ Hyperliquid هم حساب شده است.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Side>
          value={s.side}
          onChange={(side) => patch({ side, key: null })}
          label="جهت"
          options={[
            { id: 'long', label: <>Long (<Num>{formatNumber(count('long'), 0)}</Num>) · سود از بالا رفتن</> },
            { id: 'short', label: <>Short (<Num>{formatNumber(count('short'), 0)}</Num>) · سود از پایین آمدن</> },
          ]}
        />
        <Segmented<Category>
          value={s.category}
          onChange={(category) => patch({ category, key: null })}
          label="دسته"
          size="sm"
          options={[
            { id: 'all', label: 'همه' },
            { id: 'crypto', label: 'کریپتو' },
            { id: 'stocks', label: 'سهام' },
          ]}
        />
      </div>

      {rows.length ? <MarketPicker rows={rows} value={row?.key ?? null} onChange={(key) => patch({ key })} /> : <Empty>در این دسته بازاری برای این جهت نیست.</Empty>}

      {row && (
        <section className="sx-card p-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField label="سرمایه (وثیقه‌ی شما)" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
            <NumberField label="هزینه‌ی سواپ هر طرف (اسلیپیج)" value={s.swapPct} onChange={(v) => patch({ swapPct: Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : 0 })} suffix="٪" />
            <NumberField label="کارمزد پرپ هر طرف (برای مقایسه)" value={s.perpFeePct} onChange={(v) => patch({ perpFeePct: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0 })} suffix="٪" />
          </div>
          <Segmented<string>
            value={String(a?.leverage ?? s.leverage)}
            onChange={(v) => patch({ leverage: Number(v) })}
            label="اهرم"
            options={[...LEVERAGES.filter((x) => x < max - 1e-9), max].map((x) => ({ id: String(x), label: <Num>{formatMultiplier(x, 1)}</Num> }))}
          />
          <Segmented<string> value={String(s.days)} onChange={(v) => patch({ days: Number(v) })} label="مدت" options={PERIODS.map((d) => ({ id: String(d), label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
          {a?.capped && <p className="text-xs text-warning">اهرم {formatMultiplier(s.leverage, 1)} از سقف PendleLoop برای این بازار بیشتر است؛ با {formatMultiplier(a.leverage, 1)} حساب شد.</p>}
        </section>
      )}

      {row && a && <Summary row={row} a={a} s={s} />}
      {row && a && <Review row={row} a={a} s={s} />}
      {row && a && <Outcomes row={row} a={a} />}
      {row && a?.perp && <PerpCompare row={row} a={a} s={s} />}
      <Differences />
      <p className="text-xs text-secondary leading-6">
        منبع: API عمومی پندل (فهرست PendleLoop با Long/Short) و API عمومی Hyperliquid (فاندینگ لحظه‌ای و میانگین ۷ روز). نرخ وام و بازده وثیقه برای کل دوره ثابت فرض شده‌اند؛ مسیر قیمت مستقیم است و نوسان درون مسیر لیکوییدشدن را زودتر می‌کند.
        {feed?.perpError ? ' مقایسه با پرپ این بار دریافت نشد.' : ''}
      </p>
    </div>
  );
}

export function MarketPicker({ rows, value, onChange }: { rows: LongShortRow[]; value: string | null; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto strip pb-1" role="radiogroup" aria-label="بازار">
      {rows.map((r) => {
        const on = r.key === value;
        const hold = holdingPctOf(r.side, LEVERAGE_MIN, r.collateralYieldPct, borrowPctOf(r));
        return (
          <button
            key={r.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r.key)}
            className={`tap shrink-0 rounded-lg border px-3 py-2 flex items-center gap-2 text-start ${on ? 'border-accent bg-accent/10' : 'border-default bg-surface hover:bg-elevated'}`}
          >
            <PairLogo a={{ symbol: r.base.symbol }} b={{ symbol: r.side === 'long' ? r.debt.symbol : r.collateral.symbol }} chain={`eip155:${r.chainId}`} size={24} />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold flex items-center gap-1">
                <bdi dir="ltr">{r.base.symbol}</bdi>
                <span className="text-xs text-secondary">
                  {r.protocol} · {networkByChainId(r.chainId).name}
                </span>
              </span>
              <span className="text-xs text-secondary whitespace-nowrap">
                سقف <Num>{formatMultiplier(maxLeverageOf(r), 1)}</Num> · در ۱٫۱× <Num className={tone(hold)}>{formatPercent(hold, 1, true)}</Num>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Summary({ row, a, s }: { row: LongShortRow; a: LongShortAnalysis; s: Settings }) {
  const risk = row.risk ? RISK[row.risk.level] : null;
  const dist = Math.abs(a.liqMove);
  return (
    <section className="sx-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <PairLogo a={{ symbol: row.base.symbol }} b={{ symbol: row.side === 'long' ? row.debt.symbol : row.collateral.symbol }} chain={`eip155:${row.chainId}`} size={32} />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold flex items-center gap-1.5 flex-wrap">
              <bdi dir="ltr">{row.base.symbol}</bdi>
              <Pill tone={row.side === 'long' ? 'success' : 'danger'}>{row.side === 'long' ? 'Long' : 'Short'}</Pill>
              {risk && <Pill tone={risk.tone}>{risk.label}</Pill>}
            </span>
            <span className="text-xs text-secondary">
              وثیقه <bdi dir="ltr">{row.collateral.symbol}</bdi> · وام <bdi dir="ltr">{row.debt.symbol}</bdi> · {row.protocol} روی {networkByChainId(row.chainId).name} · LLTV <Num>{formatPercent(row.lltv * 100, 0)}</Num>
            </span>
          </div>
        </div>
        <div className="flex gap-3 flex-wrap text-sm">
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 text-accent">
            PendleLoop <ExternalLink size={14} aria-hidden />
          </a>
          {row.marketUrl && (
            <a href={row.marketUrl} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 text-accent">
              بازار وام <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="قیمت امروز" hint={row.change24hPct !== null ? <>۲۴ ساعت <Num className={tone(row.change24hPct)}>{formatPercent(row.change24hPct, 1, true)}</Num></> : undefined}>
          <Num>{price(row.priceUsd)}</Num>
        </Metric>
        <Metric label="اندازه‌ی موقعیت" hint={<>اهرم <Num>{formatMultiplier(a.leverage, 1)}</Num> روی <Num>{formatUSD(s.capital, 0)}</Num></>}>
          <Num>{formatUSDCompact(a.exposureUsd)}</Num>
        </Metric>
        <Metric label="قیمت لیکوییدشدن" tone="text-danger" hint={<>حرکت <Num>{formatPercent(a.liqMove * 100, 1, true)}</Num></>}>
          <Num>{price(a.liqPriceUsd)}</Num>
        </Metric>
        <Metric label="Health Factor پندل" tone={a.healthPct < 0.05 ? 'text-danger' : a.healthPct < 0.12 ? 'text-warning' : 'text-primary'} hint="فاصله تا لیکوییدشدن، به سبک پندل">
          <Num>{formatPercent(a.healthPct * 100, 2)}</Num>
        </Metric>
        <Metric label="درآمد / هزینه‌ی نگه‌داری" tone={tone(a.holdingPct)} hint={<>وثیقه <Num>{formatPercent(row.collateralYieldPct, 1)}</Num> · وام <Num>{formatPercent(a.borrowPct, 1)}</Num></>}>
          <Num>{formatPercent(a.holdingPct, 1, true)}</Num> در سال
        </Metric>
        <Metric label={`در ${formatNumber(s.days, 0)} روز با قیمت ثابت`} tone={tone(a.holdingUsd - a.tradeCostUsd)} hint={<>سواپ باز و بسته <Num>{formatUSD(a.tradeCostUsd, 2)}</Num></>}>
          <Num>{signedUsd(a.holdingUsd - a.tradeCostUsd)}</Num>
        </Metric>
        <Metric label="سربه‌سر" hint={`قیمت باید این‌قدر ${row.side === 'long' ? 'بالا' : 'پایین'} برود`}>
          <Num>{formatPercent(a.breakEvenMove * 100, 2, true)}</Num>
        </Metric>
        <Metric label="نقدینگی قابل وام" hint={row.utilization !== null ? <>استفاده <Num>{formatPercent(row.utilization * 100, 0)}</Num></> : undefined}>
          {row.liquidityUsd !== null ? <Num>{formatUSDCompact(row.liquidityUsd)}</Num> : '—'}
        </Metric>
      </div>
      {Math.abs(a.liqPriceEndUsd - a.liqPriceUsd) > a.liqPriceUsd * 0.001 && (
        <p className="text-xs text-secondary">
          حتی با قیمت ثابت، بهره و سود وثیقه قیمت لیکوییدشدن را تا آخر دوره به <Num>{price(a.liqPriceEndUsd)}</Num> می‌برند (فاصله‌ی امروز <Num>{formatPercent(dist * 100, 1)}</Num>).
        </p>
      )}
    </section>
  );
}

const REVIEW_ICON: Record<ReviewTone, { Icon: typeof Info; cls: string }> = {
  bad: { Icon: XCircle, cls: 'text-danger' },
  warn: { Icon: AlertTriangle, cls: 'text-warning' },
  info: { Icon: Info, cls: 'text-secondary' },
  good: { Icon: CheckCircle2, cls: 'text-success' },
};

export function Review({ row, a, s }: { row: LongShortRow; a: LongShortAnalysis; s: Settings }) {
  const items = reviewLongShort(row, a, s);
  return (
    <section className="sx-card p-4 flex flex-col gap-2" aria-labelledby="ls-review">
      <h3 id="ls-review" className="font-semibold">
        بررسی این بازار
      </h3>
      <ul className="flex flex-col gap-2 text-sm leading-7">
        {items.map((it, i) => {
          const { Icon, cls } = REVIEW_ICON[it.tone];
          return (
            <li key={i} className="flex gap-2">
              <Icon size={16} className={`${cls} shrink-0 mt-1.5`} aria-hidden />
              <span>{it.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Outcomes({ row, a }: { row: LongShortRow; a: LongShortAnalysis }) {
  return (
    <section className="sx-card p-4 flex flex-col gap-2">
      <h3 className="font-semibold">اگر قیمت در پایان دوره این‌قدر حرکت کند</h3>
      <p className="text-xs text-secondary">حرکت مستقیم تا قیمت پایانی، با هزینه‌ها و درآمد نگه‌داری.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-secondary">
            <th className="text-start font-normal pb-1">قیمت <bdi dir="ltr">{row.base.symbol}</bdi></th>
            <th className="text-end font-normal pb-1">PendleLoop</th>
            {a.perp && <th className="text-end font-normal pb-1">پرپ {a.perp.ref.venue}</th>}
          </tr>
        </thead>
        <tbody>
          {a.outcomes.map((o) => (
            <tr key={o.move} className={`border-t border-default ${o.move === 0 ? 'bg-accent/5' : ''}`}>
              <td className="py-1.5">
                <Num className={tone(o.move)}>{formatPercent(o.move * 100, 0, true)}</Num> <span className="text-xs text-secondary">({price(row.priceUsd * (1 + o.move))})</span>
              </td>
              <td className={`py-1.5 text-end ${tone(o.pnl)}`}>
                {o.liquidated && <Pill tone="danger">لیکویید</Pill>} <Num>{signedUsd(o.pnl)}</Num>
              </td>
              {a.perp && (
                <td className={`py-1.5 text-end ${o.perpPnl === null ? 'text-secondary' : tone(o.perpPnl)}`}>
                  {o.perpLiquidated && <Pill tone="danger">لیکویید</Pill>} {o.perpPnl === null ? '—' : <Num>{signedUsd(o.perpPnl)}</Num>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {a.liqPenalty === null && <p className="text-xs text-secondary">در ردیف‌های لیکویید، پاداش لیکوییدکننده‌ی {row.protocol} (منتشرنشده در API) کم نشده؛ زیان واقعی بیشتر است.</p>}
    </section>
  );
}

export function PerpCompare({ row, a, s }: { row: LongShortRow; a: LongShortAnalysis; s: Settings }) {
  const p = a.perp!;
  const cells: { label: string; loop: ReactNode; perp: ReactNode }[] = [
    { label: 'نگه‌داری در سال (روی سرمایه)', loop: <Num className={tone(a.holdingPct)}>{formatPercent(a.holdingPct, 1, true)}</Num>, perp: <Num className={tone(p.holdingPct)}>{formatPercent(p.holdingPct, 1, true)}</Num> },
    { label: `نگه‌داری در ${formatNumber(s.days, 0)} روز`, loop: <Num className={tone(a.holdingUsd)}>{signedUsd(a.holdingUsd)}</Num>, perp: <Num className={tone(p.holdingUsd)}>{signedUsd(p.holdingUsd)}</Num> },
    { label: 'باز و بسته کردن', loop: <Num>{formatUSD(a.tradeCostUsd, 2)}</Num>, perp: <Num>{formatUSD(p.tradeCostUsd, 2)}</Num> },
    { label: 'حرکت تا لیکوییدشدن', loop: <Num>{formatPercent(a.liqMove * 100, 1, true)}</Num>, perp: p.liqMove === null ? 'اهرم مجاز نیست' : <Num>{formatPercent(p.liqMove * 100, 1, true)}</Num> },
    { label: 'سقف اهرم', loop: <Num>{formatMultiplier(maxLeverageOf(row), 1)}</Num>, perp: <Num>{formatMultiplier(p.ref.maxLeverage, 0)}</Num> },
  ];
  return (
    <section className="sx-card p-4 flex flex-col gap-2">
      <h3 className="font-semibold flex items-center gap-2 flex-wrap">
        در برابر پرپ <bdi dir="ltr">{p.ref.coin}</bdi> روی {p.ref.venue}
        <a href={p.ref.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 text-sm font-normal text-accent">
          صفحه <ExternalLink size={13} aria-hidden />
        </a>
      </h3>
      <p className="text-xs text-secondary">
        فاندینگ میانگین ۷ روز <Num>{formatPercent(p.fundingPct, 1, true)}</Num> در سال، الان <Num>{formatPercent(p.ref.fundingNowPct, 1, true)}</Num> (مثبت یعنی Long به Short می‌پردازد). فاندینگ هر ساعت عوض می‌شود.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-secondary">
            <th className="text-start font-normal pb-1" />
            <th className="text-end font-normal pb-1">PendleLoop</th>
            <th className="text-end font-normal pb-1">پرپ</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={c.label} className="border-t border-default">
              <td className="py-1.5 text-secondary">{c.label}</td>
              <td className="py-1.5 text-end">{c.loop}</td>
              <td className="py-1.5 text-end">{c.perp}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm">
        در این مدت <span className="font-semibold">{p.costGapUsd < 0 ? 'PendleLoop' : `پرپ ${p.ref.venue}`}</span> حدود <Num className="font-semibold">{formatUSD(Math.abs(p.costGapUsd), 2)}</Num> ارزان‌تر است.
      </p>
    </section>
  );
}

function Differences() {
  const items: [string, string][] = [
    ['هزینه', 'در PendleLoop هزینه‌ی نگه‌داری از نرخ‌های بازار وام می‌آید (بهره‌ی وام منهای سود وثیقه) و با میزان استفاده از بازار عوض می‌شود. در پرپ فاندینگ است که هر ساعت با عدم‌تعادل خریداران و فروشندگان عوض می‌شود و می‌تواند علامتش برگردد.'],
    ['لیکوییدشدن', 'اینجا با رسیدن به LLTV بازار وام و با قیمت اوراکل (مثلاً Chainlink) لیکویید می‌شوید، و لیکوییدکننده پاداش برمی‌دارد. در پرپ با رسیدن به حاشیه‌ی نگه‌داری و با قیمت مارک صرافی. با اهرم برابر، این‌جا معمولاً زودتر لیکویید می‌شوید.'],
    ['سقف اهرم', 'سقف از LLTV می‌آید: حدود ۲٫۶ تا ۶ برابر. پرپ‌ها ۲۰ تا ۴۰ برابر می‌دهند.'],
    ['دارایی واقعی', 'در Long خود دارایی را نگه می‌دارید؛ اگر بازده داشته باشد (مثل wstETH) آن را هم می‌گیرید. اندازه‌ی موقعیت به نقدینگی قابل وام بازار محدود است.'],
    ['باز و بسته کردن', 'با سواپ در DEX: اسلیپیج و اثر قیمت در حجم بالا. پرپ کارمزد معامله دارد ولی سواپ ندارد.'],
    ['سهام توکنیزه', 'اوراکل فقط وقتی بازار سهام باز است قیمت می‌دهد؛ آخر هفته قیمت ثابت می‌ماند و با باز شدن بازار ممکن است جهش کند. پرپ سهام ۲۴/۷ با قیمت داخلی خودش معامله می‌شود.'],
    ['ریسک‌های اضافه', 'قرارداد Pendle، بازار وام، اوراکل و صادرکننده‌ی توکن (برای سهام). در پرپ: ریسک صرافی و کاهش خودکار موقعیت (ADL).'],
  ];
  return (
    <section className="sx-card p-4 flex flex-col gap-2">
      <h3 className="font-semibold">تفاوت Long/Short در PendleLoop با پرپ</h3>
      <ul className="flex flex-col gap-1.5 text-sm leading-7">
        {items.map(([t, x]) => (
          <li key={t}>
            <span className="font-semibold">{t}: </span>
            <span className="text-secondary">{x}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
