'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import type { PointsBasis } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import thresholds from '../../config/thresholds.json';
import { maxLoopLeverage, simulateLoop, simulatePt, simulateYt, ytEntryLimits, ytPriceFromAPY } from '../../lib/calculators/trade';
import { ptPriceFromAPY } from '../../lib/calculators/implied-apy';
import { formatCompact, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { NumberField, SelectField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { Bound, Metric, Segmented, signedPct } from './parts';

export type CalcMode = 'yt' | 'pt' | 'loop';

export interface CalcState {
  mode: CalcMode;
  protocol: ProtocolId | null;
  marketId: string;
  marketName: string;
  icon: string | null;
  capital: number;
  underlyingPrice: number;
  days: number;
  entryAPY: number;
  baseAPY: number;
  holdDays: number;
  exitAPY: number;
  fee: number;
  lossBudget: number;
  pointsPerDay: number;
  ytMultiplier: number;
  pointsBasis: PointsBasis;
  /** USD value of 1M points (airdrop assumption). */
  valuePerMillion: number;
  leverage: number;
  borrowAPY: number;
  lltv: number;
}

export const defaultCalc: CalcState = {
  mode: 'yt',
  protocol: null,
  marketId: '',
  marketName: '',
  icon: null,
  capital: 10_000,
  underlyingPrice: 1,
  days: 120,
  entryAPY: 10,
  baseAPY: 8,
  holdDays: 30,
  exitAPY: 10,
  fee: thresholds.exit.costPercent,
  lossBudget: 10,
  pointsPerDay: 1,
  ytMultiplier: 1,
  pointsBasis: 'usd',
  valuePerMillion: 0,
  leverage: 3,
  borrowAPY: 5.5,
  lltv: 86,
};

const money = (x: number) => (x >= 0 ? `+${formatUSD(x, 0)}` : formatUSD(x, 0));
const tone = (x: number) => (x >= 0 ? 'text-success' : 'text-danger');

type SetCalc = (patch: Partial<CalcState>) => void;

/** Scenario calculator for one trade: YT for points, PT to a date, or a PT loop. */
export function CalculatorPanel({
  c,
  set,
  markets,
  onPick,
  loadingMarket,
}: {
  c: CalcState;
  set: SetCalc;
  markets: OpportunityListing[];
  onPick: (m: OpportunityListing) => void;
  loadingMarket: boolean;
}) {
  const options = markets
    .filter((m) => !m.expired)
    .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))
    .slice(0, 300);
  const key = (m: OpportunityListing) => `${m.protocol}:${m.id}`;
  const current = c.protocol ? `${c.protocol}:${c.marketId}` : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)] gap-4 items-start">
      <section className="rounded-2xl border border-default bg-surface/80 p-4 flex flex-col gap-4 lg:sticky lg:top-22">
        <Segmented
          value={c.mode}
          onChange={(mode) => set({ mode })}
          label="نوع معامله"
          options={[
            { id: 'yt', label: 'YT' },
            { id: 'pt', label: 'PT' },
            { id: 'loop', label: 'لوپ PT' },
          ]}
        />

        <div className="flex items-center gap-3">
          {c.marketName && <TokenLogo src={c.icon} name={c.marketName} size={36} />}
          <div className="flex-1 min-w-0">
            <SelectField
              label={loadingMarket ? 'در حال دریافت بازار…' : 'بازار'}
              value={current}
              onChange={(v) => {
                const m = options.find((x) => key(x) === v);
                if (m) onPick(m);
                else set({ protocol: null, marketId: '', marketName: '', icon: null });
              }}
              options={[
                { value: '', label: 'دستی' },
                ...(current && !options.some((m) => key(m) === current) ? [{ value: current, label: c.marketName }] : []),
                ...options.map((m) => ({ value: key(m), label: `${m.name} · ${m.chain} · ${formatPercent(m.impliedAPY, 1)}` })),
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField label="سرمایه" value={c.capital} onChange={(v) => set({ capital: v })} suffix="$" />
          <NumberField label="روز تا سررسید" value={c.days} onChange={(v) => set({ days: v })} />
          <NumberField label="نرخ ورود (Implied)" value={c.entryAPY} onChange={(v) => set({ entryAPY: v })} suffix="%" />
          {c.mode === 'yt' && <NumberField label="بازده پایه" value={c.baseAPY} onChange={(v) => set({ baseAPY: v })} suffix="%" />}
          {c.mode !== 'loop' && (
            <>
              <NumberField label="روز نگه‌داری" value={c.holdDays} onChange={(v) => set({ holdDays: v })} hint="برابر روز تا سررسید = نگه‌داری کامل" />
              <NumberField label="نرخ روز فروش" value={c.exitAPY} onChange={(v) => set({ exitAPY: v })} suffix="%" />
            </>
          )}
          {c.mode === 'loop' && (
            <>
              <NumberField label="اهرم" value={c.leverage} onChange={(v) => set({ leverage: v })} suffix="×" />
              <NumberField label="بهره‌ی وام" value={c.borrowAPY} onChange={(v) => set({ borrowAPY: v })} suffix="%" />
              <NumberField label="LLTV" value={c.lltv} onChange={(v) => set({ lltv: v })} suffix="%" />
            </>
          )}
          <NumberField label="کارمزد هر معامله" value={c.fee} onChange={(v) => set({ fee: v })} suffix="%" />
        </div>

        {c.mode === 'yt' && (
          <details className="group rounded-xl border border-default" open>
            <summary className="px-3 py-2 text-sm font-bold text-primary">پوینت و ایردراپ</summary>
            <div className="grid grid-cols-2 gap-3 p-3 pt-0">
              <NumberField label="پوینت روزانه" value={c.pointsPerDay} onChange={(v) => set({ pointsPerDay: v })} />
              <SelectField
                label="به ازای"
                value={c.pointsBasis}
                onChange={(v) => set({ pointsBasis: v })}
                options={[
                  { value: 'usd', label: 'هر ۱ دلار' },
                  { value: 'unit', label: 'هر ۱ واحد دارایی' },
                ]}
              />
              <NumberField label="ضریب YT" value={c.ytMultiplier} onChange={(v) => set({ ytMultiplier: v })} suffix="×" />
              <NumberField label="قیمت دارایی" value={c.underlyingPrice} onChange={(v) => set({ underlyingPrice: v })} suffix="$" />
              <NumberField label="ارزش هر ۱M پوینت" value={c.valuePerMillion} onChange={(v) => set({ valuePerMillion: v })} suffix="$" />
              <NumberField label="سقف ضرر" value={c.lossBudget} onChange={(v) => set({ lossBudget: v })} suffix="%" />
            </div>
          </details>
        )}
      </section>

      <div className="flex flex-col gap-4 min-w-0">
        {c.mode === 'yt' && <YtResult c={c} />}
        {c.mode === 'pt' && <PtResult c={c} />}
        {c.mode === 'loop' && <LoopResult c={c} />}
        <p className="text-xs text-muted">
          فرض‌ها: قیمت دلاری دارایی ثابت، بازده پایه در کل دوره ثابت، کارمزد روی هر خرید/فروش و بدون کارمزد در سررسید. اعداد تخمینی‌اند و
          توصیه‌ی مالی نیستند.
        </p>
      </div>
    </div>
  );
}

// ─── Shared result pieces ─────────────────────────────────────────────────────

function Headline({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }[] }) {
  return (
    <div className="rounded-2xl p-px bg-linear-to-bl from-accent/60 to-brand2/40">
      <div className="rounded-2xl bg-surface p-4 grid gap-3 text-center" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((i, k) => (
          <div key={i.label} className={`min-w-0 ${k ? 'border-r border-default' : ''}`}>
            <div className="text-xs text-muted">{i.label}</div>
            <div className={`font-extrabold text-lg leading-tight ${i.tone ?? 'text-primary'}`}>{i.value}</div>
            {i.hint && <div className="text-xs text-secondary">{i.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Verdict({ kind, children }: { kind: 'good' | 'ok' | 'bad' | 'info'; children: ReactNode }) {
  const look = {
    good: { icon: CheckCircle2, cls: 'border-success/35 bg-success/10 text-success' },
    ok: { icon: TriangleAlert, cls: 'border-warning/40 bg-warning/10 text-warning' },
    bad: { icon: XCircle, cls: 'border-danger/40 bg-danger/10 text-danger' },
    info: { icon: Info, cls: 'border-strong bg-elevated/50 text-secondary' },
  }[kind];
  const Icon = look.icon;
  return (
    <div className={`flex gap-3 border rounded-xl px-3 py-2.5 text-sm ${look.cls}`}>
      <Icon size={18} className="shrink-0 mt-0.5" />
      <div className="text-primary">{children}</div>
    </div>
  );
}

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="rounded-2xl border border-default bg-surface/80 divide-y divide-default text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <dt className="text-secondary">{k}</dt>
          <dd className="text-primary font-medium text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ title, head, rows, highlight }: { title: string; head: string[]; rows: ReactNode[][]; highlight?: number }) {
  return (
    <section className="rounded-2xl border border-default bg-surface/80 p-4 flex flex-col gap-2">
      <h3 className="text-sm font-bold text-primary">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              {head.map((h) => (
                <th key={h} className="text-right font-normal py-1.5 px-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t border-default ${i === highlight ? 'bg-accent/10' : ''}`}>
                {r.map((cell, j) => (
                  <td key={j} className="py-1.5 px-2 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const OFFSETS = [-3, -1.5, 0, 1.5, 3];

// ─── YT ────────────────────────────────────────────────────────────────────────

function YtResult({ c }: { c: CalcState }) {
  const input = {
    capital: c.capital,
    underlyingPrice: c.underlyingPrice,
    daysToMaturity: c.days,
    entryAPY: c.entryAPY,
    baseAPY: c.baseAPY,
    holdDays: c.holdDays,
    exitAPY: c.exitAPY,
    feePercent: c.fee,
    pointsPerDay: c.pointsPerDay,
    ytMultiplier: c.ytMultiplier,
    pointsBasis: c.pointsBasis,
    valuePerPoint: c.valuePerMillion / 1e6,
  };
  if (!(c.capital > 0 && c.days > 0 && c.entryAPY > 0 && c.underlyingPrice > 0)) return <Verdict kind="info">سرمایه، روز تا سررسید و نرخ ورود باید بیشتر از صفر باشند.</Verdict>;

  const t = simulateYt(input);
  const limits = ytEntryLimits(input, c.lossBudget);
  const costPerM = t.breakEvenPointValue * 1e6;
  const budget = (c.capital * c.lossBudget) / 100;

  let verdict: ReactNode;
  let kind: 'good' | 'ok' | 'bad';
  if (t.cash >= 0) {
    kind = 'good';
    verdict = <>با این فرض‌ها معامله ضرر نقدی ندارد و <b>پوینت‌ها رایگان‌اند</b>.</>;
  } else if (t.total >= 0) {
    kind = 'good';
    verdict = <>ضرر نقدی <Num>{formatUSD(-t.cash, 0)}</Num> است و با ارزش ایردراپ جبران می‌شود.</>;
  } else if (-t.cash <= budget) {
    kind = 'ok';
    verdict = (
      <>
        ضرر <Num>{formatUSD(-t.cash, 0)}</Num> در سقف شماست؛ هر ۱M پوینت <Num>{formatUSD(costPerM, 0)}</Num> تمام می‌شود. ایردراپ باید
        دست‌کم همین‌قدر بیرزد.
      </>
    );
  } else {
    kind = 'bad';
    verdict = (
      <>
        گران است. برای پوینت رایگان لیمیت را روی <Bound label="Implied" op="≤" x={limits.free} /> و برای ضرر ≤ {formatNumber(c.lossBudget, 0)}٪ روی{' '}
        <Bound label="Implied" op="≤" x={limits.budget} /> بگذارید.
      </>
    );
  }

  // Early exit: vary the exit rate. To maturity: vary the base APY (exit rate is irrelevant).
  const early = !t.toMaturity;
  const scen = OFFSETS.map((o) => {
    const v = early ? Math.max(0.01, c.exitAPY + o) : Math.max(0, c.baseAPY + o);
    return { v, r: simulateYt(early ? { ...input, exitAPY: v } : { ...input, baseAPY: v }) };
  });

  return (
    <>
      <Headline
        items={[
          { label: 'نتیجه‌ی نقدی', value: <Num>{money(t.cash)}</Num>, hint: <Num>{signedPct(t.cashPercent)}</Num>, tone: tone(t.cash) },
          { label: 'پوینت', value: <Num>{formatCompact(t.points)}</Num>, hint: <>در <Num>{formatNumber(t.heldDays, 0)}</Num> روز</>, tone: 'text-st-yt' },
          { label: 'با ایردراپ', value: <Num>{money(t.total)}</Num>, hint: c.valuePerMillion > 0 ? 'با ارزش فرضی' : 'ارزش پوینت = ۰', tone: tone(t.total) },
        ]}
      />
      <Verdict kind={kind}>{verdict}</Verdict>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-success/8 border border-success/25 px-3 py-2.5">
          <Metric label="لیمیت خرید — پوینت رایگان" tone="text-success" hint={limits.free !== null && Number.isFinite(limits.free) ? <Bound label="YT" op="≤" x={ytPriceFromAPY(limits.free, c.days)} digits={4} percent={false} /> : undefined}>
            <Bound label="Implied" op="≤" x={limits.free} />
          </Metric>
        </div>
        <div className="rounded-xl bg-warning/8 border border-warning/25 px-3 py-2.5">
          <Metric label={`لیمیت خرید — ضرر ≤ ${formatNumber(c.lossBudget, 0)}٪`} tone="text-warning" hint={limits.budget !== null && Number.isFinite(limits.budget) ? <Bound label="YT" op="≤" x={ytPriceFromAPY(limits.budget, c.days)} digits={4} percent={false} /> : undefined}>
            <Bound label="Implied" op="≤" x={limits.budget} />
          </Metric>
        </div>
        <div className="rounded-xl bg-brand2/8 border border-brand2/25 px-3 py-2.5">
          <Metric label={early ? `فروش بی‌ضرر روز ${formatNumber(t.heldDays, 0)}` : 'تا سررسید'} tone="text-brand2" hint={early ? 'نرخ بازار در روز فروش' : undefined}>
            {early ? <Bound label="Implied" op="≥" x={t.breakEvenExitAPY} /> : t.cash >= 0 ? 'بی‌ضرر' : 'زیان‌ده'}
          </Metric>
        </div>
      </div>
      <p className="text-xs text-muted">لیمیت‌ها فرض می‌کنند با همان نرخی که می‌خرید، می‌فروشید؛ یعنی لازم نیست بازار به نفع شما حرکت کند.</p>

      <Details
        rows={[
          ['قیمت YT در ورود', <Num key="p">{formatNumber(t.entryPrice, 5)}</Num>],
          ['تعداد YT', <Num key="u">{formatNumber(t.units, 2)}</Num>],
          ['اکسپوژر (دلار)', <><Num>{formatUSD(t.notional, 0)}</Num> · <Num>{formatNumber(t.leverage, 1)}×</Num></>],
          ['بازده دریافتی', <Num key="y">{formatUSD(t.yieldEarned, 0)}</Num>],
          ['قیمت YT در خروج', <Num key="e">{formatNumber(t.exitPrice, 5)}</Num>],
          ['ارزش فروش', <Num key="s">{formatUSD(t.saleValue, 0)}</Num>],
          ['هزینه‌ی هر ۱M پوینت', t.cash >= 0 ? 'رایگان' : Number.isFinite(costPerM) ? <Num key="c">{formatUSD(costPerM, 2)}</Num> : '—'],
        ]}
      />

      <Table
        title={early ? 'اگر نرخ بازار در روز فروش فرق کند' : 'اگر بازده پایه فرق کند'}
        head={[early ? 'نرخ روز فروش' : 'بازده پایه', 'نقدی', 'درصد', 'با ایردراپ']}
        highlight={2}
        rows={scen.map(({ v, r }) => [
          <Num key="v">{formatPercent(v, 2)}</Num>,
          <Num key="c" className={tone(r.cash)}>{money(r.cash)}</Num>,
          <Num key="p" className={tone(r.cash)}>{signedPct(r.cashPercent)}</Num>,
          <Num key="t" className={tone(r.total)}>{money(r.total)}</Num>,
        ])}
      />
    </>
  );
}

// ─── PT ────────────────────────────────────────────────────────────────────────

function PtResult({ c }: { c: CalcState }) {
  if (!(c.capital > 0 && c.days > 0 && c.entryAPY > 0)) return <Verdict kind="info">سرمایه، روز تا سررسید و نرخ ورود باید بیشتر از صفر باشند.</Verdict>;
  const input = { capital: c.capital, daysToMaturity: c.days, entryAPY: c.entryAPY, holdDays: c.holdDays, exitAPY: c.exitAPY, feePercent: c.fee };
  const t = simulatePt(input);
  const early = !t.toMaturity;
  const scen = OFFSETS.map((o) => {
    const exitAPY = Math.max(0, c.exitAPY + o);
    return { exitAPY, r: simulatePt({ ...input, exitAPY }) };
  });

  return (
    <>
      <Headline
        items={[
          { label: 'ارزش در خروج', value: <Num>{formatUSD(t.value, 0)}</Num>, hint: early ? <>روز <Num>{formatNumber(t.heldDays, 0)}</Num></> : 'سررسید' },
          { label: 'سود', value: <Num>{money(t.profit)}</Num>, hint: <Num>{signedPct(t.profitPercent, 2)}</Num>, tone: tone(t.profit) },
          { label: 'سالانه', value: <Num>{formatPercent(t.annualized, 2)}</Num>, tone: 'text-st-pt' },
        ]}
      />
      <Verdict kind={t.profit >= 0 ? 'good' : 'bad'}>
        {early ? (
          <>
            فروش زودتر از سررسید فقط وقتی بی‌ضرر است که نرخ بازار در روز فروش <Bound label="Implied" op="≤" x={t.breakEvenExitAPY} /> باشد. بالا رفتن نرخ
            قیمت PT را پایین می‌آورد.
          </>
        ) : (
          <>
            نگه‌داری تا سررسید: سود <Num>{formatUSD(t.profit, 0)}</Num> قطعی است (جز ریسک دارایی پایه) و نوسان نرخ بازار روی آن اثری ندارد.
          </>
        )}
      </Verdict>
      <Details
        rows={[
          ['قیمت PT در ورود', <Num key="p">{formatNumber(t.entryPrice, 5)}</Num>],
          ['ارزش اسمی در سررسید', <Num key="f">{formatUSD(t.faceValue, 0)}</Num>],
          ['قیمت PT در خروج', <Num key="e">{formatNumber(t.exitPrice, 5)}</Num>],
          ['قیمت PT برای لیمیت در این نرخ', <Num key="l">{formatNumber(ptPriceFromAPY(c.entryAPY, c.days), 5)}</Num>],
        ]}
      />
      {early && (
        <Table
          title="اگر نرخ بازار در روز فروش فرق کند"
          head={['نرخ روز فروش', 'سود', 'درصد', 'سالانه']}
          highlight={2}
          rows={scen.map(({ exitAPY, r }) => [
            <Num key="v">{formatPercent(exitAPY, 2)}</Num>,
            <Num key="c" className={tone(r.profit)}>{money(r.profit)}</Num>,
            <Num key="p" className={tone(r.profit)}>{signedPct(r.profitPercent, 2)}</Num>,
            <Num key="a">{formatPercent(r.annualized, 2)}</Num>,
          ])}
        />
      )}
    </>
  );
}

// ─── Loop ──────────────────────────────────────────────────────────────────────

function LoopResult({ c }: { c: CalcState }) {
  if (!(c.capital > 0 && c.days > 0 && c.entryAPY > 0 && c.leverage >= 1 && c.lltv > 0 && c.lltv < 100))
    return <Verdict kind="info">اهرم باید ≥ ۱ و LLTV بین ۰ و ۱۰۰ باشد.</Verdict>;
  const base = { capital: c.capital, daysToMaturity: c.days, entryAPY: c.entryAPY, borrowAPY: c.borrowAPY, lltv: c.lltv, feePercent: c.fee };
  const t = simulateLoop({ ...base, leverage: c.leverage });
  const minHealth = thresholds.opportunities.loopMinHealth;
  const safeMax = maxLoopLeverage(c.lltv, minHealth, c.fee);
  const beatsPt = t.netAPY > t.unleveredAPY;

  const levels = [...new Set([1, 2, 3, 4, 5, Math.floor(safeMax * 10) / 10].filter((x) => x >= 1 && x <= maxLoopLeverage(c.lltv, 1, c.fee)))].sort((a, b) => a - b);
  const current = levels.indexOf(c.leverage);

  let kind: 'good' | 'ok' | 'bad' = 'good';
  let text: ReactNode = (
    <>
      لوپ <Num>{formatNumber(c.leverage, 1)}×</Num> بازده را از <Num>{formatPercent(t.unleveredAPY, 2)}</Num> به <Num>{formatPercent(t.netAPY, 2)}</Num> می‌رساند.
      تا وقتی بهره‌ی وام زیر <Num>{formatPercent(t.breakEvenBorrowAPY, 2)}</Num> بماند سودده است.
    </>
  );
  if (t.healthFactor < 1) {
    kind = 'bad';
    text = <>این اهرم از LLTV بیشتر است و موقعیت همان لحظه لیکوئید می‌شود.</>;
  } else if (!beatsPt) {
    kind = 'bad';
    text = <>بهره‌ی وام از نرخ ثابت PT بیشتر است؛ لوپ از نگه‌داری ساده‌ی PT بدتر است.</>;
  } else if (t.healthFactor < minHealth) {
    kind = 'ok';
    text = <>سودده است اما Health Factor پایین است؛ اهرم را به ≤ <Num>{formatNumber(safeMax, 2)}×</Num> کم کنید.</>;
  }

  return (
    <>
      <Headline
        items={[
          { label: 'بازده خالص سالانه', value: <Num>{formatPercent(t.netAPY, 2)}</Num>, tone: beatsPt ? 'text-st-loop' : 'text-danger' },
          { label: 'سود تا سررسید', value: <Num>{money(t.profit)}</Num>, tone: tone(t.profit) },
          { label: 'Health Factor', value: <Num>{formatNumber(t.healthFactor, 2)}</Num>, tone: t.healthFactor < minHealth ? 'text-danger' : 'text-primary' },
        ]}
      />
      <Verdict kind={kind}>{text}</Verdict>
      <Details
        rows={[
          ['ارزش وثیقه‌ی PT', <Num key="c">{formatUSD(t.collateralValue, 0)}</Num>],
          ['بدهی', <Num key="d">{formatUSD(t.debt, 0)}</Num>],
          ['LTV فعلی / در سررسید', <><Num>{formatPercent(t.ltv, 1)}</Num> / <Num>{formatPercent(t.maturityLTV, 1)}</Num></>],
          ['لیکوئید اگر نرخ بازار برسد به', t.liquidationAPY === -Infinity ? 'همین حالا' : <Num key="l">{Number.isFinite(t.liquidationAPY) ? formatPercent(t.liquidationAPY, 2) : '—'}</Num>],
          ['قیمت PT لیکوئید', <Num key="p">{formatNumber(t.liquidationPTPrice, 4)}</Num>],
          ['سقف بهره‌ی وام (سربه‌سر)', Number.isFinite(t.breakEvenBorrowAPY) ? <Num key="b">{formatPercent(t.breakEvenBorrowAPY, 2)}</Num> : '—'],
          ['خالص دریافتی در سررسید', <Num key="o">{formatUSD(t.payout, 0)}</Num>],
        ]}
      />
      <Table
        title="مقایسه‌ی اهرم‌ها"
        head={['اهرم', 'بازده خالص', 'HF', 'لیکوئید در نرخ']}
        highlight={current >= 0 ? current : undefined}
        rows={levels.map((L) => {
          const r = simulateLoop({ ...base, leverage: L });
          return [
            <Num key="l">{formatNumber(L, 1)}×</Num>,
            <Num key="n" className={r.netAPY > r.unleveredAPY || L === 1 ? 'text-primary' : 'text-danger'}>{formatPercent(r.netAPY, 2)}</Num>,
            <Num key="h" className={r.healthFactor < minHealth ? 'text-danger' : ''}>{Number.isFinite(r.healthFactor) ? formatNumber(r.healthFactor, 2) : '∞'}</Num>,
            <Num key="q">{Number.isFinite(r.liquidationAPY) ? formatPercent(r.liquidationAPY, 1) : '—'}</Num>,
          ];
        })}
      />
      <p className="text-xs text-muted">
        لیکوئید با قیمت بازار PT حساب شده (محافظه‌کارانه)؛ بعضی مانی‌مارکت‌ها از اوراکل خطی استفاده می‌کنند که با جهش نرخ کمتر لیکوئید
        می‌شود. بهره‌ی وام متغیر است — ستون «سقف بهره‌ی وام» را زیر نظر بگیرید.
      </p>
    </>
  );
}
