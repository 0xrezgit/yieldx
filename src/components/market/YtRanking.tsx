'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { buckets, leaderYt, type LeaderRow, type RankBy, type Verdict } from '../../lib/risk/leaderboard';
import { defaultScreenSettings, type OpportunityListing } from '../../lib/risk/opportunities';
import { formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { Empty, Pill, Segmented, signedPct } from '../opportunities/parts';
import type { Tone } from '../ui/badge';

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  free: { label: 'پوینت رایگان', tone: 'success' },
  cheap: { label: 'ضرر کم', tone: 'warning' },
  costly: { label: 'پرهزینه', tone: 'danger' },
};

const money = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

const calcHref = (m: OpportunityListing) => `/dashboard?${new URLSearchParams({ protocol: m.protocol, market: m.id, name: m.name, maturity: m.maturity })}`;

function Row({ row, rank }: { row: LeaderRow; rank: number }) {
  const { m } = row;
  const v = VERDICT[row.verdict];
  return (
    <Link href={calcHref(m)} className="w-full flex items-center gap-3 py-2.5 min-h-14 text-right rounded-lg hover:bg-elevated px-1 transition-colors">
      <span className="grid place-items-center size-6 rounded-full bg-elevated text-xs text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} />
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <Pill tone={v.tone}>{v.label}</Pill>
          <Pill>
            خروج روز <Num>{formatNumber(row.days, 0)}</Num>
            {row.days === m.daysToMaturity && ' (سررسید)'}
          </Pill>
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
          {m.baseAPY !== null && m.baseAPY - m.impliedAPY > 5 && m.baseAPY > 2 * m.impliedAPY && <Pill tone="warning">بازده پایه احتمالاً موقت</Pill>}
        </div>
      </div>
      <div className="text-left shrink-0">
        <div className={`font-semibold text-lg leading-tight ${row.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
          <Num>{money(row.pnl)}</Num>
        </div>
        <div className="text-xs text-secondary">
          <Num>{signedPct(row.pnlPercent, 2)}</Num> · Implied <Num>{formatPercent(m.impliedAPY, 1)}</Num>
        </div>
        <div className="text-xs text-muted">
          <Num>{money(row.perDay)}</Num> در روز
        </div>
      </div>
    </Link>
  );
}

function Bucket({ title, icon, cls, rows }: { title: string; icon: ReactNode; cls: string; rows: LeaderRow[] }) {
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
              <Row row={row} rank={i + 1} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * «رتبه‌بندی دلاری YT»: the YT of every Pendle, Spectra and Exponent market for the
 * capital, sold on its best day at today's implied APY — fifteen each for the biggest
 * and smallest profit and loss. A separate view with its own assumption, never mixed
 * into the market analysis numbers.
 */
export function YtRanking({ markets, capital }: { markets: OpportunityListing[]; capital: number }) {
  const [fee, setFee] = useState(defaultScreenSettings.feePercent);
  const [by, setBy] = useState<RankBy>('total');
  const [pointsOnly, setPointsOnly] = useState(false);
  const s = useMemo(() => ({ ...defaultScreenSettings, feePercent: Number.isFinite(fee) ? Math.max(0, fee) : 0 }), [fee]);
  const rows = useMemo(() => (capital > 0 ? leaderYt(markets, s, { capital }, pointsOnly) : []), [markets, s, capital, pointsOnly]);
  const b = useMemo(() => buckets(rows, by), [rows, by]);
  const gains = rows.filter((x) => x.pnl >= 0).length;
  const count = (p: string) => rows.filter((r) => r.m.protocol === p).length;

  if (!(capital > 0)) return <Empty>سرمایه‌ی اولیه را وارد کنید.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 grid grid-cols-1 sm:grid-cols-[10rem_minmax(0,1fr)_auto] gap-3 items-end">
        <NumberField label="کارمزد هر معامله" value={fee} onChange={setFee} suffix="%" />
        <Segmented<RankBy> value={by} onChange={setBy} label="مرتب‌سازی" size="sm" options={[{ id: 'total', label: 'سود کل دلاری' }, { id: 'perDay', label: 'سود در هر روز' }]} />
        <label className="flex items-center gap-2 text-sm text-secondary min-h-10">
          <input type="checkbox" checked={pointsOnly} onChange={(e) => setPointsOnly(e.target.checked)} className="accent-accent size-4" />
          فقط پوینت‌دار
        </label>
      </section>
      <p className="text-xs text-secondary leading-6">
        خرید YT و فروش در بهترین روز با Implied APY امروز (فرض ثابت ماندن نرخ بازار)، بدون ارزش پوینت. <Num>{formatNumber(rows.length, 0)}</Num> بازار: <bdi dir="ltr">Pendle</bdi> <Num>{formatNumber(count('pendle'), 0)}</Num> ·{' '}
        <bdi dir="ltr">Spectra</bdi> <Num>{formatNumber(count('spectra'), 0)}</Num> · <bdi dir="ltr">Exponent</bdi> <Num>{formatNumber(count('exponent'), 0)}</Num> ·{' '}
        <span className="text-success">
          <Num>{formatNumber(gains, 0)}</Num> سودده
        </span>{' '}
        ·{' '}
        <span className="text-danger">
          <Num>{formatNumber(rows.length - gains, 0)}</Num> زیان‌ده
        </span>
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Bucket title="بیشترین سود" icon={<TrendingUp size={18} aria-hidden />} cls="text-success" rows={b.topProfit} />
        <Bucket title="کمترین سود" icon={<ArrowUpRight size={18} aria-hidden />} cls="text-info" rows={b.leastProfit} />
        <Bucket title="کمترین ضرر" icon={<ArrowDownRight size={18} aria-hidden />} cls="text-warning" rows={b.leastLoss} />
        <Bucket title="بیشترین ضرر" icon={<TrendingDown size={18} aria-hidden />} cls="text-danger" rows={b.topLoss} />
      </div>
    </div>
  );
}
