'use client';

import { useMemo } from 'react';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import thresholds from '../../config/thresholds.json';
import type { ProtocolId } from '../../types/protocol';
import type { ProtocolFeed } from '../../hooks/useAllMarkets';
import { screenLoop, type LoopOpportunity, type LoopSettings, type OpportunityListing, type ScreenSettings } from '../../lib/risk/opportunities';
import { maxLoopLeverage } from '../../lib/calculators/trade';
import { formatNumber, formatPercent, formatRateCapped } from '../../lib/utils/formatting';
import { formatDate } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { CappedRate } from '../ui/financial';
import { AssetIdentity } from '../ui/asset-identity';
import { InlineHelp } from '../ui/inline-help';
import { Bound, CompactMeta, DataCell, Empty, LiquidityCell, MarketHead, MaturityCell, Metric, Pill, ProtocolCell } from './parts';
import { MarketTable } from './MarketTable';

const PENDLE_LOOPING = 'https://app.pendle.finance/trade/pt-looping';
const MIN_HEALTH = thresholds.opportunities.loopMinHealth;

const hf = (x: number) => (Number.isFinite(x) ? formatNumber(x, 2) : '∞');

/** PT looping: net APY at the chosen leverage and borrow rate — with health, debt and liquidation shown as prominently. */
export function LoopBoard({
  markets,
  s,
  l,
  setL,
  onCalc,
  feeds = {},
}: {
  markets: OpportunityListing[];
  s: ScreenSettings;
  l: LoopSettings;
  setL: (l: LoopSettings) => void;
  onCalc: (m: OpportunityListing) => void;
  feeds?: Partial<Record<ProtocolId, ProtocolFeed>>;
}) {
  const rows = useMemo(() => screenLoop(markets, s, l), [markets, s, l]);
  const maxLev = maxLoopLeverage(l.lltv, MIN_HEALTH, s.feePercent);

  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3 text-sm">
        <p className="text-secondary">
          لوپ PT: PT را وثیقه می‌گذارید، وام می‌گیرید و دوباره PT می‌خرید. اگر نرخ بازار بالا برود قیمت PT پایین می‌آید و ممکن است لیکوئید شوید. نرخ وام و LLTV در API بازار نیست؛
          این سه عدد <b className="text-primary">فرض دستی</b> شماست.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="اهرم" value={l.leverage} onChange={(v) => Number.isFinite(v) && setL({ ...l, leverage: v })} suffix="×" />
          <NumberField label="بهره‌ی وام (فرض)" value={l.borrowAPY} onChange={(v) => Number.isFinite(v) && setL({ ...l, borrowAPY: v })} suffix="%" />
          <NumberField label="LLTV (فرض)" value={l.lltv} onChange={(v) => Number.isFinite(v) && setL({ ...l, lltv: v })} suffix="%" help="آستانه‌ی لیکوئید بازار وام‌دهی (Liquidation LTV)." />
        </div>
        <p className={`text-sm ${l.leverage > maxLev ? 'text-danger' : 'text-secondary'}`}>
          بیشترین اهرم با <Bound label="HF" op="≥" x={MIN_HEALTH} percent={false} />: <Num className="text-primary">{formatNumber(maxLev, 2)}×</Num>
          {l.leverage > maxLev && ' — اهرم فعلی بیش از حد امن است.'}
        </p>
        <a href={PENDLE_LOOPING} target="_blank" rel="noreferrer" className="tap flex items-center gap-1.5 text-accent w-fit">
          <ExternalLink size={14} aria-hidden /> نرخ وام و LLTV واقعی هر بازار در صفحه‌ی PT Looping پندل
        </a>
      </section>

      {rows.length === 0 ? (
        <Empty>بازاری برای لوپ پیدا نشد.</Empty>
      ) : (
        <MarketTable<LoopOpportunity>
          caption="بازارهای لوپ PT"
          rows={rows}
          rowKey={(r) => `${r.m.protocol}:${r.m.id}`}
          identity={(r) => (
            <div className="flex flex-col gap-1 min-w-0">
              <AssetIdentity symbol={r.m.name} icon={r.m.icon} chain={r.m.chain} platform={r.m.platform} size={24} />
              <CompactMeta m={r.m} feed={feeds[r.m.protocol]} />
              <span>{r.listed ? <Pill tone="accent">در لیست لوپ پندل</Pill> : <Pill>کاندید — بررسی کنید</Pill>}</span>
            </div>
          )}
          actionLabel="محاسبه"
          onAction={(r) => onCalc(r.m)}
          columns={[
            { id: 'protocol', header: 'پروتکل', cell: (r) => <ProtocolCell m={r.m} />, className: 'hidden xl:table-cell' },
            { id: 'maturity', header: 'سررسید', cell: (r) => <MaturityCell m={r.m} />, sort: (r) => r.m.daysToMaturity },
            { id: 'rate', header: 'نرخ ثابت PT', sort: (r) => r.m.impliedAPY, cell: (r) => <Num>{formatPercent(r.m.impliedAPY, 2)}</Num> },
            {
              id: 'net',
              header: <>بازده خالص در <Num>{formatNumber(l.leverage, 1)}×</Num></>,
              sort: (r) => r.netAPY,
              cell: (r) => <Num className={r.netAPY > r.unleveredAPY ? 'text-success' : 'text-danger'}>{formatPercent(r.netAPY, 2)}</Num>,
            },
            {
              id: 'hf',
              header: 'سلامت (HF) / لیکوئید',
              help: <InlineHelp term="Health Factor">زیر ۱ یعنی لیکوئید. ستون دوم: نرخ بازاری که در آن لیکوئید می‌شوید.</InlineHelp>,
              sort: (r) => r.healthFactor,
              cell: (r) => (
                <span className="flex flex-col whitespace-nowrap">
                  <Num className={r.risky ? 'text-danger' : 'text-primary'}>{hf(r.healthFactor)}</Num>
                  <span className="text-xs text-secondary"><CappedRate x={r.liquidationAPY} /></span>
                </span>
              ),
            },
            { id: 'borrow', header: 'سقف بهره‌ی وام', sort: (r) => r.breakEvenBorrowAPY, cell: (r) => (Number.isFinite(r.breakEvenBorrowAPY) ? <Num>{formatPercent(r.breakEvenBorrowAPY, 2)}</Num> : '—') },
            { id: 'liq', header: 'نقدینگی', cell: (r) => <LiquidityCell m={r.m} />, sort: (r) => r.m.liquidity },
            { id: 'data', header: 'داده', cell: (r) => <DataCell m={r.m} feed={feeds[r.m.protocol]} />, className: 'hidden xl:table-cell' },
          ]}
          mobile={(r) => ({
            meta: (
              <>
                <ProtocolCell m={r.m} /> · سررسید {formatDate(r.m.maturity)} · <Num>{formatNumber(r.m.daysToMaturity, 0)}</Num> روز
              </>
            ),
            result: <Num className={`text-lg font-semibold ${r.netAPY > r.unleveredAPY ? 'text-success' : 'text-danger'}`}>{formatPercent(r.netAPY, 2)}</Num>,
            sub: (
              <>
                خالص در <Num>{formatNumber(l.leverage, 1)}×</Num> · HF <Num>{hf(r.healthFactor)}</Num>
              </>
            ),
            warning: r.risky ? 'Health Factor پایین — یک جهش کوچک نرخ می‌تواند لیکوئید کند.' : r.netAPY <= r.unleveredAPY ? 'با این بهره‌ی وام، لوپ از نگه‌داری ساده‌ی PT بدتر است.' : undefined,
          })}
          details={(r) => <LoopDetails r={r} />}
        />
      )}
    </div>
  );
}

function LoopDetails({ r }: { r: LoopOpportunity }) {
  const profitable = r.netAPY > r.unleveredAPY;
  return (
    <div className="flex flex-col gap-3">
      <MarketHead m={r.m} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="بدون اهرم">
          <Num>{formatPercent(r.unleveredAPY, 2)}</Num>
        </Metric>
        <Metric label="بازده خالص" tone={profitable ? 'text-success' : 'text-danger'}>
          <Num>{formatPercent(r.netAPY, 2)}</Num>
        </Metric>
        <Metric label="Health Factor" tone={r.risky ? 'text-danger' : 'text-primary'}>
          <Num>{hf(r.healthFactor)}</Num>
        </Metric>
        <Metric label="لیکوئید در نرخ"><CappedRate x={r.liquidationAPY} /></Metric>
      </div>
      {!profitable && <p className="text-xs text-danger">با این بهره‌ی وام، لوپ از نگه‌داری ساده‌ی PT بدتر است.</p>}
      {r.risky && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <ShieldAlert size={14} className="shrink-0 mt-0.5" aria-hidden /> Health Factor پایین — یک جهش کوچک نرخ بازار می‌تواند لیکوئید کند.
        </p>
      )}
    </div>
  );
}
