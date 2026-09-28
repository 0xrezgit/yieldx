'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeftRight, Gift, History, Loader2, Plus, RefreshCw, Scale, Settings2, ShieldAlert, Target, Trash2 } from 'lucide-react';
import type { Position, PositionEventType } from '../../types/position';
import { usePortfolioView, type PositionView } from '../../hooks/usePortfolioView';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { compareMarkets, defaultSwitchSettings, fmtDays, type SwitchSettings } from '../../lib/portfolio/analysis';
import { chainFa, EVENT_FA, FEE_FA, KIND_LABEL, QUALITY_FA, RATE_FA } from '../../lib/portfolio/labels';
import { EPS } from '../../lib/portfolio/ledger';
import { formatDateTime, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import protocols from '../../config/protocols.json';
import { Card, Collapsible } from '../ui/card';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { EventForm } from './EventForm';
import { AlertList, MarketIdentity, NoWalletNote, Pnl, QualityBadge, SnapshotChart, Stat, StatusBadge, usd } from './parts';

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
  hold: { text: 'با فرض‌های فعلی، نگهداری نسبت به خروج اکنون برتری دارد.', cls: 'border-success/40 bg-success/10' },
  exit: { text: 'با فرض‌های فعلی، خروج یا بازخرید نسبت به ادامه منطقی‌تر به نظر می‌رسد.', cls: 'border-warning/40 bg-warning/10' },
  neutral: { text: 'تفاوت معناداری بین نگهداری و خروج دیده نمی‌شود.', cls: 'border-default bg-elevated/40' },
  unknown: { text: 'داده‌ی کافی برای مقایسه‌ی نگهداری و خروج نیست.', cls: 'border-default bg-elevated/40' },
};

export function Answers({ x }: { x: PositionView }) {
  const { p, v, a } = x;
  const L = v.ledger;
  return (
    <Card title="جمع‌بندی">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-muted text-xs">چه خریده‌ام؟</dt>
          <dd className="text-primary">
            <Num>{formatNumber(L.units, 4)}</Num> <span dir="ltr">{KIND_LABEL[p.kind === 'loop' ? 'pt' : p.kind]} {p.marketName}</span> روی {chainFa(p.chain)} در <span dir="ltr">{protocols[p.protocol].name}</span>
            {p.loop && <> با بدهی {usd(v.debtUsd.value)} <span dir="ltr">{p.loop.debtAsset}</span> در <span dir="ltr">{p.loop.lendingPlatform || '—'}</span></>}
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">چقدر هزینه کرده‌ام؟</dt>
          <dd className="text-primary">
            سرمایه‌ی شخصی {usd(v.investedUsd)} · کارمزدها {usd(L.fees.total)}
            {L.interestPaidUsd > 0 && <> · بهره‌ی پرداختی {usd(L.interestPaidUsd)}</>}
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">اکنون چقدر ارزش دارد؟</dt>
          <dd className="text-primary flex flex-wrap items-center gap-2">
            {usd(v.netValueUsd)} <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="sm" /> <QualityBadge q={v.tokenPrice.quality} prefix="قیمت" />
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">اگر اکنون خارج شوم؟</dt>
          <dd className="text-primary flex flex-wrap items-center gap-2">
            حدود {usd(v.exit.proceedsUsd)} <QualityBadge q={v.exit.quality} />
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">ادامه یا جابه‌جایی؟</dt>
          <dd className={`rounded-xl border px-3 py-2 text-primary ${LEAN[a.lean].cls}`}>{LEAN[a.lean].text} این یک پیشنهاد قطعی نیست؛ فرض‌ها را در بخش تحلیل ببینید.</dd>
        </div>
      </dl>
    </Card>
  );
}

export function Numbers({ x }: { x: PositionView }) {
  const { p, v, quote } = x;
  const L = v.ledger;
  const unit = p.assetSymbol || 'دارایی';
  return (
    <Card title="ارزش و سود و زیان">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="سرمایه‌ی شخصی واردشده">{usd(v.investedUsd)}</Stat>
        <Stat label="بهای تمام‌شده‌ی باقی‌مانده" hint="روش میانگین">{usd(L.costUsd)}</Stat>
        <Stat label="مقدار باقی‌مانده"><Num>{formatNumber(L.units, 4)}</Num></Stat>
        <Stat label="میانگین بهای خرید" hint={Number.isFinite(v.avgCostAsset) ? <><Num>{formatNumber(v.avgCostAsset, 5)}</Num> {unit}</> : undefined}>
          <Num>{formatUSD(v.avgCostUsd, 4)}</Num>
        </Stat>
        <Stat label="ارزش با قیمت بازار" q={v.tokenPrice.quality} hint={Number.isFinite(v.tokenPrice.value) ? <>قیمت <Num>{formatNumber(v.tokenPrice.value, 5)}</Num> {unit}</> : undefined}>
          {usd(v.markValueUsd)}
        </Stat>
        <Stat label="ارزش خالص (پس از بدهی)">{usd(v.netValueUsd)}</Stat>
        <Stat label="مبلغ تخمینی خروج اکنون" q={v.exit.quality} hint={<>هزینه <Num>{formatPercent(v.exit.costPct, 2)}</Num>{v.exit.impactPct === null ? ' (نقدینگی نامعلوم)' : ''} + شبکه <Num>{formatUSD(v.exit.networkUsd)}</Num></>}>
          {usd(v.exit.proceedsUsd)}
        </Stat>
        <Stat label="سود و زیان کل">
          <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="sm" word={false} />
        </Stat>
        <Stat label="تحقق‌یافته"><Pnl usd={v.realizedUsd} size="sm" /></Stat>
        <Stat label="تحقق‌نیافته"><Pnl usd={v.unrealizedUsd} size="sm" /></Stat>
        <Stat label={`بازده برحسب ${unit}`} hint={v.pnlAsset === null ? 'نرخ دارایی برخی رویدادها ثبت نشده' : undefined}>
          {v.pnlAsset === null ? '—' : <><Num>{formatNumber(v.pnlAsset, 4)}</Num> {unit} {v.pnlAssetPct !== null && <Num className="text-xs">({formatPercent(v.pnlAssetPct, 2, true)})</Num>}</>}
        </Stat>
        <Stat label="اثر تغییر قیمت دلاری دارایی">{v.assetPriceEffectUsd === null ? '—' : <Pnl usd={v.assetPriceEffectUsd} size="sm" word={false} />}</Stat>
        <Stat label="سود دریافت‌شده (واقعی)">{usd(L.incomeYieldUsd)}</Stat>
        <Stat label="سود دریافت‌نشده" q={v.unclaimedYield.quality}>{p.kind === 'yt' ? usd(v.unclaimedYield.value) : '—'}</Stat>
        <Stat label="پاداش دریافت‌شده">{usd(L.incomeRewardUsd)}</Stat>
        <Stat label="کارمزدها" hint={<>شبکه <Num>{formatUSD(L.fees.network)}</Num> · معامله <Num>{formatUSD(L.fees.trade)}</Num> · جانبی <Num>{formatUSD(L.fees.other)}</Num></>}>
          {usd(L.fees.total)}
        </Stat>
        <Stat label="زمان سپری‌شده">{fmtDays(v.daysHeld)}</Stat>
        <Stat label="تا سررسید">{fmtDays(v.daysLeft)}</Stat>
        <Stat label="آخرین دریافت داده" q={v.tokenPrice.quality === 'manual' ? 'manual' : quote ? (quote.failed ? 'stale' : v.tokenPrice.quality) : 'missing'}>
          <span className="text-sm">{ageText(v.dataAgeMs)}</span>
        </Stat>
        <Stat label="منبع قیمت">
          <span className="text-sm">
            {v.tokenPrice.quality === 'manual' ? 'ورود دستی' : v.tokenPrice.quality === 'rule' ? 'قاعده‌ی سررسید' : <span dir="ltr">{protocols[p.protocol].name} API</span>} · {QUALITY_FA[v.tokenPrice.quality]}
          </span>
        </Stat>
      </div>
      {L.fees.total - L.fees.separate > 0 && (
        <p className="text-xs text-secondary">
          <Num>{formatUSD(L.fees.total - L.fees.separate)}</Num> از کارمزدها داخل مبلغ‌ها حساب شده بود و دوباره کم نشده است.
        </p>
      )}
    </Card>
  );
}

export function KindPanel({ x, onSave }: { x: PositionView; onSave: (p: Position) => void }) {
  const { p, v, quote } = x;
  const [debtNow, setDebtNow] = useState(NaN);
  if (p.kind === 'pt') {
    return (
      <Card title="محاسبات PT" icon={<Scale size={18} />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="بازده ثابت قفل‌شده در ورود" hint="از قیمت واقعی پرداختی">{v.entryAPY === null ? '—' : <Num>{formatPercent(v.entryAPY, 2)}</Num>}</Stat>
          <Stat label="Implied APY فعلی بازار" q={quote ? v.tokenPrice.quality : 'missing'}>{quote ? <Num>{formatPercent(quote.impliedAPY, 2)}</Num> : '—'}</Stat>
          <Stat label="ارزش بازخرید در سررسید" hint={`${formatNumber(v.ledger.units, 2)} ${p.assetSymbol || 'واحد'} × قیمت دلاری فعلی`}>{usd(v.redeemValueUsd)}</Stat>
          <Stat label="خروج زودهنگام اکنون" q={v.exit.quality}>{usd(v.exit.proceedsUsd)}</Stat>
        </div>
        <p className="text-xs text-muted">واحد بازخرید: ۱ PT = ۱ {p.assetSymbol || 'واحد دارایی پایه'} در سررسید. ارزش دلاری آن با قیمت همان دارایی تغییر می‌کند؛ PT معادل یک دلار فرض نشده است.</p>
      </Card>
    );
  }
  if (p.kind === 'yt') {
    const scenario = v.points * p.points.valuePerPoint;
    return (
      <Card title="محاسبات YT" icon={<Gift size={18} />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="ارزش فروش توکن" q={v.tokenPrice.quality}>{usd(v.markValueUsd)}</Stat>
          <Stat label="سود دریافت‌شده" hint="ثبت‌شده توسط شما">{usd(v.ledger.incomeYieldUsd)}</Stat>
          <Stat label="سود انباشته‌ی دریافت‌نشده" q={v.unclaimedYield.quality}>{usd(v.unclaimedYield.value)}</Stat>
          <Stat label="بازده پایه‌ی فعلی" q={quote ? v.tokenPrice.quality : 'missing'}>{quote ? <Num>{formatPercent(quote.baseAPY, 2)}</Num> : '—'}</Stat>
        </div>
        <p className="text-xs text-muted">
          {v.unclaimedYield.quality === 'historical'
            ? 'سود انباشته از سابقه‌ی روزانه‌ی بازده بازار محاسبه شده است.'
            : v.unclaimedYield.quality === 'manual'
              ? 'سود انباشته از عددی است که دستی وارد کرده‌اید.'
              : 'سابقه‌ی روزانه‌ی بازده در دسترس نیست؛ سود انباشته با نرخ فعلی تخمین زده شده. عدد دقیق را از پلتفرم بخوانید و دستی وارد کنید.'}
        </p>
        <div className="rounded-xl border border-dashed border-strong p-3 flex flex-col gap-2">
          <div className="text-sm font-bold text-secondary">سناریوی پوینت و ایردراپ (جدا از سود قطعی)</div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="پوینت تخمینی تا امروز" q="estimate"><Num>{formatNumber(v.points, 0)}</Num></Stat>
            <NumberField label="ارزش فرضی هر پوینت" value={p.points.valuePerPoint} onChange={(valuePerPoint) => onSave({ ...p, points: { ...p.points, valuePerPoint } })} suffix="$" />
          </div>
          <p className="text-sm text-secondary">
            اگر هر پوینت <Num>{formatUSD(p.points.valuePerPoint, 6)}</Num> بیارزد: <Num className="font-bold">{formatUSD(scenario)}</Num> — فرضی و خارج از سود و زیان.
          </p>
        </div>
      </Card>
    );
  }
  const h = v.loop;
  const lp = p.loop!;
  return (
    <Card title="محاسبات PT Loop" icon={<ShieldAlert size={18} />}>
      {h ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="شاخص سلامت" q={h.quality}>
            <span className={h.healthFactor < 1.1 ? 'text-danger' : h.healthFactor < 1.3 ? 'text-warning' : 'text-success'}>
              {h.healthFactor < 1.1 ? '⚠ ' : ''}
              <Num>{Number.isFinite(h.healthFactor) ? formatNumber(h.healthFactor, 3) : '∞'}</Num>
            </span>
          </Stat>
          <Stat label="فاصله تا لیکویید شدن" q={h.quality} hint={<>قیمت لیکویید PT: <Num>{formatNumber(h.liquidationPtPrice, 4)}</Num></>}>
            <Num>{formatPercent(h.dropToLiquidation, 2)}</Num> افت قیمت PT
          </Stat>
          <Stat label="Implied APY لیکویید شدن" q={h.quality}>{Number.isFinite(h.liquidationAPY) ? <Num>{formatPercent(h.liquidationAPY, 2)}</Num> : '—'}</Stat>
          <Stat label="اهرم فعلی"><Num>{formatNumber(h.leverage, 2)}×</Num></Stat>
          <Stat label="وثیقه (ارزش بازار)">{usd(h.collateralUsd)}</Stat>
          <Stat label="بدهی با بهره" q={h.debtQuality}>{usd(h.debtUsd)}</Stat>
          <Stat label="نرخ بهره / LLTV"><Num>{formatPercent(lp.borrowAPY, 2)}</Num> / <Num>{formatPercent(lp.lltv, 1)}</Num></Stat>
          <Stat label="بازار وام‌دهی"><span dir="ltr" className="text-sm">{lp.lendingPlatform || '—'} {lp.lendingMarket}</span></Stat>
        </div>
      ) : (
        <p className="text-sm text-secondary">وثیقه‌ای باقی نمانده است.</p>
      )}
      <p className="text-xs text-muted">
        {lp.oracle === 'unknown'
          ? 'اوراکل بازار وام‌دهی مشخص نشده؛ سلامت با قیمت بازار PT تخمین زده شده. بسیاری از بازارها از اوراکل خطی یا TWAP استفاده می‌کنند؛ عدد پلتفرم را مبنا قرار دهید.'
          : lp.oracle === 'manual'
            ? 'سلامت با قیمت اوراکلی که دستی وارد کرده‌اید محاسبه شده.'
            : 'سلامت با قیمت بازار PT محاسبه شده.'}{' '}
        {h?.debtQuality === 'estimate' ? `بدهی با نرخ ثبت‌شده‌ی ${formatPercent(lp.borrowAPY, 2)} تخمین زده شده؛ برای دقت، بدهی فعلی را از پلتفرم وارد کنید.` : ''}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <NumberField label={`بدهی فعلی طبق پلتفرم (${lp.debtAsset})`} value={debtNow} onChange={setDebtNow} />
        </div>
        <button type="button" disabled={!(debtNow >= 0)} onClick={() => onSave({ ...p, loop: { ...lp, debtOverride: { amount: debtNow, at: new Date().toISOString() } } })} className="rounded-xl border border-strong px-3 py-2.5 text-sm text-secondary disabled:opacity-40">
          ثبت
        </button>
        {lp.debtOverride && (
          <button type="button" onClick={() => onSave({ ...p, loop: { ...lp, debtOverride: null } })} className="rounded-xl px-3 py-2.5 text-sm text-danger">
            حذف عدد دستی ({formatNumber(lp.debtOverride.amount, 2)})
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <NumberField label="نرخ بهره‌ی فعلی وام" value={lp.borrowAPY} onChange={(borrowAPY) => onSave({ ...p, loop: { ...lp, borrowAPY } })} suffix="%" />
        <NumberField label="LLTV" value={lp.lltv} onChange={(lltv) => onSave({ ...p, loop: { ...lp, lltv } })} suffix="%" />
      </div>
    </Card>
  );
}

export function AnalysisPanel({ x }: { x: PositionView }) {
  const { a } = x;
  return (
    <Card title="تحلیل نگهداری و خروج" icon={<Scale size={18} />}>
      <ul className="flex flex-col gap-1.5 text-sm text-primary list-disc pr-5">
        {a.summary.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {a.scenarios.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs text-right">
                <th className="py-1 font-normal">سناریو</th>
                <th className="py-1 font-normal">نتیجه</th>
                <th className="py-1 font-normal">در مقایسه با خروج اکنون</th>
              </tr>
            </thead>
            <tbody>
              {a.scenarios.map((s) => (
                <tr key={s.label} className="border-t border-default align-top">
                  <td className="py-2">
                    <div className="text-primary">{s.label}</div>
                    <div className="text-[11px] text-muted">{s.assumption}</div>
                  </td>
                  <td className="py-2">{usd(s.valueUsd)}</td>
                  <td className="py-2"><Pnl usd={s.vsExitUsd} size="sm" word={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.triggers.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-secondary">چه چیزی خروج را منطقی‌تر می‌کند؟</h3>
          <ul className="flex flex-col gap-1 text-sm text-primary list-disc pr-5">
            {a.triggers.map((t, i) => (
              <li key={i}>{t.text}</li>
            ))}
          </ul>
        </div>
      )}
      {a.assumptions.length > 0 && (
        <details className="text-xs text-secondary">
          <summary className="text-muted">فرض‌ها و کیفیت داده</summary>
          <ul className="list-disc pr-5 mt-1 flex flex-col gap-0.5">
            {a.assumptions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[11px] text-muted">هیچ تاریخ خروج یا سود آینده‌ای قطعی نیست و هیچ معامله‌ای خودکار انجام نمی‌شود.</p>
    </Card>
  );
}

/** Loads every market only when this panel is open (PT positions). */
function SwitchPanel({ x }: { x: PositionView }) {
  const { markets, loading } = useAllMarkets();
  const [s, setS] = useState<SwitchSettings>(defaultSwitchSettings);
  const current = markets.find((m) => m.id === x.p.marketId && m.protocol === x.p.protocol) ?? null;
  const res = useMemo(() => compareMarkets(x.p, x.v, markets, current, s), [x.p, x.v, markets, current, s]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-secondary">
        افق مقایسه از امروز تا سررسید همین پوزیشن ({fmtDays(x.v.daysLeft)}) است: خروج اکنون (پس از هزینه)، انتقال، ورود به بازار دیگر (پس از کارمزد و لغزش) و ارزش آن در همان افق. فقط دارایی‌های هم‌دسته با نقدینگی کافی مقایسه می‌شوند و APY بالاتر به‌تنهایی دلیل پیشنهاد نیست.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="کارمزد ورود" value={s.entryFeePct} onChange={(entryFeePct) => setS({ ...s, entryFeePct })} suffix="%" />
        <NumberField label="هزینه‌ی انتقال بین شبکه" value={s.bridgeUsd} onChange={(bridgeUsd) => setS({ ...s, bridgeUsd })} suffix="$" />
        <NumberField label="حداقل مزیت معنادار" value={s.minAdvantagePct} onChange={(minAdvantagePct) => setS({ ...s, minAdvantagePct })} suffix="%" />
      </div>
      {loading && !markets.length ? (
        <p className="text-sm text-secondary flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> در حال دریافت بازارها…</p>
      ) : !res.length ? (
        <p className="text-sm text-secondary">بازار قابل مقایسه‌ای با نقدینگی کافی پیدا نشد، یا داده‌ی این پوزیشن برای مقایسه کافی نیست.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {res.map((c) => (
            <li key={`${c.m.protocol}:${c.m.id}`} className={`rounded-xl border p-3 flex flex-col gap-1.5 ${c.meaningful ? 'border-success/40' : 'border-default'}`}>
              <div className="flex items-center gap-2">
                <TokenLogo src={c.m.icon} name={c.m.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-primary truncate" dir="ltr">PT {c.m.name}</div>
                  <div className="text-[11px] text-muted">
                    <span dir="ltr">{protocols[c.m.protocol].name}</span> · {chainFa(c.m.chain)} · Implied <Num>{formatPercent(c.m.impliedAPY, 2)}</Num> · <Num>{formatNumber(c.m.daysToMaturity, 0)}</Num> روز
                  </div>
                </div>
                <div className="text-left">
                  <Pnl usd={c.advantageUsd} pct={c.advantagePct} size="sm" word={false} />
                  <div className="text-[11px] text-muted">{c.meaningful ? 'مزیت معنادار' : 'مزیت ناچیز یا پرریسک'}</div>
                </div>
              </div>
              {c.risks.length > 0 && <p className="text-[11px] text-warning">⚠ {c.risks.join('؛ ')}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">فرض: قیمت دلاری دارایی ثابت و نرخ بازار جدید تا افق مقایسه بدون تغییر. کیفیت داده: خروج و ورود تخمینی.</p>
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
        <NumberField label={label} value={t[k] ?? NaN} onChange={(v) => set(k, v)} suffix={suffix} />
      </div>
      {t[k] !== null && (
        <button type="button" onClick={() => set(k, null)} className="p-2.5 text-muted" aria-label={`خاموش کردن ${label}`}>
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {field('takeProfitPct', 'هدف سود', '%')}
      {field('stopLossPct', 'سقف زیان', '%')}
      {p.kind === 'loop' && field('minHealth', 'حداقل شاخص سلامت')}
    </div>
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
      <div className="w-48">
        <NumberField label={label} value={value} onChange={setV} />
      </div>
      <button type="button" disabled={!(value >= 0)} onClick={() => onSave({ ...p, manual: { ...p.manual, [key]: { value, at: now() } } })} className="rounded-xl border border-strong px-3 py-2.5 text-sm text-secondary disabled:opacity-40">
        ثبت
      </button>
      {current && (
        <button type="button" onClick={() => onSave({ ...p, manual: { ...p.manual, [key]: null } })} className="rounded-xl px-3 py-2.5 text-sm text-danger">
          حذف ({formatNumber(current.value, 6)}، {formatDateTime(current.at)})
        </button>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-secondary">عدد دستی تا وقتی حذف نشود جایگزین داده‌ی بازار می‌شود و با برچسب «دستی» نمایش داده می‌شود.</p>
      {row(`قیمت ${p.kind === 'yt' ? 'YT' : 'PT'} (${p.assetSymbol || 'واحد دارایی'})`, price, setPrice, 'tokenPrice', p.manual.tokenPrice)}
      {row(`قیمت دلاری ${p.assetSymbol || 'دارایی پایه'}`, asset, setAsset, 'assetUsd', p.manual.assetUsd)}
      {p.kind === 'yt' && row(`سود دریافت‌نشده طبق پلتفرم (${p.assetSymbol || 'واحد دارایی'})`, yieldV, setYieldV, 'unclaimedYield', p.manual.unclaimedYield)}
    </div>
  );
}

function Events({ x, onSave }: { x: PositionView; onSave: (p: Position) => void }) {
  const { p, quote } = x;
  const [adding, setAdding] = useState(false);
  const sorted = [...p.events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <EventForm
          types={EVENT_TYPES[p.kind]}
          assetSymbol={p.assetSymbol}
          liveAssetUsd={quote?.assetUsd ?? null}
          defaultToken={p.assetSymbol}
          onSubmit={(e) => {
            onSave({ ...p, events: [...p.events, e] });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="self-start flex items-center gap-1.5 rounded-xl border border-accent/60 px-3 py-2 text-sm text-primary">
          <Plus size={15} /> ثبت رویداد (خرید مجدد، فروش، بازخرید، دریافت سود یا پاداش، وام و بازپرداخت)
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {sorted.map((e) => (
          <li key={e.id} className="rounded-xl border border-default p-3 text-sm flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-primary">{EVENT_FA[e.type]}</span>
              <span className="text-xs text-muted">{formatDateTime(e.at)}</span>
            </div>
            <div className="text-secondary flex flex-wrap gap-x-3">
              {e.units > 0 && <span><Num>{formatNumber(e.units, 4)}</Num> توکن</span>}
              <span>
                <Num>{formatNumber(e.cash.amount, 6)}</Num> <span dir="ltr">{e.cash.token}</span>
                {e.cash.usdRate !== null ? <> (<Num>{formatUSD(e.cash.amount * e.cash.usdRate)}</Num>، {RATE_FA[e.cash.rateSource]})</> : <span className="text-warning"> (نرخ دلاری نامعلوم)</span>}
              </span>
              {e.assetUsd === null && <span className="text-warning">نرخ دارایی نامعلوم</span>}
            </div>
            {e.fees.map((f, i) => (
              <div key={i} className="text-xs text-muted">
                {FEE_FA[f.kind]}: <Num>{formatNumber(f.amount, 6)}</Num> <span dir="ltr">{f.token}</span>
                {f.usdRate !== null && <> (<Num>{formatUSD(f.amount * f.usdRate)}</Num>)</>} · {f.included ? 'داخل مبلغ حساب شده' : 'جداگانه پرداخت شده'}
              </div>
            ))}
            {e.note && <div className="text-xs text-muted">{e.note}</div>}
            <button
              type="button"
              className="self-end text-xs text-danger flex items-center gap-1"
              onClick={() => {
                if (window.confirm('این رویداد حذف شود؟ محاسبات از نو انجام می‌شود.')) onSave({ ...p, events: p.events.filter((y) => y.id !== e.id) });
              }}
            >
              <Trash2 size={13} /> حذف
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PositionDetail({ id }: { id: string }) {
  const router = useRouter();
  const { positions, views, save, remove, refresh, refreshing, updatedAt } = usePortfolioView();
  const x = views.find((y) => y.p.id === id);

  if (positions === null) {
    return (
      <main className="grid place-items-center py-24 text-secondary">
        <Loader2 className="animate-spin" />
      </main>
    );
  }
  if (!x) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10 flex flex-col items-center gap-3 text-secondary">
        پوزیشن پیدا نشد. ممکن است در مرورگر دیگری ثبت شده باشد.
        <Link href="/portfolio" className="text-accent underline">بازگشت به پرتفوی</Link>
      </main>
    );
  }

  const { p, v } = x;
  const onSave = (np: Position) => save(np);

  return (
    <main className="max-w-matrix mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link href="/portfolio" className="text-sm text-secondary flex items-center gap-1">
          <ArrowRight size={14} /> پرتفوی من
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <MarketIdentity p={p} size={48} />
          <div className="flex items-center gap-2">
            <StatusBadge s={v.status} />
            <button type="button" onClick={refresh} disabled={refreshing} className="flex items-center gap-1.5 rounded-xl border border-strong px-3 py-1.5 text-sm text-secondary hover:text-primary disabled:opacity-50">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> تازه‌سازی
            </button>
          </div>
        </div>
        <p className="text-xs text-muted">
          {updatedAt ? <>آخرین دریافت داده: <Num>{formatDateTime(new Date(updatedAt).toISOString())}</Num></> : 'در حال دریافت داده…'}
          {x.q?.error && <span className="text-warning"> · {x.q.error}؛ آخرین داده‌ی موجود «قدیمی» نمایش داده می‌شود.</span>}
          {v.ledger.units <= EPS && v.status !== 'closed' && ' · توکنی باقی نمانده'}
        </p>
      </header>

      <AlertList alerts={x.alerts} />
      <Answers x={x} />
      <Numbers x={x} />
      <KindPanel x={x} onSave={onSave} />
      {v.status !== 'closed' && <AnalysisPanel x={x} />}
      {p.kind === 'pt' && v.status === 'open' && (
        <Collapsible title="مقایسه با بازارهای دیگر" icon={<ArrowLeftRight size={18} />}>
          <SwitchPanel x={x} />
        </Collapsible>
      )}
      {p.kind !== 'pt' && v.status === 'open' && (
        <p className="text-xs text-muted">
          مقایسه‌ی خودکار با بازارهای دیگر فعلاً فقط برای PT انجام می‌شود؛ نتیجه‌ی {p.kind === 'yt' ? 'YT به ارزش پوینت' : 'لوپ به نرخ وام و اوراکل هر بازار'} بستگی دارد. برای بررسی دستی به <Link href="/opportunities" className="text-accent underline">فرصت‌ها</Link> بروید.
        </p>
      )}
      <Collapsible title="اهداف و هشدارها" icon={<Target size={18} />}>
        <Targets x={x} onSave={onSave} />
      </Collapsible>
      <Collapsible title="ثبت دستی قیمت و موجودی" icon={<Settings2 size={18} />}>
        <ManualMarks x={x} onSave={onSave} />
      </Collapsible>
      <Collapsible title="سوابق معامله" icon={<History size={18} />} defaultOpen>
        <Events x={x} onSave={onSave} />
      </Collapsible>
      <Collapsible title="عملکرد ثبت‌شده" icon={<History size={18} />}>
        <SnapshotChart label="سود و زیان ثبت‌شده‌ی پوزیشن" points={p.snapshots.map((s) => ({ t: new Date(s.at).getTime(), y: s.pnlUsd }))} />
      </Collapsible>

      <NoWalletNote />
      <button
        type="button"
        className="self-start flex items-center gap-1.5 text-sm text-danger"
        onClick={() => {
          if (window.confirm('این پوزیشن و همه‌ی سوابق آن حذف شود؟')) {
            remove(p.id);
            router.push('/portfolio');
          }
        }}
      >
        <Trash2 size={15} /> حذف پوزیشن
      </button>
    </main>
  );
}
