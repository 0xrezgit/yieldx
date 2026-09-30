'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { buckets, leaderLoop, leaderYt, type LeaderRow, type LeaderStrategy, type RankBy, type Verdict } from '../../lib/risk/leaderboard';
import { defaultLoopSettings, defaultScreenSettings, type LoopSettings, type OpportunityListing } from '../../lib/risk/opportunities';
import { maxLoopLeverage } from '../../lib/calculators/trade';
import { formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { Empty, Pill, Segmented, signedPct } from '../opportunities/parts';
import type { Tone } from '../ui/badge';

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  // Only a comparison with the user's minimum return — not an endorsement.
  worth: { label: 'بالای حداقل بازده', tone: 'success' },
  thin: { label: 'زیر حداقل بازده', tone: 'warning' },
  loss: { label: 'زیان', tone: 'danger' },
  free: { label: 'پوینت رایگان', tone: 'success' },
  cheap: { label: 'ضرر کم', tone: 'warning' },
  costly: { label: 'پرهزینه', tone: 'danger' },
};

const money = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

const calcHref = (m: OpportunityListing) => `/dashboard?${new URLSearchParams({ protocol: m.protocol, market: m.id, name: m.name, maturity: m.maturity })}`;

function Row({ row, rank, strategy }: { row: LeaderRow; rank: number; strategy: LeaderStrategy }) {
  const { m } = row;
  const v = VERDICT[row.verdict];
  return (
    <Link href={calcHref(m)} className="w-full flex items-center gap-3 py-2.5 min-h-14 text-right rounded-lg hover:bg-elevated px-1 transition-colors">
      <span className="grid place-items-center size-6 rounded-full bg-elevated text-xs text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} />
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <Pill tone={v.tone}>{v.label}</Pill>
          {strategy === 'yt' ? (
            <Pill>
              خروج روز <Num>{formatNumber(row.days, 0)}</Num>
              {row.days === m.daysToMaturity && ' (سررسید)'}
            </Pill>
          ) : (
            <Pill>
              تا سررسید · <Num>{formatNumber(row.days, 0)}</Num> روز
            </Pill>
          )}
          {row.freeUntil !== null && (
            <Pill tone="success">
              بی‌ضرر تا روز <Num>{formatNumber(row.freeUntil, 0)}</Num>
            </Pill>
          )}
          {row.pointsExposure !== null && m.hasPoints && (
            <Pill tone="warning">
              پوینت روی <Num>{formatUSDCompact(row.pointsExposure)}</Num>
            </Pill>
          )}
          {row.tooBig && <Pill tone="danger">بزرگ نسبت به نقدینگی</Pill>}
          {strategy === 'yt' && m.baseAPY !== null && m.baseAPY - m.impliedAPY > 5 && m.baseAPY > 2 * m.impliedAPY && <Pill tone="warning">بازده پایه احتمالاً موقت</Pill>}
        </div>
      </div>
      <div className="text-left shrink-0">
        <div className={`font-semibold text-lg leading-tight ${row.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
          <Num>{money(row.pnl)}</Num>
        </div>
        <div className="text-xs text-secondary">
          <Num>{signedPct(row.pnlPercent, 2)}</Num> · سالانه {row.annualized > 9999 ? <>بیش از <Num>{formatPercent(9999, 0)}</Num></> : <Num>{signedPct(row.annualized, 1)}</Num>}
        </div>
        <div className="text-xs text-muted">
          Implied <Num>{formatPercent(m.impliedAPY, 1)}</Num>
        </div>
        <div className="text-xs text-muted">
          <Num>{money(row.perDay)}</Num> در روز
        </div>
      </div>
    </Link>
  );
}

function Bucket({ title, icon, cls, rows, strategy }: { title: string; icon: ReactNode; cls: string; rows: LeaderRow[]; strategy: LeaderStrategy }) {
  return (
    <section className="sx-card p-4 flex flex-col gap-2 min-w-0">
      <h2 className={`font-semibold flex items-center gap-2 ${cls}`}>
        {icon} {title}
        <span className="text-xs text-muted font-normal">
          (<Num>{formatNumber(rows.length, 0)}</Num>)
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">بازاری در این دسته نیست.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-default">
          {rows.map((row, i) => (
            <li key={`${row.m.protocol}-${row.m.id}`}>
              <Row row={row} rank={i + 1} strategy={strategy} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Suggestion({ rows, strategy }: { rows: LeaderRow[]; strategy: LeaderStrategy }) {
  const good = rows.filter((r) => (strategy === 'yt' ? r.verdict === 'free' : r.verdict === 'worth') && !r.tooBig);
  const total = [...good].sort((a, b) => b.pnl - a.pnl)[0];
  const daily = [...good].sort((a, b) => b.perDay - a.perDay)[0];
  const line = (label: string, r: LeaderRow | undefined) =>
    r && (
      <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-secondary">{label}:</span>
        <AssetIdentity symbol={r.m.name} icon={r.m.icon} chain={r.m.chain} protocol={r.m.protocol} maturity={r.m.maturity} size={24} compact />
        <span className="text-success font-semibold">
          <Num>{money(r.pnl)}</Num>
        </span>
        <span className="text-xs text-muted">
          (<Num>{money(r.perDay)}</Num> در روز)
        </span>
      </li>
    );
  return (
    <section className="sx-card p-4 flex flex-col gap-2 text-sm" aria-label="پیشنهاد">
      <h2 className="font-semibold text-primary">پیشنهاد</h2>
      {total ? (
        <ul className="flex flex-col gap-2">
          {line('بیشترین سود کل', total)}
          {daily && daily !== total && line('بیشترین سود در هر روز', daily)}
        </ul>
      ) : (
        <p className="text-secondary">{strategy === 'yt' ? 'با این فرض‌ها هیچ YTی بی‌ضرر نیست.' : 'با این نرخ وام و اهرم هیچ لوپی از حداقل بازده بالاتر نیست.'}</p>
      )}
      <p className="text-xs text-muted">فقط بر پایه‌ی همین فرض‌ها؛ نقدینگی، ریسک لیکوییدشدن و بازار وام واقعی را پیش از ورود بررسی کنید.</p>
    </section>
  );
}

/**
 * Dollar leaderboards beside the market analysis, for every Pendle, Spectra and
 * Exponent market and the capital: YT sold on its best day at today's implied APY,
 * or a PT loop held to maturity at the leverage and borrow rate the user enters.
 * Fifteen each for the biggest and smallest profit and loss, and a suggestion.
 * Separate views with their own assumptions, never mixed into the market analysis.
 */
export function LeaderRanking({ markets, capital, strategy }: { markets: OpportunityListing[]; capital: number; strategy: LeaderStrategy }) {
  const [fee, setFee] = useState(defaultScreenSettings.feePercent);
  const [by, setBy] = useState<RankBy>('total');
  const [pointsOnly, setPointsOnly] = useState(false);
  const [loop, setLoop] = useState<LoopSettings>(defaultLoopSettings);
  const [hurdle, setHurdle] = useState(8);
  const s = useMemo(() => ({ ...defaultScreenSettings, feePercent: Number.isFinite(fee) ? Math.max(0, fee) : 0 }), [fee]);
  const rows = useMemo(() => {
    if (!(capital > 0)) return [];
    if (strategy === 'loop') return leaderLoop(markets, s, loop, { capital, hurdle: Number.isFinite(hurdle) ? hurdle : 8 });
    return leaderYt(markets, s, { capital }, pointsOnly);
  }, [markets, s, capital, pointsOnly, strategy, loop, hurdle]);
  const b = useMemo(() => buckets(rows, by), [rows, by]);
  const gains = rows.filter((x) => x.pnl >= 0).length;
  const count = (p: string) => rows.filter((r) => r.m.protocol === p).length;
  const safe = maxLoopLeverage(loop.lltv, 1);
  const num = (v: number, d: number) => (Number.isFinite(v) ? v : d);

  if (!(capital > 0)) return <Empty>سرمایه‌ی اولیه را وارد کنید.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-[10rem_minmax(0,1fr)_auto] gap-3 items-end">
          <NumberField label="کارمزد هر معامله" value={fee} onChange={setFee} suffix="%" />
          <Segmented<RankBy> value={by} onChange={setBy} label="مرتب‌سازی" size="sm" options={[{ id: 'total', label: 'سود کل دلاری' }, { id: 'perDay', label: 'سود در هر روز' }]} />
          {strategy === 'yt' && (
            <label className="flex items-center gap-2 text-sm text-secondary min-h-10">
              <input type="checkbox" checked={pointsOnly} onChange={(e) => setPointsOnly(e.target.checked)} className="accent-accent size-4" />
              فقط پوینت‌دار
            </label>
          )}
        </div>
        {strategy === 'loop' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumberField label="اهرم" value={loop.leverage} onChange={(v) => setLoop({ ...loop, leverage: num(v, 1) })} suffix="×" warning={loop.leverage >= safe ? 'در این LLTV لیکویید می‌شود.' : undefined} />
            <NumberField label="بهره‌ی وام" value={loop.borrowAPY} onChange={(v) => setLoop({ ...loop, borrowAPY: num(v, 0) })} suffix="%" />
            <NumberField label="LLTV" value={loop.lltv} onChange={(v) => setLoop({ ...loop, lltv: num(v, 0) })} suffix="%" />
            <NumberField label="حداقل بازده سالانه" value={hurdle} onChange={setHurdle} suffix="%" />
          </div>
        )}
      </section>
      <p className="text-xs text-secondary leading-6">
        {strategy === 'yt' ? 'خرید YT و فروش در بهترین روز با Implied APY امروز (فرض ثابت ماندن نرخ بازار)، بدون ارزش پوینت.' : 'لوپ PT تا سررسید با اهرم، بهره‌ی وام و LLTV بالا (فرض شما، ثابت تا سررسید).'}{' '}
        <Num>{formatNumber(rows.length, 0)}</Num> بازار: <bdi dir="ltr">Pendle</bdi> <Num>{formatNumber(count('pendle'), 0)}</Num> · <bdi dir="ltr">Spectra</bdi> <Num>{formatNumber(count('spectra'), 0)}</Num> · <bdi dir="ltr">Exponent</bdi>{' '}
        <Num>{formatNumber(count('exponent'), 0)}</Num> ·{' '}
        <span className="text-success">
          <Num>{formatNumber(gains, 0)}</Num> سودده
        </span>{' '}
        ·{' '}
        <span className="text-danger">
          <Num>{formatNumber(rows.length - gains, 0)}</Num> زیان‌ده
        </span>
      </p>
      <Suggestion rows={rows} strategy={strategy} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Bucket title="بیشترین سود" icon={<TrendingUp size={18} aria-hidden />} cls="text-success" rows={b.topProfit} strategy={strategy} />
        <Bucket title="کمترین سود" icon={<ArrowUpRight size={18} aria-hidden />} cls="text-info" rows={b.leastProfit} strategy={strategy} />
        <Bucket title="کمترین ضرر" icon={<ArrowDownRight size={18} aria-hidden />} cls="text-warning" rows={b.leastLoss} strategy={strategy} />
        <Bucket title="بیشترین ضرر" icon={<TrendingDown size={18} aria-hidden />} cls="text-danger" rows={b.topLoss} strategy={strategy} />
      </div>
    </div>
  );
}
