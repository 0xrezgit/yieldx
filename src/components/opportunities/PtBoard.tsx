'use client';

import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import thresholds from '../../config/thresholds.json';
import type { ProtocolId } from '../../types/protocol';
import type { ProtocolFeed } from '../../hooks/useAllMarkets';
import { screenPt, type OpportunityListing, type PtOpportunity, type PtZone, type ScreenSettings } from '../../lib/risk/opportunities';
import { formatNumber, formatPercent, formatPP } from '../../lib/utils/formatting';
import { formatDate } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { InlineHelp } from '../ui/inline-help';
import { Bound, CompactMeta, DataCell, Empty, Legend, LiquidityCell, MarketHead, MaturityCell, Metric, Pill, ProtocolCell, RangeBar, signedPct } from './parts';
import { MarketTable } from './MarketTable';

const ZONE: Record<PtZone, { label: string; tone: 'success' | 'muted' | 'danger' | 'warning' }> = {
  strong: { label: 'بالاتر از نرخ شناور', tone: 'success' },
  fair: { label: 'نزدیک نرخ شناور', tone: 'muted' },
  weak: { label: 'زیر نرخ شناور', tone: 'danger' },
  // No floating rate from the API → no comparison is claimed.
  unknown: { label: 'نرخ شناور نامعلوم', tone: 'warning' },
};

const MARGIN = thresholds.opportunities.ptMarginPP;

/** Fixed-rate PT: locked rates compared with the floating rate, with a suggested limit. */
export function PtBoard({ markets, s, onCalc, feeds = {} }: { markets: OpportunityListing[]; s: ScreenSettings; onCalc: (m: OpportunityListing) => void; feeds?: Partial<Record<ProtocolId, ProtocolFeed>> }) {
  const rows = useMemo(() => screenPt(markets, s), [markets, s]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm text-secondary">
        <p>
          افق: <b className="text-primary">نگه‌داری PT تا سررسید</b>. PT وقتی جذاب است که نرخ ثابت دست‌کم <Num>{formatNumber(MARGIN, 1)}</Num> واحد درصد بالاتر از بازده شناور
          باشد. نرخ بالا به‌تنهایی نشانه‌ی خوب بودن نیست؛ معمولاً ریسک پنهان (دی‌پگ، اعتباری یا قفل برداشت) را قیمت‌گذاری می‌کند.
        </p>
        <Legend
          items={[
            { cls: 'bg-danger/60', label: 'زیر نرخ شناور' },
            { cls: 'bg-strong', label: 'نزدیک' },
            { cls: 'bg-success/70', label: 'ناحیه‌ی خرید' },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <Empty>بازاری با این فیلتر پیدا نشد.</Empty>
      ) : (
        <MarketTable<PtOpportunity>
          caption="بازارهای PT با نرخ ثابت"
          rows={rows}
          rowKey={(r) => `${r.m.protocol}:${r.m.id}`}
          identity={(r) => (
            <div className="flex flex-col gap-1 min-w-0">
              <AssetIdentity symbol={r.m.name} icon={r.m.icon} chain={r.m.chain} platform={r.m.platform} size={24} />
              <CompactMeta m={r.m} feed={feeds[r.m.protocol]} />
            </div>
          )}
          actionLabel="محاسبه"
          onAction={(r) => onCalc(r.m)}
          columns={[
            { id: 'protocol', header: 'پروتکل', cell: (r) => <ProtocolCell m={r.m} />, className: 'hidden xl:table-cell' },
            { id: 'maturity', header: 'سررسید', cell: (r) => <MaturityCell m={r.m} />, sort: (r) => r.m.daysToMaturity },
            { id: 'rate', header: 'نرخ ثابت', sort: (r) => r.m.impliedAPY, cell: (r) => <Num className="text-primary">{formatPercent(r.m.impliedAPY, 2)}</Num> },
            {
              id: 'float',
              header: 'نرخ شناور / اختلاف',
              sort: (r) => r.spread,
              cell: (r) => (
                <span className="flex flex-col items-start gap-1 whitespace-nowrap">
                  <Num>{formatPercent(r.m.baseAPY ?? NaN, 2)}</Num>
                  {r.spread !== null && (
                    <span className="text-xs text-secondary">
                      <Num>{formatPP(r.spread, 1)}</Num>
                    </span>
                  )}
                  <Pill tone={ZONE[r.zone].tone}>{ZONE[r.zone].label}</Pill>
                </span>
              ),
            },
            { id: 'result', header: 'سود تا سررسید', sort: (r) => r.returnToMaturity, cell: (r) => <Num className="text-success">{signedPct(r.returnToMaturity, 2)}</Num> },
            {
              id: 'limit',
              header: 'لیمیت خرید پیشنهادی',
              help: <InlineHelp term="لیمیت خرید PT">بیشترینِ نرخ فعلی و «بازده شناور + حاشیه». خرید با نرخ Implied بالاتر یا مساوی (قیمت PT کمتر یا مساوی).</InlineHelp>,
              sort: (r) => r.limitAPY,
              cell: (r) => <Bound label="Implied" op="≥" x={r.limitAPY} className="whitespace-nowrap" />,
            },
            { id: 'liq', header: 'نقدینگی', cell: (r) => <LiquidityCell m={r.m} />, sort: (r) => r.m.liquidity },
            { id: 'data', header: 'داده', cell: (r) => <DataCell m={r.m} feed={feeds[r.m.protocol]} />, className: 'hidden xl:table-cell' },
          ]}
          mobile={(r) => ({
            meta: (
              <>
                <ProtocolCell m={r.m} /> · سررسید {formatDate(r.m.maturity)} · <Num>{formatNumber(r.m.daysToMaturity, 0)}</Num> روز
              </>
            ),
            result: <Num className="text-lg font-semibold text-primary">{formatPercent(r.m.impliedAPY, 2)}</Num>,
            sub: (
              <>
                نرخ ثابت · سود تا سررسید <Num>{signedPct(r.returnToMaturity, 2)}</Num>
              </>
            ),
            warning: r.highRate ? `نرخ بالای ${formatNumber(thresholds.opportunities.ptHighRateWarn, 0)}٪ — ریسک دارایی پایه را بررسی کنید.` : r.zone === 'unknown' ? 'بازده شناور در API نیست؛ مقایسه با نرخ شناور ممکن نیست.' : undefined,
          })}
          details={(r) => <PtDetails r={r} />}
        />
      )}
    </div>
  );
}

function PtDetails({ r }: { r: PtOpportunity }) {
  const { m } = r;
  const base = m.baseAPY;
  const max = Math.max(m.impliedAPY, r.limitAPY, base ?? 0) * 1.3 || 10;
  return (
    <div className="flex flex-col gap-4">
      <MarketHead m={m} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Metric label="قیمت PT" hint="بر حسب دارایی پایه">
          <Num>{formatNumber(r.ptPrice, 4)}</Num>
        </Metric>
        <Metric label="بازده شناور" hint={r.spread === null ? 'در API نیست' : <Num>{formatPP(r.spread, 1)}</Num>}>
          {base === null ? '—' : <Num>{formatPercent(base, 2)}</Num>}
        </Metric>
        <Metric label="سود تا سررسید" hint="پس از کارمزد ورود">
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
      <div className="rounded-lg bg-st-pt/8 border border-st-pt/30 px-3 py-2 text-sm">
        <div className="text-xs text-st-pt font-semibold">{m.impliedAPY >= r.limitAPY ? 'خرید با قیمت بازار' : 'لیمیت خرید پیشنهادی'}</div>
        <Bound label="Implied" op="≥" x={r.limitAPY} className="font-semibold" />
        <span className="text-secondary">
          {' · '}
          <Bound label="PT" op="≤" x={r.limitPrice} digits={4} percent={false} />
        </span>
      </div>
      {r.highRate && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden /> نرخ بالای {formatNumber(thresholds.opportunities.ptHighRateWarn, 0)}٪ — قبل از خرید ریسک دارایی پایه، نقدشوندگی و شرایط برداشت را بررسی کنید.
        </p>
      )}
    </div>
  );
}
