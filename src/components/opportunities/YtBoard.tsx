'use client';

import { useMemo, useState } from 'react';
import { Calculator, Gift, TriangleAlert } from 'lucide-react';
import { screenYt, type OpportunityListing, type ScreenSettings, type YtOpportunity, type YtZone } from '../../lib/risk/opportunities';
import { ytPriceFromAPY } from '../../lib/calculators/trade';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Bound, Empty, Legend, MarketHead, Metric, Pill, RangeBar, signedPct } from './parts';

const ZONE: Record<YtZone, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  free: { label: 'پوینت رایگان', tone: 'success' },
  budget: { label: 'ضرر در سقف', tone: 'warning' },
  expensive: { label: 'گران', tone: 'danger' },
};

const PAGE = 20;

/** YT for points: which markets give points cheapest now, and at what implied APY to place a limit buy. */
export function YtBoard({
  markets,
  s,
  onCalc,
}: {
  markets: OpportunityListing[];
  s: ScreenSettings;
  onCalc: (m: OpportunityListing) => void;
}) {
  const [pointsOnly, setPointsOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => screenYt(markets, s, pointsOnly), [markets, s, pointsOnly]);
  const free = rows.filter((r) => r.zone === 'free').length;
  const strategy =
    s.ytMode === 'maturity'
      ? 'نگه‌داری تا سررسید'
      : `خرید، نگه‌داری ${formatNumber(s.holdDays, 0)} روز و فروش با همان نرخ`;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-default bg-surface/80 p-4 flex flex-col gap-3 text-sm">
        <p className="text-secondary">
          استراتژی: <b className="text-primary">{strategy}</b>. برای هر بازار سه ناحیه‌ی نرخ ورود حساب شده؛ وقتی نرخ بازار
          (Implied) پایین‌تر از حد سبز باشد، بازده‌ی YT هزینه را برمی‌گرداند و پوینت عملاً رایگان است.
        </p>
        <Legend
          items={[
            { cls: 'bg-success', label: 'پوینت رایگان (بدون ضرر نقدی)' },
            { cls: 'bg-warning', label: `ضرر تا ${formatNumber(s.lossBudget, 0)}٪ سرمایه` },
            { cls: 'bg-danger', label: 'گران — منتظر لیمیت بمانید' },
            { cls: 'bg-primary', label: 'نرخ فعلی' },
          ]}
        />
        <label className="flex items-center gap-2 text-secondary">
          <input type="checkbox" checked={pointsOnly} onChange={(e) => setPointsOnly(e.target.checked)} className="accent-accent size-4" />
          فقط بازارهای پوینت‌دار
        </label>
      </div>

      {rows.length > 0 && (
        <p className="text-sm text-secondary">
          <Num>{formatNumber(rows.length, 0)}</Num> بازار بررسی شد ·{' '}
          <span className={free ? 'text-success' : 'text-muted'}>
            <Num>{formatNumber(free, 0)}</Num> بازار همین حالا پوینت رایگان می‌دهد
          </span>
        </p>
      )}

      {rows.length === 0 ? (
        <Empty>بازاری با این شرایط پیدا نشد. حداقل نقدینگی یا روز تا سررسید را کم کنید.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, shown).map((r) => (
            <li key={`${r.m.protocol}-${r.m.id}`}>
              <YtRow r={r} s={s} onCalc={() => onCalc(r.m)} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="self-center rounded-xl border border-strong px-4 py-2 text-sm text-secondary hover:text-primary">
          نمایش بیشتر
        </button>
      )}
    </div>
  );
}

function YtRow({ r, s, onCalc }: { r: YtOpportunity; s: ScreenSettings; onCalc: () => void }) {
  const { m } = r;
  const z = ZONE[r.zone];
  const finiteLimits = [r.freeLimit, r.budgetLimit].filter((x): x is number => x !== null && Number.isFinite(x));
  const max = Math.max(m.impliedAPY, ...finiteLimits, m.baseAPY ?? 0) * 1.25 || 10;
  const free = r.freeLimit === null ? 0 : Math.min(r.freeLimit, max);
  const budget = r.budgetLimit === null ? 0 : Math.min(r.budgetLimit, max);

  return (
    <article className={`rounded-2xl border bg-surface/80 p-4 flex flex-col gap-3 ${r.zone === 'free' ? 'border-success/40' : 'border-default'}`}>
      <div className="flex items-start justify-between gap-3">
        <MarketHead m={m} />
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Pill tone={z.tone}>{z.label}</Pill>
          <button type="button" onClick={onCalc} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-secondary hover:text-primary hover:bg-elevated">
            <Calculator size={13} /> محاسبه
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="نرخ بازار (Implied)" hint={<>YT <Num>{formatNumber(r.ytPrice, 4)}</Num></>}>
          <Num>{formatPercent(m.impliedAPY, 2)}</Num>
        </Metric>
        <Metric label="بازده پایه" tone={m.baseAPY! >= m.impliedAPY ? 'text-success' : 'text-warning'} hint={<>اهرم <Num>{formatNumber(r.leverage, 1)}×</Num></>}>
          <Num>{formatPercent(m.baseAPY!, 2)}</Num>
        </Metric>
        <Metric
          label={s.ytMode === 'maturity' ? 'نتیجه تا سررسید' : `نتیجه بعد از ${formatNumber(r.holdDays, 0)} روز`}
          tone={r.cashPercent >= 0 ? 'text-success' : r.zone === 'budget' ? 'text-warning' : 'text-danger'}
          hint="بدون ایردراپ"
        >
          <Num>{signedPct(r.cashPercent)}</Num>
        </Metric>
      </div>

      <RangeBar
        label="نواحی نرخ ورود YT"
        max={max}
        marker={m.impliedAPY}
        segments={[
          { to: free, cls: 'bg-success/70' },
          { to: budget, cls: 'bg-warning/60' },
          { to: max, cls: 'bg-danger/45' },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-success/8 border border-success/25 px-3 py-2">
          <div className="text-xs text-success font-bold">لیمیت خرید برای پوینت رایگان</div>
          <div className="text-primary">
            <Bound label="Implied" op="≤" x={r.freeLimit} className="font-bold" />
            {r.freeLimit !== null && Number.isFinite(r.freeLimit) && (
              <span className="text-secondary">
                {' · '}
                <Bound label="YT" op="≤" x={ytPriceFromAPY(r.freeLimit, m.daysToMaturity)} digits={4} percent={false} />
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-warning/8 border border-warning/25 px-3 py-2">
          <div className="text-xs text-warning font-bold">حداکثر نرخ با ضرر ≤ {formatNumber(s.lossBudget, 0)}٪</div>
          <div className="text-primary">
            <Bound label="Implied" op="≤" x={r.budgetLimit} className="font-bold" />
            {r.budgetLimit !== null && Number.isFinite(r.budgetLimit) && (
              <span className="text-secondary">
                {' · '}
                <Bound label="YT" op="≤" x={ytPriceFromAPY(r.budgetLimit, m.daysToMaturity)} digits={4} percent={false} />
              </span>
            )}
          </div>
        </div>
      </div>

      {m.baseAPY! - m.impliedAPY > 5 && m.baseAPY! > 2 * m.impliedAPY && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" /> بازده پایه خیلی بالاتر از نرخ بازار است؛ معمولاً یعنی بازده فعلی موقت است
          (مشوق یا جهش کوتاه). محاسبه با فرض ماندن همین بازده است.
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <span className="flex items-center gap-1">
          <Gift size={12} className="text-st-yt" />
          هزینه‌ی هر ۱۰۰۰ دلار اکسپوژر در روز:{' '}
          <span className={r.costPerKDay <= 0 ? 'text-success' : 'text-primary'}>
            {r.costPerKDay <= 0 && 'سود '}
            <Num>{formatUSD(Math.abs(r.costPerKDay), 3)}</Num>
          </span>
        </span>
        {r.exitBreakEvenAPY !== null && (
          <span>
            فروش بی‌ضرر روز <Num>{formatNumber(r.holdDays, 0)}</Num>: <Bound label="Implied" op="≥" x={r.exitBreakEvenAPY} className="text-primary" />
          </span>
        )}
      </div>
    </article>
  );
}
