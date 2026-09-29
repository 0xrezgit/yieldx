'use client';

import { useMemo } from 'react';
import { Gift, TriangleAlert } from 'lucide-react';
import type { ProtocolId } from '../../types/protocol';
import type { ProtocolFeed } from '../../hooks/useAllMarkets';
import { screenYt, type OpportunityListing, type ScreenSettings, type YtOpportunity, type YtZone } from '../../lib/risk/opportunities';
import { ytPriceFromAPY } from '../../lib/calculators/trade';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { formatDate } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { InlineHelp } from '../ui/inline-help';
import { Bound, CompactMeta, DataCell, Empty, Legend, LiquidityCell, MarketHead, MaturityCell, Metric, Pill, ProtocolCell, RangeBar, signedPct } from './parts';
import { MarketTable } from './MarketTable';

const ZONE: Record<YtZone, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  free: { label: 'پوینت رایگان', tone: 'success' },
  budget: { label: 'ضرر در سقف', tone: 'warning' },
  expensive: { label: 'گران', tone: 'danger' },
};

/** Base APY far above the implied rate usually means a temporary boost. */
const temporaryBase = (m: OpportunityListing) => m.baseAPY !== null && m.baseAPY - m.impliedAPY > 5 && m.baseAPY > 2 * m.impliedAPY;

function Identity({ m, feed }: { m: OpportunityListing; feed?: ProtocolFeed }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} platform={m.platform} size={24} />
      <CompactMeta m={m} feed={feed} />
      {m.hasPoints && (
        <span className="flex flex-wrap gap-1">
          <Pill tone="info">
            <Gift size={12} aria-hidden /> <bdi dir="ltr">{m.points?.name ?? 'پوینت'}</bdi>
            {m.points && m.points.ytMultiplier !== 1 && <Num>×{formatNumber(m.points.ytMultiplier, 1)}</Num>}
            {m.points?.season != null && (
              <>
                {' '}
                · فصل <Num>{formatNumber(m.points.season, 0)}</Num>
              </>
            )}
          </Pill>
        </span>
      )}
    </div>
  );
}

/** YT for points: which markets give points cheapest now, and at what implied APY to place a limit buy. */
export function YtBoard({
  markets,
  s,
  onCalc,
  feeds = {},
  pointsOnly = true,
}: {
  markets: OpportunityListing[];
  s: ScreenSettings;
  onCalc: (m: OpportunityListing) => void;
  feeds?: Partial<Record<ProtocolId, ProtocolFeed>>;
  pointsOnly?: boolean;
}) {
  const rows = useMemo(() => screenYt(markets, s, pointsOnly), [markets, s, pointsOnly]);
  const free = rows.filter((r) => r.zone === 'free').length;
  const horizon = s.ytMode === 'maturity' ? 'تا سررسید' : `${formatNumber(s.holdDays, 0)} روز`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm text-secondary">
        <p>
          افق: <b className="text-primary">{s.ytMode === 'maturity' ? 'نگه‌داری تا سررسید' : `خرید، نگه‌داری ${formatNumber(s.holdDays, 0)} روز و فروش با همان نرخ`}</b>. «نتیجه‌ی نقدی» بدون ارزش پوینت یا ایردراپ است؛ وقتی
          نرخ بازار زیر «لیمیت پوینت رایگان» باشد، بازده YT هزینه را برمی‌گرداند.
        </p>
        <Legend
          items={[
            { cls: 'bg-success', label: 'پوینت رایگان (بدون ضرر نقدی)' },
            { cls: 'bg-warning', label: `ضرر تا ${formatNumber(s.lossBudget, 0)}٪ سرمایه` },
            { cls: 'bg-danger', label: 'گران' },
          ]}
        />
        {rows.length > 0 && (
          <p>
            <Num>{formatNumber(rows.length, 0)}</Num> بازار بررسی شد ·{' '}
            <span className={free ? 'text-success' : 'text-muted'}>
              <Num>{formatNumber(free, 0)}</Num> بازار همین حالا پوینت رایگان می‌دهد
            </span>
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty>بازاری با این شرایط پیدا نشد. فیلترها، حداقل نقدینگی یا روز تا سررسید را کم کنید.</Empty>
      ) : (
        <MarketTable<YtOpportunity>
          caption="بازارهای YT برای جمع کردن پوینت"
          rows={rows}
          rowKey={(r) => `${r.m.protocol}:${r.m.id}`}
          identity={(r) => <Identity m={r.m} feed={feeds[r.m.protocol]} />}
          actionLabel="محاسبه"
          onAction={(r) => onCalc(r.m)}
          columns={[
            { id: 'protocol', header: 'پروتکل', cell: (r) => <ProtocolCell m={r.m} />, className: 'hidden xl:table-cell' },
            { id: 'maturity', header: 'سررسید', cell: (r) => <MaturityCell m={r.m} />, sort: (r) => r.m.daysToMaturity },
            {
              id: 'rate',
              header: 'نرخ بازار / پایه',
              sort: (r) => r.m.impliedAPY,
              cell: (r) => (
                <span className="flex flex-col whitespace-nowrap">
                  <Num className="text-primary">{formatPercent(r.m.impliedAPY, 2)}</Num>
                  <span className="text-xs text-secondary">
                    پایه <Num>{formatPercent(r.m.baseAPY ?? NaN, 2)}</Num>
                  </span>
                </span>
              ),
            },
            {
              id: 'result',
              header: <>نتیجه‌ی نقدی · {horizon}</>,
              sort: (r) => r.cashPercent,
              cell: (r) => (
                <span className="flex flex-col items-start gap-1 whitespace-nowrap">
                  <Num className={r.cashPercent >= 0 ? 'text-success' : r.zone === 'budget' ? 'text-warning' : 'text-danger'}>{signedPct(r.cashPercent)}</Num>
                  <Pill tone={ZONE[r.zone].tone}>{ZONE[r.zone].label}</Pill>
                </span>
              ),
            },
            {
              id: 'limit',
              header: 'لیمیت پوینت رایگان',
              help: <InlineHelp term="لیمیت پوینت رایگان">بالاترین نرخ Implied که اگر YT را در آن بخرید و با همان نرخ بفروشید، ضرر نقدی ندارید.</InlineHelp>,
              sort: (r) => r.freeLimit,
              cell: (r) => <Bound label="Implied" op="≤" x={r.freeLimit} className="whitespace-nowrap" />,
            },
            { id: 'liq', header: 'نقدینگی', cell: (r) => <LiquidityCell m={r.m} />, sort: (r) => r.m.liquidity },
            { id: 'data', header: 'داده', cell: (r) => <DataCell m={r.m} feed={feeds[r.m.protocol]} needsBase />, className: 'hidden xl:table-cell' },
          ]}
          mobile={(r) => ({
            meta: (
              <>
                <ProtocolCell m={r.m} /> · سررسید {formatDate(r.m.maturity)} · <Num>{formatNumber(r.m.daysToMaturity, 0)}</Num> روز
              </>
            ),
            result: <Num className={`text-lg font-semibold ${r.cashPercent >= 0 ? 'text-success' : r.zone === 'budget' ? 'text-warning' : 'text-danger'}`}>{signedPct(r.cashPercent)}</Num>,
            sub: <>{ZONE[r.zone].label} · نقدی، {horizon}</>,
            warning: temporaryBase(r.m) ? 'بازده پایه احتمالاً موقت است (خیلی بالاتر از نرخ بازار).' : undefined,
          })}
          details={(r) => <YtDetails r={r} s={s} />}
        />
      )}
    </div>
  );
}

function YtDetails({ r, s }: { r: YtOpportunity; s: ScreenSettings }) {
  const { m } = r;
  const finiteLimits = [r.freeLimit, r.budgetLimit].filter((x): x is number => x !== null && Number.isFinite(x));
  const max = Math.max(m.impliedAPY, ...finiteLimits, m.baseAPY ?? 0) * 1.25 || 10;
  const free = r.freeLimit === null ? 0 : Math.min(r.freeLimit, max);
  const budget = r.budgetLimit === null ? 0 : Math.min(r.budgetLimit, max);
  return (
    <div className="flex flex-col gap-4">
      <MarketHead m={m} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="قیمت YT" hint="بر حسب دارایی پایه">
          <Num>{formatNumber(r.ytPrice, 4)}</Num>
        </Metric>
        <Metric label="اهرم بازده">
          <Num>{formatNumber(r.leverage, 1)}×</Num>
        </Metric>
        <Metric label="هزینه‌ی هر ۱۰۰۰ دلار اکسپوژر در روز" tone={r.costPerKDay <= 0 ? 'text-success' : 'text-primary'}>
          {r.costPerKDay <= 0 && 'سود '}
          <Num>{formatUSD(Math.abs(r.costPerKDay), 3)}</Num>
        </Metric>
        {r.exitBreakEvenAPY !== null && (
          <Metric label={`فروش بی‌ضرر روز ${formatNumber(r.holdDays, 0)}`}>
            <Bound label="Implied" op="≥" x={r.exitBreakEvenAPY} />
          </Metric>
        )}
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
        <div className="rounded-lg bg-success/8 border border-success/30 px-3 py-2">
          <div className="text-xs text-success font-semibold">لیمیت خرید برای پوینت رایگان</div>
          <Bound label="Implied" op="≤" x={r.freeLimit} className="font-semibold" />
          {r.freeLimit !== null && Number.isFinite(r.freeLimit) && (
            <span className="text-secondary">
              {' · '}
              <Bound label="YT" op="≤" x={ytPriceFromAPY(r.freeLimit, m.daysToMaturity)} digits={4} percent={false} />
            </span>
          )}
        </div>
        <div className="rounded-lg bg-warning/8 border border-warning/30 px-3 py-2">
          <div className="text-xs text-warning font-semibold">حداکثر نرخ با ضرر ≤ {formatNumber(s.lossBudget, 0)}٪</div>
          <Bound label="Implied" op="≤" x={r.budgetLimit} className="font-semibold" />
          {r.budgetLimit !== null && Number.isFinite(r.budgetLimit) && (
            <span className="text-secondary">
              {' · '}
              <Bound label="YT" op="≤" x={ytPriceFromAPY(r.budgetLimit, m.daysToMaturity)} digits={4} percent={false} />
            </span>
          )}
        </div>
      </div>
      {temporaryBase(m) && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden /> بازده پایه خیلی بالاتر از نرخ بازار است؛ معمولاً یعنی بازده فعلی موقت است (مشوق یا جهش کوتاه). محاسبه با فرض ماندن همین بازده است.
        </p>
      )}
    </div>
  );
}
