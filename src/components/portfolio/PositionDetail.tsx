'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, ArrowRight, ExternalLink, Gift, History, Loader2, Plus, RefreshCw, Scale, Settings2, ShieldAlert, Target, Trash2 } from 'lucide-react';
import type { Position, PositionEventType } from '../../types/position';
import { usePortfolioView, type PositionView } from '../../hooks/usePortfolioView';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { compareMarkets, defaultSwitchSettings, fmtDays, type SwitchSettings } from '../../lib/portfolio/analysis';
import { chainFa, EVENT_FA, FEE_FA, KIND_LABEL, QUALITY_FA, RATE_FA } from '../../lib/portfolio/labels';
import { EPS } from '../../lib/portfolio/ledger';
import { formatDollar, priceDigits } from '../../lib/portfolio/format';
import { formatDateTime, formatNumber, formatPercent } from '../../lib/utils/formatting';
import protocols from '../../config/protocols.json';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { EventForm } from './EventForm';
import { AirdropCard } from './AirdropCard';
import { TokenBadge } from './TokenSelect';
import { AlertList, btn, Chip, Disclosure, MarketIdentity, NoWalletNote, Panel, Pnl, QualityBadge, SnapshotChart, Stat, StatGrid, StatusBadge, SxPage, Usd, usd } from './parts';

const EVENT_TYPES: Record<Position['kind'], PositionEventType[]> = {
  pt: ['buy', 'sell', 'redeem', 'claim_reward'],
  yt: ['buy', 'sell', 'claim_yield', 'claim_reward'],
  loop: ['buy', 'sell', 'redeem', 'borrow', 'repay', 'claim_reward'],
};

const ageText = (ms: number | null) => {
  if (ms === null) return 'داده‌ای دریافت نشده';
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'همین حالا' : m < 60 ? `${formatNumber(m, 0)} دقیقه پیش` : `${formatNumber(Math.round(m / 60), 0)} ساعت پیش`;
};

const LEAN = {
  hold: { text: 'نگهداری بهتر از خروج است.', cls: 'border-sx-green bg-sx-green/8' },
  exit: { text: 'خروج بهتر از ادامه است.', cls: 'border-sx-orange bg-sx-orange/8' },
  neutral: { text: 'تفاوت معناداری بین نگهداری و خروج دیده نمی‌شود.', cls: 'border-sx-border bg-sx-raised/50' },
  unknown: { text: 'داده‌ی کافی برای مقایسه‌ی نگهداری و خروج نیست.', cls: 'border-sx-border bg-sx-raised/50' },
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-sx-faint">{title}</h3>
      {children}
    </div>
  );
}

/** The five questions every position page must answer. */
export function Answers({ x }: { x: PositionView }) {
  const { p, v, a } = x;
  const L = v.ledger;
  const Row = ({ q, children }: { q: string; children: ReactNode }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-1 sm:gap-6 py-4 border-t border-sx-border first:border-t-0 first:pt-0">
      <dt className="text-sm text-sx-muted">{q}</dt>
      <dd className="text-[15px] text-sx-text leading-7 flex flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
  return (
    <Panel title="جمع‌بندی">
      <dl className="flex flex-col">
        <Row q="چه خریده‌ام؟">
          <Num>{formatNumber(L.units, 4)}</Num>
          <span dir="ltr">
            {KIND_LABEL[p.kind === 'loop' ? 'pt' : p.kind]} {p.marketName}
          </span>
          روی {chainFa(p.chain)} در <span dir="ltr">{protocols[p.protocol].name}</span>
          {p.loop && (
            <>
              با بدهی {usd(v.debtUsd.value)} <TokenBadge symbol={p.loop.debtAsset} size={16} /> در <span dir="ltr">{p.loop.lendingPlatform || '—'}</span>
            </>
          )}
        </Row>
        <Row q="چقدر هزینه کرده‌ام؟">
          سرمایه‌ی شخصی {usd(v.investedUsd)}
          <span className="text-sx-faint">·</span> کارمزدها {usd(L.fees.total)}
          {L.interestPaidUsd > 0 && (
            <>
              <span className="text-sx-faint">·</span> بهره‌ی پرداختی {usd(L.interestPaidUsd)}
            </>
          )}
        </Row>
        <Row q="اکنون چقدر ارزش دارد؟">
          {usd(v.netValueUsd)} <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="sm" /> <QualityBadge q={v.tokenPrice.quality} prefix="قیمت" />
        </Row>
        <Row q="اگر اکنون خارج شوم؟">
          حدود {usd(v.exit.proceedsUsd)} <QualityBadge q={v.exit.quality} />
        </Row>
        <Row q="ادامه یا جابه‌جایی؟">
          <span className={`w-full rounded-md border-r-2 px-4 py-3 text-sm leading-7 ${LEAN[a.lean].cls}`}>
            {LEAN[a.lean].text} قطعی نیست.
          </span>
        </Row>
      </dl>
    </Panel>
  );
}

export function Numbers({ x }: { x: PositionView }) {
  const { p, v, quote } = x;
  const L = v.ledger;
  const unit = p.assetSymbol || 'دارایی';
  return (
    <Panel title="ارزش و سود و زیان">
      <Group title="سرمایه و بهای خرید">
        <StatGrid>
          <Stat label="سرمایه‌ی شخصی واردشده">{usd(v.investedUsd)}</Stat>
          <Stat label="بهای تمام‌شده‌ی باقی‌مانده" hint="روش میانگین">
            {usd(L.costUsd)}
          </Stat>
          <Stat label="مقدار باقی‌مانده">
            <Num>{formatNumber(L.units, 4)}</Num>
          </Stat>
          <Stat
            label="میانگین بهای خرید"
            hint={
              Number.isFinite(v.avgCostAsset) ? (
                <>
                  <Num>{formatNumber(v.avgCostAsset, 6)}</Num> {unit}
                </>
              ) : undefined
            }
          >
            <Usd x={v.avgCostUsd} digits={priceDigits(v.avgCostUsd)} />
          </Stat>
        </StatGrid>
      </Group>
      <Group title="ارزش و خروج">
        <StatGrid>
          <Stat
            label="ارزش با قیمت بازار"
            q={v.tokenPrice.quality}
            hint={
              Number.isFinite(v.tokenPrice.value) ? (
                <>
                  قیمت <Num>{formatNumber(v.tokenPrice.value, 6)}</Num> {unit}
                </>
              ) : undefined
            }
          >
            {usd(v.markValueUsd)}
          </Stat>
          <Stat label="ارزش خالص (پس از بدهی)">{usd(v.netValueUsd)}</Stat>
          <Stat
            label="مبلغ تخمینی خروج اکنون"
            q={v.exit.quality}
            hint={
              <>
                هزینه <Num>{formatPercent(v.exit.costPct, 2)}</Num>
                {v.exit.impactPct === null ? ' (نقدینگی نامعلوم)' : ''} + شبکه {formatDollar(v.exit.networkUsd)}
              </>
            }
          >
            {usd(v.exit.proceedsUsd)}
          </Stat>
          <Stat label="سود و زیان کل">
            <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="sm" word={false} />
          </Stat>
        </StatGrid>
      </Group>
      <Group title="سود و زیان">
        <StatGrid>
          <Stat label="تحقق‌یافته">
            <Pnl usd={v.realizedUsd} size="sm" />
          </Stat>
          <Stat label="تحقق‌نیافته">
            <Pnl usd={v.unrealizedUsd} size="sm" />
          </Stat>
          <Stat label={`بازده برحسب ${unit}`} hint={v.pnlAsset === null ? 'نرخ دارایی برخی رویدادها ثبت نشده' : undefined}>
            {v.pnlAsset === null ? (
              '—'
            ) : (
              <>
                <Num>{formatNumber(v.pnlAsset, 4)}</Num> <span className="text-sm text-sx-muted">{unit}</span>{' '}
                {v.pnlAssetPct !== null && <Num className="text-xs text-sx-muted">({formatPercent(v.pnlAssetPct, 2, true)})</Num>}
              </>
            )}
          </Stat>
          <Stat label="اثر تغییر قیمت دلاری دارایی">{v.assetPriceEffectUsd === null ? '—' : <Pnl usd={v.assetPriceEffectUsd} size="sm" word={false} />}</Stat>
        </StatGrid>
      </Group>
      <Group title="درآمد و هزینه">
        <StatGrid>
          <Stat label="سود دریافت‌شده (واقعی)">{usd(L.incomeYieldUsd)}</Stat>
          <Stat label="سود دریافت‌نشده" q={v.unclaimedYield.quality}>
            {p.kind === 'yt' ? usd(v.unclaimedYield.value) : '—'}
          </Stat>
          <Stat label="پاداش دریافت‌شده">{usd(L.incomeRewardUsd)}</Stat>
          <Stat
            label="کارمزدها"
            hint={
              <>
                شبکه {formatDollar(L.fees.network)} · معامله {formatDollar(L.fees.trade)} · جانبی {formatDollar(L.fees.other)}
              </>
            }
          >
            {usd(L.fees.total)}
          </Stat>
        </StatGrid>
        {L.fees.total - L.fees.separate > 0 && <p className="text-xs text-sx-muted">{formatDollar(L.fees.total - L.fees.separate)} از کارمزدها داخل مبلغ‌ها حساب شده بود و دوباره کم نشده است.</p>}
      </Group>
      <Group title="زمان و داده">
        <StatGrid>
          <Stat label="زمان سپری‌شده">{fmtDays(v.daysHeld)}</Stat>
          <Stat label="تا سررسید">{fmtDays(v.daysLeft)}</Stat>
          <Stat label="آخرین دریافت داده" q={v.tokenPrice.quality === 'manual' ? 'manual' : quote ? (quote.failed ? 'stale' : v.tokenPrice.quality) : 'missing'}>
            <span className="text-[15px]">{ageText(v.dataAgeMs)}</span>
          </Stat>
          <Stat label="منبع قیمت">
            <span className="text-[15px]">
              {v.tokenPrice.quality === 'manual' ? 'ورود دستی' : v.tokenPrice.quality === 'rule' ? 'قاعده‌ی سررسید' : <span dir="ltr">{protocols[p.protocol].name} API</span>} · {QUALITY_FA[v.tokenPrice.quality]}
            </span>
          </Stat>
        </StatGrid>
      </Group>
    </Panel>
  );
}

export function KindPanel({ x, onSave }: { x: PositionView; onSave: (p: Position) => void }) {
  const { p, v, quote } = x;
  const [debtNow, setDebtNow] = useState(NaN);
  if (p.kind === 'pt') {
    return (
      <Panel title="محاسبات PT" icon={<Scale size={17} />}>
        <StatGrid>
          <Stat label="بازده ثابت قفل‌شده در ورود" hint="از قیمت واقعی پرداختی">
            {v.entryAPY === null ? '—' : <Num>{formatPercent(v.entryAPY, 2)}</Num>}
          </Stat>
          <Stat label="Implied APY فعلی بازار" q={quote ? v.tokenPrice.quality : 'missing'}>
            {quote ? <Num>{formatPercent(quote.impliedAPY, 2)}</Num> : '—'}
          </Stat>
          <Stat label="ارزش بازخرید در سررسید" hint={`${formatNumber(v.ledger.units, 2)} ${p.assetSymbol || 'واحد'} × قیمت دلاری فعلی`}>
            {usd(v.redeemValueUsd)}
          </Stat>
          <Stat label="خروج زودهنگام اکنون" q={v.exit.quality}>
            {usd(v.exit.proceedsUsd)}
          </Stat>
        </StatGrid>
        <p className="text-xs text-sx-muted leading-6">
          واحد بازخرید: ۱ PT = ۱ {p.assetSymbol || 'واحد دارایی پایه'} در سررسید. ارزش دلاری آن با قیمت همان دارایی تغییر می‌کند؛ PT معادل یک دلار فرض نشده است.
        </p>
      </Panel>
    );
  }
  if (p.kind === 'yt') {
    return (
      <Panel title="محاسبات YT" icon={<Gift size={17} />}>
        <StatGrid>
          <Stat label="ارزش فروش توکن" q={v.tokenPrice.quality}>
            {usd(v.markValueUsd)}
          </Stat>
          <Stat label="سود دریافت‌شده" hint="ثبت‌شده توسط شما">
            {usd(v.ledger.incomeYieldUsd)}
          </Stat>
          <Stat label="سود انباشته‌ی دریافت‌نشده" q={v.unclaimedYield.quality}>
            {usd(v.unclaimedYield.value)}
          </Stat>
          <Stat label="بازده پایه‌ی فعلی" q={quote ? v.tokenPrice.quality : 'missing'}>
            {quote ? <Num>{formatPercent(quote.baseAPY, 2)}</Num> : '—'}
          </Stat>
        </StatGrid>
        <p className="text-xs text-sx-muted leading-6">
          {v.unclaimedYield.quality === 'historical'
            ? 'از سابقه‌ی روزانه‌ی بازده.'
            : v.unclaimedYield.quality === 'manual'
              ? 'سود انباشته از عددی است که دستی وارد کرده‌اید.'
              : 'تخمین با نرخ فعلی؛ عدد دقیق را دستی وارد کنید.'}
        </p>
      </Panel>
    );
  }
  const h = v.loop;
  const lp = p.loop!;
  const hfTone = h ? (h.healthFactor < 1.1 ? 'text-sx-red' : h.healthFactor < 1.3 ? 'text-sx-orange' : 'text-sx-green') : '';
  return (
    <Panel title="محاسبات PT Loop" icon={<ShieldAlert size={17} />}>
      {h ? (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-sx-muted">شاخص سلامت</span>
              <span className={`text-4xl font-light ${hfTone}`}>
                {h.healthFactor < 1.1 ? '⚠ ' : ''}
                <Num>{Number.isFinite(h.healthFactor) ? formatNumber(h.healthFactor, 3) : '∞'}</Num>
              </span>
              <QualityBadge q={h.quality} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-sx-muted">فاصله تا لیکویید شدن</span>
              <span className="text-2xl font-light">
                <Num>{formatPercent(h.dropToLiquidation, 2)}</Num> <span className="text-sm text-sx-muted">افت قیمت PT</span>
              </span>
            </div>
          </div>
          <StatGrid>
            <Stat label="قیمت لیکویید PT" q={h.quality}>
              <Num>{formatNumber(h.liquidationPtPrice, 5)}</Num>
            </Stat>
            <Stat label="Implied APY لیکویید شدن" q={h.quality}>
              {Number.isFinite(h.liquidationAPY) ? <Num>{formatPercent(h.liquidationAPY, 2)}</Num> : '—'}
            </Stat>
            <Stat label="اهرم فعلی">
              <Num>{formatNumber(h.leverage, 2)}×</Num>
            </Stat>
            <Stat label="وثیقه (ارزش بازار)">{usd(h.collateralUsd)}</Stat>
            <Stat label="بدهی با بهره" q={h.debtQuality}>
              {usd(h.debtUsd)}
            </Stat>
            <Stat label="نرخ بهره / LLTV">
              <Num>{formatPercent(lp.borrowAPY, 2)}</Num> / <Num>{formatPercent(lp.lltv, 1)}</Num>
            </Stat>
            <Stat label="بازار وام‌دهی" className="col-span-2">
              <span dir="ltr" className="text-[15px]">
                {lp.lendingPlatform || '—'} {lp.lendingMarket}
              </span>
            </Stat>
          </StatGrid>
        </>
      ) : (
        <p className="text-sm text-sx-muted">وثیقه‌ای باقی نمانده است.</p>
      )}
      <p className="text-xs text-sx-muted leading-6">
        {lp.oracle === 'unknown'
          ? 'با قیمت بازار PT تخمین زده شد؛ عدد پلتفرم مبناست.'
          : lp.oracle === 'manual'
            ? 'با اوراکل دستی شما.'
            : 'سلامت با قیمت بازار PT محاسبه شده.'}{' '}
        {h?.debtQuality === 'estimate' ? `بدهی با نرخ ثبت‌شده‌ی ${formatPercent(lp.borrowAPY, 2)} تخمین زده شده؛ برای دقت، بدهی فعلی را از پلتفرم وارد کنید.` : ''}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end border-t border-sx-border pt-5">
        <NumberField persian label={`بدهی فعلی طبق پلتفرم (${lp.debtAsset})`} value={debtNow} onChange={setDebtNow} />
        <NumberField persian label="نرخ بهره‌ی فعلی وام" value={lp.borrowAPY} onChange={(borrowAPY) => onSave({ ...p, loop: { ...lp, borrowAPY } })} suffix="%" />
        <NumberField persian label="LLTV" value={lp.lltv} onChange={(lltv) => onSave({ ...p, loop: { ...lp, lltv } })} suffix="%" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!(debtNow >= 0)} onClick={() => onSave({ ...p, loop: { ...lp, debtOverride: { amount: debtNow, at: new Date().toISOString() } } })} className={btn.secondary}>
          ثبت بدهی فعلی
        </button>
        {lp.debtOverride && (
          <button type="button" onClick={() => onSave({ ...p, loop: { ...lp, debtOverride: null } })} className={btn.danger}>
            حذف عدد دستی (<Num>{formatNumber(lp.debtOverride.amount, 2)}</Num>)
          </button>
        )}
      </div>
    </Panel>
  );
}

export function AnalysisPanel({ x }: { x: PositionView }) {
  const { a } = x;
  return (
    <Panel title="تحلیل نگهداری و خروج" icon={<Scale size={17} />}>
      <ul className="flex flex-col gap-2 text-[15px] leading-7">
        {a.summary.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-3 size-1.5 rounded-full bg-sx-accent shrink-0" aria-hidden />
            <span>{s}</span>
          </li>
        ))}
      </ul>
      {a.scenarios.length > 0 && (
        <div className="overflow-x-auto -mx-4 md:-mx-6">
          <table className="w-full text-sm min-w-[32rem]">
            <thead>
              <tr className="text-sx-muted text-xs text-right border-y border-sx-border bg-sx-raised/40">
                <th className="py-2.5 px-4 md:px-6 font-normal">سناریو</th>
                <th className="py-2.5 px-3 font-normal">نتیجه</th>
                <th className="py-2.5 px-4 md:px-6 font-normal">در مقایسه با خروج اکنون</th>
              </tr>
            </thead>
            <tbody>
              {a.scenarios.map((s) => (
                <tr key={s.label} className="border-b border-sx-border align-top">
                  <td className="py-3 px-4 md:px-6">
                    <div className="text-sx-text">{s.label}</div>
                    <div className="text-xs text-sx-faint mt-0.5">{s.assumption}</div>
                  </td>
                  <td className="py-3 px-3">{usd(s.valueUsd)}</td>
                  <td className="py-3 px-4 md:px-6">
                    <Pnl usd={s.vsExitUsd} size="sm" word={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.triggers.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">چه چیزی خروج را منطقی‌تر می‌کند؟</h3>
          <ul className="flex flex-col gap-2 text-sm text-sx-muted leading-7">
            {a.triggers.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-2.5 size-1.5 rounded-full bg-sx-orange shrink-0" aria-hidden />
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.assumptions.length > 0 && (
        <details className="text-xs text-sx-muted">
          <summary className="text-sx-accent">فرض‌ها و کیفیت داده</summary>
          <ul className="list-disc pr-5 mt-2 flex flex-col gap-1 leading-6">
            {a.assumptions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-sx-faint">قطعی نیست؛ معامله‌ای خودکار انجام نمی‌شود.</p>
    </Panel>
  );
}

/** Loads every market only when this panel is open (PT positions). */
function SwitchPanel({ x }: { x: PositionView }) {
  const { markets, loading } = useAllMarkets();
  const [s, setS] = useState<SwitchSettings>(defaultSwitchSettings);
  const current = markets.find((m) => m.id === x.p.marketId && m.protocol === x.p.protocol) ?? null;
  const res = useMemo(() => compareMarkets(x.p, x.v, markets, current, s), [x.p, x.v, markets, current, s]);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-sx-muted leading-7">
        افق مقایسه از امروز تا سررسید همین پوزیشن ({fmtDays(x.v.daysLeft)}) است: خروج اکنون (پس از هزینه)، انتقال، ورود به بازار دیگر (پس از کارمزد و لغزش) و ارزش آن در همان افق. فقط دارایی‌های هم‌دسته با نقدینگی کافی مقایسه می‌شوند و APY بالاتر به‌تنهایی دلیل پیشنهاد نیست.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <NumberField persian label="کارمزد ورود" value={s.entryFeePct} onChange={(entryFeePct) => setS({ ...s, entryFeePct })} suffix="%" />
        <NumberField persian label="هزینه‌ی انتقال بین شبکه" value={s.bridgeUsd} onChange={(bridgeUsd) => setS({ ...s, bridgeUsd })} suffix="دلار" />
        <NumberField persian label="حداقل مزیت معنادار" value={s.minAdvantagePct} onChange={(minAdvantagePct) => setS({ ...s, minAdvantagePct })} suffix="%" />
      </div>
      {loading && !markets.length ? (
        <p className="text-sm text-sx-muted flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> در حال دریافت بازارها…
        </p>
      ) : !res.length ? (
        <p className="text-sm text-sx-muted">بازار قابل مقایسه‌ای پیدا نشد.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-sx-border border-y border-sx-border">
          {res.map((c) => (
            <li key={`${c.m.protocol}:${c.m.id}`} className="py-4 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <TokenLogo src={c.m.icon} name={c.m.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium truncate" dir="ltr">
                    PT {c.m.name}
                  </div>
                  <div className="text-xs text-sx-muted">
                    <span dir="ltr">{protocols[c.m.protocol].name}</span> · {chainFa(c.m.chain)} · Implied <Num>{formatPercent(c.m.impliedAPY, 2)}</Num> · <Num>{formatNumber(c.m.daysToMaturity, 0)}</Num> روز
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pnl usd={c.advantageUsd} pct={c.advantagePct} size="sm" word={false} />
                  <Chip tone={c.meaningful ? 'success' : 'muted'}>{c.meaningful ? 'مزیت معنادار' : 'مزیت ناچیز یا پرریسک'}</Chip>
                </div>
              </div>
              {c.risks.length > 0 && <p className="text-xs text-sx-orange leading-6">⚠ {c.risks.join('؛ ')}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-sx-faint">با فرض ثابت ماندن قیمت و نرخ.</p>
    </div>
  );
}

function Targets({ x, onSave }: { x: PositionView; onSave: (p: Position) => void }) {
  const { p } = x;
  const t = p.targets;
  const set = (k: keyof typeof t, v: number | null) => onSave({ ...p, targets: { ...t, [k]: v } });
  const field = (k: keyof typeof t, label: string, suffix?: string) => (
    <div className="flex items-end gap-1">
      <div className="flex-1">
        <NumberField persian label={label} value={t[k] ?? NaN} onChange={(v) => set(k, v)} suffix={suffix} />
      </div>
      {t[k] !== null && (
        <button type="button" onClick={() => set(k, null)} className={btn.ghost} aria-label={`خاموش کردن ${label}`}>
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
  return (
    <>
      <p className="text-sm text-sx-muted">با عبور از این مرزها هشدار می‌گیرید.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {field('takeProfitPct', 'هدف سود', '%')}
        {field('stopLossPct', 'سقف زیان', '%')}
        {p.kind === 'loop' && field('minHealth', 'حداقل شاخص سلامت')}
      </div>
    </>
  );
}

function ManualMarks({ x, onSave }: { x: PositionView; onSave: (p: Position) => void }) {
  const { p } = x;
  const [price, setPrice] = useState(NaN);
  const [asset, setAsset] = useState(NaN);
  const [yieldV, setYieldV] = useState(NaN);
  const now = () => new Date().toISOString();
  const row = (label: string, value: number, setV: (v: number) => void, key: keyof Position['manual'], current: { value: number; at: string } | null) => (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <NumberField persian label={label} value={value} onChange={setV} />
      </div>
      <button type="button" disabled={!(value >= 0)} onClick={() => onSave({ ...p, manual: { ...p.manual, [key]: { value, at: now() } } })} className={btn.secondary}>
        ثبت
      </button>
      {current && (
        <button type="button" onClick={() => onSave({ ...p, manual: { ...p.manual, [key]: null } })} className={btn.danger}>
          حذف (<Num>{formatNumber(current.value, 6)}</Num>، {formatDateTime(current.at)})
        </button>
      )}
    </div>
  );
  return (
    <>
      <p className="text-sm text-sx-muted">عدد دستی جای داده‌ی بازار می‌نشیند.</p>
      {row(`قیمت ${p.kind === 'yt' ? 'YT' : 'PT'} (${p.assetSymbol || 'واحد دارایی'})`, price, setPrice, 'tokenPrice', p.manual.tokenPrice)}
      {row(`قیمت دلاری ${p.assetSymbol || 'دارایی پایه'}`, asset, setAsset, 'assetUsd', p.manual.assetUsd)}
      {p.kind === 'yt' && row(`سود دریافت‌نشده طبق پلتفرم (${p.assetSymbol || 'واحد دارایی'})`, yieldV, setYieldV, 'unclaimedYield', p.manual.unclaimedYield)}
    </>
  );
}

/**
 * A user note. Links (e.g. a block-explorer transaction) are shown short and
 * clickable instead of as a long URL that would break the layout; other text wraps.
 */
function NoteText({ note }: { note: string }) {
  const parts = note.split(/(https?:\/\/\S+)/g).filter(Boolean);
  return (
    <div className="text-xs text-sx-faint min-w-0 [overflow-wrap:anywhere]">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>;
        let label = part;
        try {
          const u = new URL(part);
          const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
          label = `${u.hostname.replace(/^www\./, '')}${last ? ` · ${last.length > 14 ? `${last.slice(0, 6)}…${last.slice(-4)}` : last}` : ''}`;
        } catch {
          /* not a valid URL: show as typed */
        }
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" dir="ltr" title={part} className="inline-flex items-center gap-1 text-sx-accent hover:underline underline-offset-4">
            {label} <ExternalLink size={11} aria-hidden />
          </a>
        );
      })}
    </div>
  );
}

const EVENT_DOT: Record<PositionEventType, string> = {
  buy: 'bg-sx-accent',
  sell: 'bg-sx-blue',
  redeem: 'bg-sx-green',
  claim_yield: 'bg-sx-green',
  claim_reward: 'bg-sx-green',
  borrow: 'bg-sx-orange',
  repay: 'bg-sx-orange',
};

function Events({ x, onSave }: { x: PositionView; onSave: (p: Position) => void }) {
  const { p, quote } = x;
  const [adding, setAdding] = useState(false);
  const sorted = [...p.events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      {adding ? (
        <div className="rounded-lg border border-sx-border bg-sx-raised/30 p-5">
          <EventForm
            types={EVENT_TYPES[p.kind]}
            assetSymbol={p.assetSymbol}
            liveAssetUsd={quote?.assetUsd ?? null}
            defaultToken={p.assetSymbol}
            chain={p.chain}
            marketIcon={p.icon}
            onSubmit={(e) => {
              onSave({ ...p, events: [...p.events, e] });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${btn.secondary} self-start`}>
          <Plus size={15} /> ثبت رویداد
        </button>
      )}
      {!adding && <p className="text-xs text-sx-faint -mt-3">خرید مجدد، فروش، بازخرید، دریافت سود یا پاداش، وام و بازپرداخت</p>}
      <ol className="flex flex-col border-r border-sx-border mr-1.5">
        {sorted.map((e) => (
          <li key={e.id} className="relative min-w-0 pr-6 pb-6 last:pb-0 flex flex-col gap-1.5 text-sm">
            <span className={`absolute -right-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-sx-surface ${EVENT_DOT[e.type]}`} aria-hidden />
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sx-text">{EVENT_FA[e.type]}</span>
              <span className="text-xs text-sx-faint">{formatDateTime(e.at)}</span>
            </div>
            <div className="text-sx-muted flex flex-wrap items-center gap-x-3 gap-y-1">
              {e.units > 0 && (
                <span>
                  <Num>{formatNumber(e.units, 4)}</Num> توکن
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <Num>{formatNumber(e.cash.amount, 6)}</Num>
                <TokenBadge symbol={e.cash.token} size={16} fallbackLogo={e.cash.token.toLowerCase() === p.assetSymbol.toLowerCase() ? p.icon : null} />
                {e.cash.usdRate !== null ? (
                  <span className="text-xs text-sx-faint">
                    ({formatDollar(e.cash.amount * e.cash.usdRate)}، {RATE_FA[e.cash.rateSource]})
                  </span>
                ) : (
                  <span className="text-xs text-sx-orange">(نرخ دلاری نامعلوم)</span>
                )}
              </span>
              {e.assetUsd === null && <span className="text-xs text-sx-orange">نرخ دارایی نامعلوم</span>}
            </div>
            {e.fees.map((f, i) => (
              <div key={i} className="text-xs text-sx-faint inline-flex items-center gap-1.5 flex-wrap">
                {FEE_FA[f.kind]}: <Num>{formatNumber(f.amount, 6)}</Num> <TokenBadge symbol={f.token} size={14} />
                {f.usdRate !== null && <>({formatDollar(f.amount * f.usdRate)})</>} · {f.included ? 'داخل مبلغ حساب شده' : 'جداگانه پرداخت شده'}
              </div>
            ))}
            {e.note && <NoteText note={e.note} />}
            <button
              type="button"
              className="tap self-start text-sm text-sx-faint hover:text-sx-red inline-flex items-center gap-1 min-h-10 transition-colors"
              onClick={() => {
                if (window.confirm('این رویداد حذف شود؟ محاسبات از نو انجام می‌شود.')) onSave({ ...p, events: p.events.filter((y) => y.id !== e.id) });
              }}
            >
              <Trash2 size={12} /> حذف
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function PositionDetail({ id }: { id: string }) {
  const router = useRouter();
  const { positions, views, airdrops, saveAirdrop, removeAirdrop, save, remove, refresh, refreshing, updatedAt } = usePortfolioView();
  const x = views.find((y) => y.p.id === id);

  if (positions === null) {
    return (
      <main className="sx grid place-items-center py-24 text-sx-muted">
        <Loader2 className="animate-spin" />
      </main>
    );
  }
  if (!x) {
    return (
      <SxPage narrow>
        <div className="sx-card p-10 flex flex-col items-center gap-3 text-sx-muted text-center">
          پوزیشن پیدا نشد. ممکن است در مرورگر دیگری ثبت شده باشد.
          <Link href="/portfolio" className={btn.secondary}>
            بازگشت به پرتفوی
          </Link>
        </div>
      </SxPage>
    );
  }

  const { p, v } = x;
  const onSave = (np: Position) => save(np);

  return (
    <SxPage>
      <Link href="/portfolio" className="tap text-sm text-sx-muted hover:text-sx-text flex items-center gap-1 self-start min-h-10 transition-colors">
        <ArrowRight size={14} /> پرتفوی من
      </Link>

      <section className="sx-hero p-6 md:p-8 flex flex-col gap-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <MarketIdentity p={p} size={52} />
          <div className="flex items-center gap-2">
            <StatusBadge s={v.status} />
            <button type="button" onClick={refresh} disabled={refreshing} className={btn.ghost}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> تازه‌سازی
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-12 gap-y-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-sx-muted">ارزش خالص</span>
            <span className="hero-num">
              <Usd x={v.netValueUsd} />
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-sx-muted">سود و زیان کل</span>
            <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="lg" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-sx-muted">اگر اکنون خارج شوم</span>
            <span className="text-xl font-light flex items-center gap-2">
              <Usd x={v.exit.proceedsUsd} /> <QualityBadge q={v.exit.quality} />
            </span>
          </div>
        </div>
        <p className="text-xs text-sx-faint flex flex-wrap items-center gap-1.5 border-t border-sx-border pt-4">
          <span className={`size-1.5 rounded-full ${x.q?.error ? 'bg-sx-orange' : updatedAt ? 'bg-sx-green' : 'bg-sx-faint'}`} aria-hidden />
          {updatedAt ? (
            <>
              آخرین دریافت داده: <Num>{formatDateTime(new Date(updatedAt).toISOString())}</Num>
            </>
          ) : (
            'در حال دریافت داده…'
          )}
          {x.q?.error && <span className="text-sx-orange"> · {x.q.error}؛ آخرین داده‌ی موجود «قدیمی» نمایش داده می‌شود.</span>}
          {v.ledger.units <= EPS && v.status !== 'closed' && ' · توکنی باقی نمانده'}
        </p>
      </section>

      <AlertList alerts={x.alerts} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3 flex flex-col gap-6 min-w-0">
          <Answers x={x} />
          <Numbers x={x} />
          <KindPanel x={x} onSave={onSave} />
          {p.kind === 'yt' && <AirdropCard x={x} programs={airdrops} views={views} saveAirdrop={saveAirdrop} removeAirdrop={removeAirdrop} onSavePosition={onSave} />}
          {v.status !== 'closed' && <AnalysisPanel x={x} />}
        </div>
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
          <Panel title="سوابق معامله" icon={<History size={17} />}>
            <Events x={x} onSave={onSave} />
          </Panel>
          <Disclosure title="عملکرد ثبت‌شده" icon={<History size={17} />}>
            <SnapshotChart label="سود و زیان ثبت‌شده‌ی پوزیشن" points={p.snapshots.map((s) => ({ t: new Date(s.at).getTime(), y: s.pnlUsd }))} />
          </Disclosure>
          {p.kind === 'pt' && v.status === 'open' && (
            <Disclosure title="مقایسه با بازارهای دیگر" icon={<ArrowLeftRight size={17} />}>
              <SwitchPanel x={x} />
            </Disclosure>
          )}
          {p.kind !== 'pt' && v.status === 'open' && (
            <p className="text-xs text-sx-muted leading-6">
              مقایسه‌ی خودکار با بازارهای دیگر فعلاً فقط برای PT انجام می‌شود؛ نتیجه‌ی {p.kind === 'yt' ? 'YT به ارزش پوینت' : 'لوپ به نرخ وام و اوراکل هر بازار'} بستگی دارد. برای بررسی دستی به{' '}
              <Link href="/" className="text-sx-accent underline underline-offset-4">
                تحلیل بازار
              </Link>{' '}
              بروید.
            </p>
          )}
          <Disclosure title="اهداف و هشدارها" icon={<Target size={17} />}>
            <Targets x={x} onSave={onSave} />
          </Disclosure>
          <Disclosure title="ثبت دستی قیمت و موجودی" icon={<Settings2 size={17} />}>
            <ManualMarks x={x} onSave={onSave} />
          </Disclosure>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-sx-border pt-5">
        <NoWalletNote />
        <button
          type="button"
          className={btn.danger}
          onClick={() => {
            if (window.confirm('این پوزیشن و همه‌ی سوابق آن حذف شود؟')) {
              remove(p.id);
              router.push('/portfolio');
            }
          }}
        >
          <Trash2 size={15} /> حذف پوزیشن
        </button>
      </footer>
    </SxPage>
  );
}
