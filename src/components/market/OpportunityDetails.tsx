'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Calculator, ExternalLink, Wallet } from 'lucide-react';
import type { Estimate, Opportunity } from '../../types/opportunity';
import type { Evaluated } from '../../lib/market/analysis';
import { HORIZONS, type HorizonDays } from '../../lib/opportunity/policy';
import { PLACEMENT_LABEL } from '../../lib/market/labels';
import { earnFromOpportunity } from '../../lib/portfolio/earn';
import { isAppRoot } from '../../lib/market/links';
import { formatAgo, formatDate, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

export const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 2 : 4);

function Line({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: 'success' | 'danger' | 'muted' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-default last:border-0">
      <span className="text-secondary">{label}</span>
      <span className={tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-muted' : 'text-primary'}>{children}</span>
    </div>
  );
}

const money = (x: number | null) => (x === null ? '—' : <Num>{usd(x)}</Num>);

/** The four horizons side by side: each one's own result, or why it has none. */
function Horizons({ row, active }: { row: Evaluated; active: HorizonDays }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="table" aria-label="مقایسه‌ی افق‌ها">
      {HORIZONS.map((d) => {
        const e = row.byHorizon[d];
        const ok = e.placement === 'ranked' || e.placement === 'unprofitable';
        return (
          <div key={d} role="row" className={`rounded-lg border px-3 py-2 ${d === active ? 'border-accent bg-elevated' : 'border-default'}`}>
            <div className="text-xs text-secondary" role="cell">
              <Num>{formatNumber(d, 0)}</Num> روز
            </div>
            <div role="cell" className={`font-semibold ${ok && e.net !== null ? (e.net > 0 ? 'text-success' : 'text-danger') : 'text-muted text-xs'}`}>
              {ok && e.net !== null ? <Num>{usd(e.net)}</Num> : PLACEMENT_LABEL[e.placement]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TYPE: Record<string, string> = { TOKEN: 'توکن', POINT: 'پوینت', PRETGE: 'پیش از TGE' };

/** Merkl campaigns behind this opportunity; points and unlaunched tokens are shown, never priced. */
function Campaigns({ row, e }: { row: Evaluated; e: Estimate }) {
  const counted = new Set(e.rewardLines.map((l) => l.key));
  const list = row.merkl.flatMap((m) => m.campaigns);
  if (!list.length) return null;
  return (
    <div>
      <h3 className="text-xs text-muted mb-1">کمپین‌های Merkl</h3>
      {list.map((c) => {
        const key = `${c.distributionChainId}:${c.campaignId}`;
        return (
          <Line key={c.id} label={<><bdi dir="ltr">{c.rewardToken.symbol}</bdi> · {TYPE[c.rewardToken.type] ?? c.rewardToken.type} · تا {formatDate(new Date(c.end * 1000).toISOString())}</>} tone={counted.has(key) ? undefined : 'muted'}>
            {counted.has(key) ? 'در سود' : c.rewardToken.type === 'TOKEN' ? 'لحاظ نشد' : 'بدون ارزش دلاری'}
          </Line>
        );
      })}
    </div>
  );
}

function calculatorHref(o: Opportunity): string | null {
  if (o.family !== 'pt' && o.family !== 'yt') return null;
  const protocol = o.protocol.id;
  const q = new URLSearchParams({ protocol, market: o.market.id, name: o.market.name, ...(o.maturity ? { maturity: o.maturity } : {}) });
  return `/dashboard?${q}`;
}

const action = 'tap inline-flex items-center gap-1.5 rounded-lg border border-control px-3 min-h-10 text-sm text-primary hover:bg-elevated';

export function OpportunityDetails({ row, days, modelVersion }: { row: Evaluated; days: HorizonDays; modelVersion: string }) {
  const { o } = row;
  const e = row.byHorizon[days];
  const x = e.leverage;
  const entry = e.costs.filter((c) => c.key === 'gas-entry').reduce((a, c) => a + c.usd, 0);
  const principal = e.costs.filter((c) => c.key === 'yt-principal').reduce((a, c) => a + c.usd, 0);
  const other = e.costs.reduce((a, c) => a + c.usd, 0) - entry - principal;
  const calc = calculatorHref(o);
  const earn = earnFromOpportunity(o, 'draft');
  return (
    <div className="flex flex-col gap-4 text-sm">
      <Horizons row={row} active={days} />
      {e.reason && e.placement !== 'ranked' && <p className="text-secondary">{e.reason}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="flex flex-col">
          <Line label="سرمایه">{money(e.capital)}</Line>
          <Line label="هزینه‌ی ورود">{money(-entry)}</Line>
          <Line label={x ? 'آورده در لوپ' : 'تخصیص‌یافته'}>{money(e.allocatable)}</Line>
          {e.unallocated > 0.005 && <Line label="بی‌استفاده (بی‌درآمد)">{money(e.unallocated)}</Line>}
          <Line label={o.yt ? 'بازده دریافتی تا سررسید' : 'درآمد پایه'}>{money(e.baseIncome)}</Line>
          {principal > 0 && <Line label="بهای YT (در سررسید صفر می‌شود)">{money(-principal)}</Line>}
          {e.rewards > 0 && <Line label="پاداش">{money(e.rewards)}</Line>}
          {e.debtCost > 0 && <Line label="هزینه‌ی بدهی">{money(-e.debtCost)}</Line>}
          <Line label="هزینه‌ی خروج و دریافت پاداش">{money(-other)}</Line>
          <Line label="سود خالص" tone={e.net !== null && e.net > 0 ? 'success' : 'danger'}>
            {money(e.net)}
          </Line>
          <Line label="بازده خالص دوره">{e.netPct === null ? '—' : <Num>{formatPercent(e.netPct, 2)}</Num>}</Line>
          {e.net !== null && e.earningDays > 0 && (
            <Line label="معادل روزانه" tone="muted">
              <Num>{usd(e.net / e.earningDays)}</Num>
            </Line>
          )}
        </section>
        <section className="flex flex-col">
          {x ? (
            <>
              <Line label="اهرم">
                <Num>{formatNumber(x.leverage, 2)}×</Num> <span className="text-xs text-muted">(<bdi dir="ltr">{x.policy}</bdi>)</span>
              </Line>
              <Line label="وثیقه / بدهی">
                <Num>{usd(x.gross)}</Num> / <Num>{usd(x.debt)}</Num>
              </Line>
              <Line label="بازده وثیقه / نرخ وام">
                <Num>{formatPercent(x.yieldPct, 2)}</Num> / <Num>{formatPercent(x.borrowPct, 2)}</Num>
              </Line>
              <Line label={x.health.metric === 'hf' ? 'ضریب سلامت' : 'LTV از LLTV'}>{x.health.metric === 'hf' ? <Num>{formatNumber(x.health.value, 2)}</Num> : <><Num>{formatPercent(x.ltv * 100, 1)}</Num> از <Num>{formatPercent(x.maxLtv * 100, 1)}</Num></>}</Line>
              <Line label="افت تا لیکوییدشدن" tone={x.liquidationDrop < 0.05 ? 'danger' : undefined}>
                <Num>{formatPercent(x.liquidationDrop * 100, 1)}</Num>
              </Line>
            </>
          ) : (
            <>
              {o.yt && (
                <Line label="Implied APY (قیمت YT)">
                  <Num>{formatPercent(o.yt.impliedPct, 2)}</Num>
                </Line>
              )}
              <Line label={`${o.yt ? 'بازده پایه' : 'نرخ فعلی'} (${o.rate.kind === 'apr' ? 'APR' : o.rate.kind === 'apy' ? 'APY' : o.book ? 'دفتر سفارش' : 'نامعلوم'})`}>{e.rateNow === null ? '—' : <Num>{formatPercent(e.rateNow, 2)}</Num>}</Line>
              {e.rateAfterEntry !== null && e.rateAfterEntry !== e.rateNow && (
                <Line label="نرخ پس از ورود شما">
                  <Num>{formatPercent(e.rateAfterEntry, 2)}</Num>
                </Line>
              )}
            </>
          )}
          {o.maturity && <Line label="سررسید">{formatDate(o.maturity)}</Line>}
          {o.capacity.withdrawableNowUsd !== null && (
            <Line label="قابل برداشت فوری">
              <Num>{usd(o.capacity.withdrawableNowUsd)}</Num>
            </Line>
          )}
          {e.rewardLines.map((r) => (
            <Line key={r.key} label={<><bdi>{r.label}</bdi> · <Num>{formatNumber(r.days, 0)}</Num> روز</>}>
              <Num>{usd(r.usd)}</Num>
            </Line>
          ))}
        </section>
      </div>
      <Campaigns row={row} e={e} />
      {(e.unknown.length > 0 || e.assumptions.length > 0) && (
        <details className="group">
          <summary className="cursor-pointer text-secondary select-none">فرض‌ها و موارد لحاظ‌نشده</summary>
          <ul className="list-disc ps-5 mt-2 text-secondary leading-6">
            {[...e.unknown.map((u) => `لحاظ‌نشده: ${u}`), ...e.assumptions].map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
        {o.sources.map((s, i) => (
          <span key={i}>
            <bdi dir="ltr">{s.name}</bdi> · {formatAgo(new Date(s.fetchedAt).getTime())}
          </span>
        ))}
        <span>
          مدل <bdi dir="ltr">{modelVersion}</bdi>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {calc && (
          <Link href={calc} className={action}>
            <Calculator size={14} aria-hidden /> محاسبه‌گر PT و YT
          </Link>
        )}
        {earn && (
          <Link href={`/portfolio?addEarn=${encodeURIComponent(JSON.stringify(earn))}`} className={action}>
            <Wallet size={14} aria-hidden /> ثبت در پرتفوی
          </Link>
        )}
        {o.url && (
          <a href={o.url} target="_blank" rel="noopener noreferrer" className={action}>
            <ExternalLink size={14} aria-hidden /> {isAppRoot(o.url) ? <>اپ <bdi dir="ltr">{o.protocol.name}</bdi></> : <>ورود به بازار در <bdi dir="ltr">{o.protocol.name}</bdi></>}
          </a>
        )}
      </div>
    </div>
  );
}
