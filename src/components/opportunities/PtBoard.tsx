'use client';

import { useMemo, useState } from 'react';
import { Calculator, TriangleAlert } from 'lucide-react';
import thresholds from '../../config/thresholds.json';
import { isStable, screenPt, type OpportunityListing, type PtOpportunity, type PtZone, type ScreenSettings } from '../../lib/risk/opportunities';
import { formatNumber, formatPercent, formatPP } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Bound, Empty, Legend, MarketHead, Metric, Pill, RangeBar, Segmented, signedPct } from './parts';

const ZONE: Record<PtZone, { label: string; tone: 'success' | 'muted' | 'danger' }> = {
  strong: { label: 'نرخ ثابت جذاب', tone: 'success' },
  fair: { label: 'نزدیک نرخ شناور', tone: 'muted' },
  weak: { label: 'زیر نرخ شناور', tone: 'danger' },
};

type Asset = 'all' | 'stable' | 'eth' | 'btc' | 'sol';
const ASSETS: { id: Asset; label: string }[] = [
  { id: 'all', label: 'همه' },
  { id: 'stable', label: 'استیبل' },
  { id: 'eth', label: 'ETH' },
  { id: 'btc', label: 'BTC' },
  { id: 'sol', label: 'SOL' },
];

const matches = (m: OpportunityListing, a: Asset) => {
  if (a === 'all') return true;
  if (a === 'stable') return isStable(m);
  const re = { eth: /eth/i, btc: /btc/i, sol: /sol/i }[a];
  return m.categories.includes(a) || re.test(m.name);
};

const PAGE = 20;
const MARGIN = thresholds.opportunities.ptMarginPP;

/** Fixed-rate PT: highest locked rates, compared with the floating rate, with a limit-buy level. */
export function PtBoard({ markets, s, onCalc }: { markets: OpportunityListing[]; s: ScreenSettings; onCalc: (m: OpportunityListing) => void }) {
  const [asset, setAsset] = useState<Asset>('stable');
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => screenPt(markets.filter((m) => matches(m, asset)), s), [markets, s, asset]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-default bg-surface/80 p-4 flex flex-col gap-3 text-sm">
        <p className="text-secondary">
          خرید PT یعنی قفل کردن نرخ بازار تا سررسید. وقتی نرخ ثابت دست‌کم <Num>{formatNumber(MARGIN, 1)}</Num> واحد درصد
          بالاتر از بازده شناور دارایی باشد، PT جذاب است. نرخ‌های خیلی بالا معمولاً یعنی ریسک پنهان (دی‌پگ، اعتباری یا قفل
          برداشت).
        </p>
        <Legend
          items={[
            { cls: 'bg-danger/60', label: 'زیر نرخ شناور' },
            { cls: 'bg-elevated border border-strong', label: 'منصفانه' },
            { cls: 'bg-success/70', label: 'ناحیه‌ی خرید' },
            { cls: 'bg-primary', label: 'نرخ فعلی' },
          ]}
        />
        <Segmented value={asset} onChange={(v) => { setAsset(v); setShown(PAGE); }} options={ASSETS} label="نوع دارایی" size="sm" />
      </div>

      {rows.length === 0 ? (
        <Empty>بازاری با این فیلتر پیدا نشد.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, shown).map((r) => (
            <li key={`${r.m.protocol}-${r.m.id}`}>
              <PtRow r={r} onCalc={() => onCalc(r.m)} />
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

function PtRow({ r, onCalc }: { r: PtOpportunity; onCalc: () => void }) {
  const { m } = r;
  const z = ZONE[r.zone];
  const base = m.baseAPY;
  const max = Math.max(m.impliedAPY, r.limitAPY, base ?? 0) * 1.3 || 10;

  return (
    <article className={`rounded-2xl border bg-surface/80 p-4 flex flex-col gap-3 ${r.zone === 'strong' && !r.highRate ? 'border-success/40' : 'border-default'}`}>
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
        <Metric label="نرخ ثابت" tone="text-st-pt" hint={<>PT <Num>{formatNumber(r.ptPrice, 4)}</Num></>}>
          <Num>{formatPercent(m.impliedAPY, 2)}</Num>
        </Metric>
        <Metric label="بازده شناور" hint={r.spread === null ? 'نامشخص' : <Num>{formatPP(r.spread, 1)}</Num>}>
          {base === null ? '—' : <Num>{formatPercent(base, 2)}</Num>}
        </Metric>
        <Metric label="سود تا سررسید" tone="text-success" hint="پس از کارمزد ورود">
          <Num>{signedPct(r.returnToMaturity, 2)}</Num>
        </Metric>
      </div>

      {base !== null && (
        <RangeBar
          label="ناحیه‌های نرخ برای خرید PT"
          max={max}
          marker={m.impliedAPY}
          segments={[
            { to: Math.max(0, base - MARGIN), cls: 'bg-danger/45' },
            { to: base + MARGIN, cls: 'bg-strong' },
            { to: max, cls: 'bg-success/60' },
          ]}
        />
      )}

      <div className="rounded-xl bg-st-pt/8 border border-st-pt/25 px-3 py-2 text-sm">
        <div className="text-xs text-st-pt font-bold">{m.impliedAPY >= r.limitAPY ? 'خرید با قیمت بازار' : 'لیمیت خرید پیشنهادی'}</div>
        <div className="text-primary">
          <Bound label="Implied" op="≥" x={r.limitAPY} className="font-bold" />
          <span className="text-secondary">
            {' · '}
            <Bound label="PT" op="≤" x={r.limitPrice} digits={4} percent={false} />
          </span>
        </div>
      </div>

      {r.highRate && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" /> نرخ بالای {formatNumber(thresholds.opportunities.ptHighRateWarn, 0)}٪ — قبل از خرید ریسک
          دارایی پایه، نقدشوندگی و شرایط برداشت را بررسی کنید.
        </p>
      )}
    </article>
  );
}
