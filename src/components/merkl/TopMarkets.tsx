'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lpLink } from '../opportunities/LpAnalyzer';
import { isDollarLike } from '../../lib/merkl/vetting';
import { ChevronDown, CircleSlash, Trophy } from 'lucide-react';
import { reasonCounts, type Estimate, type Ranking } from '../../lib/merkl/profit';
import { formatAgo, formatDate, formatGregorian, formatNumber, formatPercent } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { Num } from '../ui/num';
import { Empty, Pill } from '../opportunities/parts';
import { days, EstimateDetails, usd } from './MerklDetails';
import { ConfidencePill, lookAlikes, OppIdentity, WatchStar } from './parts';

const iso = (sec: number) => new Date(sec * 1000).toISOString();

function Row({ e, rank, showId, watched, toggleWatch }: { e: Estimate; rank: number; showId: boolean; watched: boolean; toggleWatch: () => void }) {
  const [open, setOpen] = useState(false);
  const { o } = e;
  const end = Math.min(...e.campaigns.filter((x) => x.usdPerDay !== null).map((x) => x.c.end));
  const counted = Math.min(e.horizon, e.daysToEnd);
  return (
    <li className="flex flex-col">
      <div className="flex items-start gap-1">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex-1 min-w-0 flex items-start gap-3 py-3 text-right rounded-lg hover:bg-elevated px-1 transition-colors">
          <span className="grid place-items-center size-7 mt-0.5 rounded-full bg-elevated text-xs font-semibold text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
          <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <OppIdentity o={o} showId={showId} />
            <div className="flex flex-wrap items-center gap-1">
              <ConfidencePill level={e.confidence} />
              {e.meme && <Pill tone="danger">میم‌کوین · ریسک بسیار بالا</Pill>}
              <Pill>
                <Num>{usd(e.capital)}</Num> · <Num>{days(counted)}</Num> روز
              </Pill>
              <Pill tone="info">
                مشوق برای شما <Num>{formatPercent(e.incentiveApr, 1)}</Num>
                <span className="text-muted">
                  {' '}
                  (Merkl <Num>{formatPercent(o.apr, 1)}</Num>)
                </span>
              </Pill>
              <Pill>
                <span title={`میلادی: ${formatGregorian(iso(end))}`}>پایان {formatDate(iso(end))}</span>
              </Pill>
            </div>
          </div>
          <div className="shrink-0 flex flex-wrap sm:flex-col items-baseline sm:items-end gap-x-3 gap-y-0.5 text-right sm:text-left">
            <div className={`font-semibold text-lg leading-tight ${e.net >= 0 ? 'text-success' : 'text-danger'}`}>
              <Num>{usd(e.net)}</Num>
            </div>
            <div className="text-xs text-muted">{e.unknownCosts.length ? 'خالص پس از هزینه‌های لحاظ‌شده' : 'سود خالص برآوردی'}</div>
            <div className="text-xs text-secondary">
              محتاطانه <Num>{usd(e.netLow)}</Num>
            </div>
            <ChevronDown size={16} className={`self-center sm:self-end sm:mt-1 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </div>
          </div>
        </button>
        <div className="pt-2.5">
          <WatchStar on={watched} onToggle={toggleWatch} name={o.name} />
        </div>
      </div>
      {open && (
        <div className="px-1 pb-4 pt-3 border-t border-default">
          <EstimateDetails e={e} />
        </div>
      )}
    </li>
  );
}

/**
 * «۳۰ بازار برتر Merkl»: up to thirty admissible markets ranked by estimated net
 * profit for the user's capital over one common horizon. What has no estimate is
 * listed with its reason, never filled in.
 */
export function TopMarkets({ ranking, watch, toggleWatch, horizon, dataAt }: { ranking: Ranking; watch: ReadonlySet<string>; toggleWatch: (id: string) => void; horizon: number; dataAt: number | null }) {
  const { rows, pools, noEstimate, excluded, total } = ranking;
  const alike = lookAlikes(rows.map((r) => r.o));
  const noReasons = reasonCounts(noEstimate);
  const exReasons = reasonCounts(excluded);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-secondary leading-7">
        <Num>{formatNumber(rows.length, 0)}</Num> بازار از <Num>{formatNumber(total, 0)}</Num> بازار قابل برآورد، به ترتیب سود خالص برآوردی در <Num>{formatNumber(horizon, 0)}</Num> روز
        {dataAt !== null && <> · قدیمی‌ترین داده‌ی به‌کاررفته {formatAgo(dataAt * 1000)}</>}. برآورد با نرخ، قیمت و هزینه‌های همین حالاست؛ سود قطعی نیست.
      </p>

      {rows.length === 0 ? (
        <Empty>با این مبلغ و فیلترها بازاری با سود خالص برآوردی مثبت نیست.</Empty>
      ) : (
        <section className="sx-card p-3 sm:p-4 flex flex-col gap-2 min-w-0">
          <h2 className="font-semibold flex items-center gap-2 text-success px-1">
            <Trophy size={18} aria-hidden /> ۳۰ بازار برتر Merkl
          </h2>
          <ol className="flex flex-col divide-y divide-default">
            {rows.map((e, i) => (
              <Row key={e.o.id} e={e} rank={i + 1} showId={alike.has(e.o.id)} watched={watch.has(e.o.id)} toggleWatch={() => toggleWatch(e.o.id)} />
            ))}
          </ol>
        </section>
      )}

      {pools.length > 0 && (
        <Collapsible
          title="استخرهای نقدینگی (LP) — تحلیل تخصصی"
          icon={<CircleSlash size={18} aria-hidden />}
          badge={
            <span className="text-xs text-muted font-normal">
              (<Num>{formatNumber(pools.length, 0)}</Num>)
            </span>
          }
        >
          <p className="text-sm text-secondary leading-7">
            در رتبه‌بندی عمومی نیستند: کارمزد و پاداش استخر حساب شده، ولی تغییر ارزش دو دارایی (زیان ناپایدار) به دلار مدل نشده و بدون آن سود خالص قابل دفاع نیست. عدد کنار هر استخر فقط کارمزد و پاداش منهای هزینه‌هاست.
          </p>
          <ol className="flex flex-col divide-y divide-default">
            {pools.slice(0, 30).map((e, i) => {
              const toks = e.o.tokens.filter((t) => t.type === 'TOKEN');
              const href = lpLink({
                name: e.o.name,
                a: toks[0]?.symbol,
                b: toks[1]?.symbol,
                stable: toks.length > 1 && toks.every(isDollarLike),
                feeApr: e.native.counted ? e.native.apr : null,
                rewardUsd: e.incentiveUsd,
                capital: e.capital,
                days: e.horizon,
              });
              return (
                <div key={e.o.id} className="flex flex-col">
                  <Row e={e} rank={i + 1} showId={alike.has(e.o.id)} watched={watch.has(e.o.id)} toggleWatch={() => toggleWatch(e.o.id)} />
                  <Link href={href} className="tap self-start mb-3 ms-10 inline-flex items-center gap-1.5 rounded-lg border border-control px-3 min-h-9 text-sm text-primary hover:bg-elevated">
                    تحلیل LP با سناریوی قیمت
                  </Link>
                </div>
              );
            })}
          </ol>
        </Collapsible>
      )}

      {noEstimate.length > 0 && (
        <Collapsible
          title="بدون برآورد دلاری و دلیلش"
          icon={<CircleSlash size={18} aria-hidden />}
          badge={
            <span className="text-xs text-muted font-normal">
              (<Num>{formatNumber(noEstimate.length, 0)}</Num>)
            </span>
          }
        >
          <ReasonList reasons={noReasons} />
          <ul className="flex flex-col divide-y divide-default">
            {[...noEstimate]
              .sort((a, b) => b.o.tvl - a.o.tvl)
              .slice(0, 40)
              .map((x) => (
                <li key={x.o.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 justify-between">
                  <OppIdentity o={x.o} size={24} />
                  <span className="text-xs text-secondary sm:text-left sm:max-w-[48%]">{x.reason.label}</span>
                </li>
              ))}
          </ul>
          {noEstimate.length > 40 && <p className="text-xs text-muted">۴۰ مورد با بیشترین TVL نمایش داده شد.</p>}
        </Collapsible>
      )}

      {excluded.length > 0 && (
        <Collapsible
          title="کنار گذاشته در گزینش"
          icon={<CircleSlash size={18} aria-hidden />}
          badge={
            <span className="text-xs text-muted font-normal">
              (<Num>{formatNumber(excluded.length, 0)}</Num>)
            </span>
          }
        >
          <ReasonList reasons={exReasons} />
        </Collapsible>
      )}
    </div>
  );
}

function ReasonList({ reasons }: { reasons: { code: string; label: string; count: number }[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {reasons.map((r) => (
        <li key={r.code} className="flex items-start justify-between gap-3">
          <span className="text-secondary">{r.label}</span>
          <Num className="text-primary shrink-0">{formatNumber(r.count, 0)}</Num>
        </li>
      ))}
    </ul>
  );
}
