'use client';

import { useMemo, useState } from 'react';
import { Calculator, ExternalLink, ShieldAlert } from 'lucide-react';
import thresholds from '../../config/thresholds.json';
import { screenLoop, type LoopOpportunity, type LoopSettings, type OpportunityListing, type ScreenSettings } from '../../lib/risk/opportunities';
import { maxLoopLeverage } from '../../lib/calculators/trade';
import { formatNumber, formatPercent } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Bound, Empty, MarketHead, Metric, Pill } from './parts';

const PENDLE_LOOPING = 'https://app.pendle.finance/trade/pt-looping';
const MIN_HEALTH = thresholds.opportunities.loopMinHealth;

/** PT looping: net APY at the chosen leverage and borrow rate, with liquidation distance. */
export function LoopBoard({
  markets,
  s,
  l,
  setL,
  onCalc,
}: {
  markets: OpportunityListing[];
  s: ScreenSettings;
  l: LoopSettings;
  setL: (l: LoopSettings) => void;
  onCalc: (m: OpportunityListing) => void;
}) {
  const [shown, setShown] = useState(20);
  const rows = useMemo(() => screenLoop(markets, s, l), [markets, s, l]);
  const maxLev = maxLoopLeverage(l.lltv, MIN_HEALTH, s.feePercent);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-default bg-surface/80 p-4 flex flex-col gap-3 text-sm">
        <p className="text-secondary">
          لوپ PT: PT را وثیقه می‌گذارید، استیبل وام می‌گیرید و دوباره PT می‌خرید. سود = نرخ ثابت × اهرم − بهره‌ی وام × (اهرم −
          ۱). اگر نرخ بازار بالا برود قیمت PT پایین می‌آید و ممکن است لیکوئید شوید.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="اهرم" value={l.leverage} onChange={(v) => setL({ ...l, leverage: v })} suffix="×" />
          <NumberField label="بهره‌ی وام" value={l.borrowAPY} onChange={(v) => setL({ ...l, borrowAPY: v })} suffix="%" />
          <NumberField label="LLTV" value={l.lltv} onChange={(v) => setL({ ...l, lltv: v })} suffix="%" />
        </div>
        <p className={`text-xs ${l.leverage > maxLev ? 'text-danger' : 'text-muted'}`}>
          بیشترین اهرم با <Bound label="HF" op="≥" x={MIN_HEALTH} percent={false} />: <Num className="text-primary">{formatNumber(maxLev, 2)}×</Num>
          {l.leverage > maxLev && ' — اهرم فعلی بیش از حد امن است.'}
        </p>
        <a href={PENDLE_LOOPING} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-accent text-sm w-fit">
          <ExternalLink size={14} /> بهره‌ی وام و LLTV واقعی هر بازار را در صفحه‌ی PT Looping پندل ببینید
        </a>
      </div>

      {rows.length === 0 ? (
        <Empty>بازاری برای لوپ پیدا نشد.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, shown).map((r) => (
            <li key={`${r.m.protocol}-${r.m.id}`}>
              <LoopRow r={r} l={l} onCalc={() => onCalc(r.m)} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 20)} className="self-center rounded-xl border border-strong px-4 py-2 text-sm text-secondary hover:text-primary">
          نمایش بیشتر
        </button>
      )}
    </div>
  );
}

function LoopRow({ r, l, onCalc }: { r: LoopOpportunity; l: LoopSettings; onCalc: () => void }) {
  const { m } = r;
  const profitable = r.netAPY > r.unleveredAPY;

  return (
    <article className={`rounded-2xl border bg-surface/80 p-4 flex flex-col gap-3 ${profitable && !r.risky ? 'border-st-loop/40' : 'border-default'}`}>
      <div className="flex items-start justify-between gap-3">
        <MarketHead m={m} />
        <div className="flex flex-col items-end gap-1 shrink-0">
          {r.listed ? <Pill tone="accent">در لیست لوپ پندل</Pill> : <Pill>کاندید — بررسی کنید</Pill>}
          <button type="button" onClick={onCalc} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-secondary hover:text-primary hover:bg-elevated">
            <Calculator size={13} /> محاسبه
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="نرخ ثابت PT" hint={<>بدون اهرم <Num>{formatPercent(r.unleveredAPY, 2)}</Num></>}>
          <Num>{formatPercent(m.impliedAPY, 2)}</Num>
        </Metric>
        <Metric label={`بازده خالص در ${formatNumber(l.leverage, 1)}×`} tone={profitable ? 'text-st-loop' : 'text-danger'}>
          <Num>{formatPercent(r.netAPY, 2)}</Num>
        </Metric>
        <Metric label="سقف بهره‌ی وام" hint="بالاتر از این زیان">
          {Number.isFinite(r.breakEvenBorrowAPY) ? <Num>{formatPercent(r.breakEvenBorrowAPY, 2)}</Num> : '—'}
        </Metric>
        <Metric
          label="لیکوئید در نرخ"
          tone={r.risky ? 'text-danger' : 'text-primary'}
          hint={
            <>
              HF <Num>{formatNumber(r.healthFactor, 2)}</Num>
            </>
          }
        >
          {r.liquidationAPY === -Infinity ? 'همین حالا' : Number.isFinite(r.liquidationAPY) ? <Num>{formatPercent(r.liquidationAPY, 1)}</Num> : '—'}
        </Metric>
      </div>

      {!profitable && <p className="text-xs text-danger">با این بهره‌ی وام، لوپ از نگه‌داری ساده‌ی PT بدتر است.</p>}
      {r.risky && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <ShieldAlert size={14} className="shrink-0 mt-0.5" /> Health Factor پایین — یک جهش کوچک نرخ بازار می‌تواند لیکوئید کند.
        </p>
      )}
    </article>
  );
}
