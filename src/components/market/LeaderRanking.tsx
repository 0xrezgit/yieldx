'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Calculator, ExternalLink, TrendingDown, TrendingUp } from 'lucide-react';
import { buckets, leaderLoop, leaderQuoteKey, leaderYt, ytExcluded, type LeaderRow, type LeaderStrategy, type LoopBoard, type RankBy, type Verdict } from '../../lib/risk/leaderboard';
import type { ExecQuote, Opportunity } from '../../types/opportunity';
import { fetchQuote } from '../../lib/market/quotes';
import { MAX_QUOTES_PER_SIDE } from '../../lib/opportunity/policy';
import { Confidence } from './Confidence';
import { defaultScreenSettings, type OpportunityListing } from '../../lib/risk/opportunities';
import { PT_LOOP_POLICY, temporaryBase as isTemporaryBase } from '../../lib/opportunity/policy';
import thresholds from '../../config/thresholds.json';
import { isStable } from '../../lib/risk/opportunities';
import { listingLink, marketAddress } from '../../lib/market/links';
import { loopLeaderSteps, ytLeaderSteps } from '../../lib/market/steps';
import { StepList, StepStrip } from './ActionPlan';
import protocols from '../../config/protocols.json';
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

/** Below this health a loop is shown but never suggested. */
const MIN_HEALTH = thresholds.opportunities.loopMinHealth;

const money = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/** Base yield far above the implied rate usually means a temporary boost (shared rule). */
const temporaryBase = (m: OpportunityListing) => isTemporaryBase(m.baseAPY, m.impliedAPY);

/** «ورود به بازار»: the market's own page when its format is known, else the protocol's app and the address to search. */
export function EntryLink({ m, strategy }: { m: OpportunityListing; strategy: LeaderStrategy }) {
  const link = listingLink(m.protocol, m, strategy === 'yt' ? 'yt' : 'pt');
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 rounded-md border border-accent/60 px-2 min-h-8 text-primary hover:bg-elevated">
        <ExternalLink size={12} aria-hidden /> {link.exact ? 'ورود به بازار' : <>اپ <bdi dir="ltr">{protocols[m.protocol].name}</bdi></>}
      </a>
      {!link.exact && (
        <span className="text-muted">
          نشانی بازار: <bdi dir="ltr" className="select-all">{marketAddress(m)}</bdi>
        </span>
      )}
    </span>
  );
}

const calcHref = (m: OpportunityListing) => `/dashboard?${new URLSearchParams({ protocol: m.protocol, market: m.id, name: m.name, maturity: m.maturity })}`;

const leaderSteps = (row: LeaderRow, strategy: LeaderStrategy) => {
  const { m } = row;
  if (strategy === 'yt')
    return ytLeaderSteps({ asset: m.asset?.symbol ?? m.name, protocol: protocols[m.protocol].name, url: listingLink(m.protocol, m, 'yt').url, days: row.days, toMaturity: row.days >= m.daysToMaturity, maturity: m.maturity });
  return loopLeaderSteps({
    pt: m.ptToken?.symbol ?? `PT-${m.name}`,
    ptUrl: listingLink(m.protocol, m, 'pt').url,
    lender: row.lender?.protocol ?? '—',
    lenderUrl: row.lender?.url ?? null,
    debt: row.lender?.debtSymbol ?? '—',
    leverage: row.leverage ?? 1,
    health: row.health ?? null,
    days: row.days,
    maturity: m.maturity,
  });
};

function Row({ row, rank, strategy }: { row: LeaderRow; rank: number; strategy: LeaderStrategy }) {
  const { m } = row;
  const v = VERDICT[row.verdict];
  const steps = leaderSteps(row, strategy);
  return (
    <div className="w-full flex items-center gap-3 py-2.5 min-h-14 text-right rounded-lg px-1">
      <span className="grid place-items-center size-6 rounded-full bg-elevated text-xs text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} />
        <StepStrip steps={steps} />
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
          {row.lender && (
            <Pill tone="info">
              وام <bdi dir="ltr">{row.lender.debtSymbol}</bdi> از <bdi dir="ltr">{row.lender.protocol}</bdi> · بهره <Num>{formatPercent(row.lender.borrowPct, 2)}</Num> · LLTV <Num>{formatPercent(row.lender.lltvPct, 1)}</Num>
            </Pill>
          )}
          {row.leverage != null && (
            <Pill tone={row.leverage < PT_LOOP_POLICY.maxLeverage ? 'warning' : 'muted'}>
              اهرم <Num>{formatNumber(row.leverage, 1)}</Num>×{row.leverageReason && <span className="text-muted"> · {row.leverageReason}</span>}
            </Pill>
          )}
          {strategy === 'loop' && row.health != null && (
            <Pill tone={row.health < MIN_HEALTH ? 'warning' : 'muted'}>
              سلامت <Num>{formatNumber(row.health, 2)}</Num>
              {row.health < MIN_HEALTH && ' · نزدیک لیکوییدشدن'}
            </Pill>
          )}
          {strategy === 'yt' && row.perBasePoint != null && Number.isFinite(row.perBasePoint) && (
            <Pill tone="info">
              هر ۱٪ بازده پایه ≈ <Num>{formatUSD(Math.abs(row.perBasePoint), 0)}</Num>
            </Pill>
          )}
          {strategy === 'yt' && temporaryBase(m) && <Pill tone="warning">بازده پایه احتمالاً موقت</Pill>}
          {!isStable(m) && <Pill>وابسته به قیمت دارایی</Pill>}
          {row.pegVerified === false && <Pill tone="warning">برابری با دلار تأیید نشده</Pill>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <EntryLink m={m} strategy={strategy} />
          {row.lender?.url && (
            <a href={row.lender.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 rounded-md border border-accent/60 px-2 min-h-8 text-xs text-primary hover:bg-elevated">
              <ExternalLink size={12} aria-hidden /> بازار وام <bdi dir="ltr">{row.lender.protocol}</bdi>
            </a>
          )}
          <Link href={calcHref(m)} className="tap inline-flex items-center gap-1 rounded-md border border-control px-2 min-h-8 text-xs text-secondary hover:text-primary">
            <Calculator size={12} aria-hidden /> محاسبه‌گر
          </Link>
        </div>
        <details className="group mt-1">
          <summary className="cursor-pointer select-none text-xs text-secondary hover:text-primary w-fit">قدم‌به‌قدم</summary>
          <div className="mt-3 rounded-xl border border-default p-3">
            <StepList steps={steps} />
          </div>
        </details>
      </div>
      <div className="text-left shrink-0">
        <div className={`font-semibold text-lg leading-tight ${row.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
          <Num>{money(row.pnl)}</Num>
        </div>
        <Confidence confidence={row.confidence} range={row.range} why={row.doubts} />
        <div className="text-xs text-secondary">
          <Num>{signedPct(row.pnlPercent, 2)}</Num> · سالانه {row.annualized > 9999 ? <>بیش از <Num>{formatPercent(9999, 0)}</Num></> : <Num>{signedPct(row.annualized, 1)}</Num>}
        </div>
        <div className="text-xs text-muted">
          Implied <Num>{formatPercent(m.impliedAPY, 1)}</Num>
          {strategy === 'yt' && m.baseAPY !== null && (
            <>
              {' '}
              · پایه <Num>{formatPercent(m.baseAPY, 1)}</Num>
            </>
          )}
        </div>
        <div className="text-xs text-muted">
          <Num>{money(row.perDay)}</Num> در روز
        </div>
      </div>
    </div>
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
            <li key={row.id ?? `${row.m.protocol}-${row.m.id}`}>
              <Row row={row} rank={i + 1} strategy={strategy} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Suggestion({ rows, strategy }: { rows: LeaderRow[]; strategy: LeaderStrategy }) {
  // A temporary base-yield boost would make the suggestion rest on a number that will not last.
  // Never on a doubtful input (lib/opportunity/health) or a temporary base-yield boost.
  const good = rows.filter((r) => (strategy === 'yt' ? r.verdict === 'free' && !temporaryBase(r.m) : r.verdict === 'worth' && (r.health == null || r.health >= MIN_HEALTH)) && !r.tooBig && r.confidence !== 'suspect');
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
        <EntryLink m={r.m} strategy={strategy} />
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
        <p className="text-secondary">{strategy === 'yt' ? 'با این فرض‌ها هیچ YTی بی‌ضرر نیست.' : `با این نرخ وام و اهرم هیچ لوپی با سلامت دست‌کم ${formatNumber(MIN_HEALTH, 2)} از حداقل بازده بالاتر نیست.`}</p>
      )}
      <p className="text-xs text-muted">بازارهای با بازده پایه‌ی احتمالاً موقت پیشنهاد نمی‌شوند. فقط بر پایه‌ی همین فرض‌ها؛ نقدینگی، ریسک لیکوییدشدن و بازار وام واقعی را پیش از ورود بررسی کنید.</p>
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
export interface LendingState {
  opportunities: Opportunity[] | null;
  loading: boolean;
  failed: boolean;
}

export function LeaderRanking({ markets, capital, strategy, lending }: { markets: OpportunityListing[]; capital: number; strategy: LeaderStrategy; lending?: LendingState }) {
  const [fee, setFee] = useState(defaultScreenSettings.feePercent);
  const [by, setBy] = useState<RankBy>('total');
  const [pointsOnly, setPointsOnly] = useState(false);
  const [hurdle, setHurdle] = useState(8);
  const s = useMemo(() => ({ ...defaultScreenSettings, feePercent: Number.isFinite(fee) ? Math.max(0, fee) : 0 }), [fee]);
  const lendingOpps = lending?.opportunities ?? null;
  // Executable quotes (Pendle's router; rounded amounts, cached on the server) for rows too
  // large for the pool's mid price: the YT bought, or the PT a loop buys at its full size.
  const [quotes, setQuotes] = useState<Record<string, ExecQuote | null>>({});
  // Quotes speak for one capital: a new capital starts a new set (the server still caches them).
  useEffect(() => setQuotes({}), [capital]);
  const board: LoopBoard | null = useMemo(() => {
    if (strategy !== 'loop' || !(capital > 0) || !lendingOpps) return null;
    return leaderLoop(markets, s, lendingOpps, { capital, hurdle: Number.isFinite(hurdle) ? hurdle : 8, quotes });
  }, [strategy, markets, s, lendingOpps, capital, hurdle, quotes]);
  const all = useMemo(() => {
    if (!(capital > 0)) return [];
    if (strategy === 'loop') return board?.rows ?? [];
    return leaderYt(markets, s, { capital, quotes }, pointsOnly);
  }, [markets, s, capital, pointsOnly, strategy, board, quotes]);
  // Only rows with a dollar figure that can be trusted are ranked; the rest wait for (or lack) a quote.
  const rows = useMemo(() => all.filter((r) => !r.needsQuote), [all]);
  const waiting = useMemo(() => all.filter((r) => r.needsQuote), [all]);
  const excluded = useMemo(() => (strategy === 'yt' ? ytExcluded(markets, s) : null), [strategy, markets, s]);
  useEffect(() => {
    // At most MAX_QUOTES_PER_SIDE quotes per amount: the router's quota is small.
    const asked = new Set(Object.keys(quotes)).size;
    const room = Math.max(0, MAX_QUOTES_PER_SIDE * 2 - asked);
    if (!room) return;
    const want = waiting
      .filter((r) => r.m.protocol === 'pendle' && /^\d+-0x[0-9a-fA-F]{40}$/.test(r.m.id) && r.needsQuote!.usd >= 100 && !(leaderQuoteKey(r.m.id, r.needsQuote!.side, r.needsQuote!.usd) in quotes))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, Math.min(MAX_QUOTES_PER_SIDE, room));
    if (!want.length) return;
    const t = setTimeout(async () => {
      const got = await Promise.all(
        want.map(async (r) => {
          const [chain, market] = r.m.id.split('-');
          const { side, usd } = r.needsQuote!;
          return [leaderQuoteKey(r.m.id, side, usd), await fetchQuote({ id: r.m.id, chain: Number(chain), market, side, usd })] as const;
        }),
      );
      setQuotes((prev) => ({ ...prev, ...Object.fromEntries(got) }));
    }, 600);
    return () => clearTimeout(t);
  }, [waiting, quotes]);
  const b = useMemo(() => buckets(rows, by), [rows, by]);
  const gains = rows.filter((x) => x.pnl >= 0).length;
  const count = (p: string) => rows.filter((r) => r.m.protocol === p).length;

  if (!(capital > 0)) return <Empty>سرمایه‌ی اولیه را وارد کنید.</Empty>;
  if (strategy === 'loop' && !lendingOpps) {
    if (lending?.loading) return <div className="h-40 rounded-lg bg-surface border border-default animate-pulse" aria-busy="true" aria-label="در حال دریافت بازارهای وام" />;
    return <Empty>داده‌ی بازارهای وام در دسترس نیست؛ بدون بازار وامی که PT را وثیقه بگیرد، سود دلاری لوپ ساخته نمی‌شود.</Empty>;
  }
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
          <div className="grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)] gap-3 items-end">
            <NumberField label="حداقل بازده سالانه" value={hurdle} onChange={setHurdle} suffix="%" />
            <p className="text-xs text-secondary leading-6">
              اهرم هر لوپ از داده‌ی زنده‌ی همان بازار: <Num>{formatNumber(PT_LOOP_POLICY.maxLeverage, 0)}</Num>×، یا <Num>{formatNumber(PT_LOOP_POLICY.cautiousLeverage, 1)}</Num>× اگر برابری با دلار تأیید نشده، فاصله‌ی نرخ PT و وام کمتر از <Num>{formatNumber(PT_LOOP_POLICY.minSpreadPp, 0)}</Num> واحد درصد یا سررسید بیش از <Num>{formatNumber(PT_LOOP_POLICY.longDays, 0)}</Num> روز باشد؛ و در هر حال سلامت دست‌کم <Num>{formatNumber(PT_LOOP_POLICY.minHealth, 2)}</Num>.
            </p>
          </div>
        )}
        {board && (board.liquidated > 0 || board.shortLiquidity > 0) && (
          <p className="text-xs text-warning leading-6">
            {board.liquidated > 0 && (
              <>
                <Num>{formatNumber(board.liquidated, 0)}</Num> بازار وام LLTV پایینی دارد و با سلامت <Num>{formatNumber(PT_LOOP_POLICY.minHealth, 2)}</Num> اهرمی نمی‌دهد؛ نیامده است.{' '}
              </>
            )}
            {board.shortLiquidity > 0 && (
              <>
                <Num>{formatNumber(board.shortLiquidity, 0)}</Num> بازار وام نقدینگی کافی برای این وام ندارد و نیامده است.
              </>
            )}
          </p>
        )}
      </section>
      <p className="text-xs text-secondary leading-6">
        {strategy === 'yt' ? 'خرید YT و فروش در بهترین روز با Implied APY امروز (فرض ثابت ماندن نرخ بازار)، بدون ارزش پوینت.' : 'لوپ PT تا سررسید با اهرم شما، روی بازار وامی که همین PT را وثیقه می‌گیرد: بهره‌ی وام پس از وام شما، LLTV و نقدینگی همان بازار (نرخ‌ها تا سررسید ثابت فرض شده‌اند).'}{' '}
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
      {waiting.length > 0 && (
        <Excluded
          title="نیازمند قیمت اجرایی"
          note="این حجم برای نرخ میانی استخر بزرگ است؛ سود دلاری فقط با قیمت اجرایی برای همین مبلغ ساخته می‌شود. بازارهای پندل قیمت می‌گیرند و به رتبه‌بندی برمی‌گردند؛ بقیه بدون عدد می‌مانند."
          list={waiting.map((r) => ({ m: r.m, reasons: [] }))}
          strategy={strategy}
        />
      )}
      {board && board.noLender.length > 0 && <NoLender list={board.noLender} />}
      {board && board.broken.length > 0 && <Excluded title="نرخ بازار PT قابل اتکا نیست" note="قیمت PT و نرخ اعلامی هم‌خوان نیستند یا استخر خالی است؛ سود دلاری ساخته نمی‌شود." list={board.broken} strategy={strategy} />}
      {excluded && excluded.broken.length > 0 && <Excluded title="داده‌ی بازار خراب" note="بازده پایه یا نرخ بازار با داده‌ی خود پروتکل نمی‌خواند؛ سود دلاری ساخته نمی‌شود." list={excluded.broken} strategy={strategy} />}
      {excluded && excluded.pointsOnly.length > 0 && <Excluded title="فقط پوینت" note="توکن خودش بازده ندارد؛ YT فقط پوینت و ایردراپ می‌دهد و سود دلاری ندارد." list={excluded.pointsOnly.map((m) => ({ m, reasons: [] }))} strategy={strategy} />}
    </div>
  );
}

/** Loop candidates whose PT no lending market in YieldX's sources accepts: listed without any dollar figure. */
function NoLender({ list }: { list: LoopBoard['noLender'] }) {
  return (
    <section className="sx-card p-4 flex flex-col gap-2" aria-labelledby="no-lender">
      <h2 id="no-lender" className="font-semibold text-secondary">
        بدون بازار وام در منابع یلدایکس{' '}
        <span className="text-xs text-muted font-normal">
          (<Num>{formatNumber(list.length, 0)}</Num>)
        </span>
      </h2>
      <p className="text-xs text-secondary leading-6">
        هیچ بازار وامی در داده‌ی یلدایکس (<bdi dir="ltr">Morpho</bdi> و <bdi dir="ltr">Aave V4</bdi>) این PTها را وثیقه نمی‌گیرد؛ بدون جای وثیقه لوپی ساخته نمی‌شود، پس سود دلاری نشان داده نمی‌شود. ممکن است بازار وام در پروتکلی باشد که یلدایکس نمی‌خواند.
      </p>
      <ul className="flex flex-col divide-y divide-default">
        {list.map(({ m, pendleLoop }) => (
          <li key={`${m.protocol}-${m.id}`} className="flex flex-wrap items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} compact />
            </div>
            <span className="text-xs text-muted">
              Implied <Num>{formatPercent(m.impliedAPY, 1)}</Num>
            </span>
            {pendleLoop && <Pill tone="info">لوپ داخلی پندل دارد</Pill>}
            <EntryLink m={m} strategy="loop" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Markets kept out of a dollar ranking: listed with the reason, never with a dollar figure. */
function Excluded({ title, note, list, strategy }: { title: string; note: string; list: { m: OpportunityListing; reasons: string[] }[]; strategy: LeaderStrategy }) {
  return (
    <section className="sx-card p-4 flex flex-col gap-2" aria-label={title}>
      <h2 className="font-semibold text-secondary">
        {title}{' '}
        <span className="text-xs text-muted font-normal">
          (<Num>{formatNumber(list.length, 0)}</Num>)
        </span>
      </h2>
      <p className="text-xs text-secondary leading-6">{note}</p>
      <ul className="flex flex-col divide-y divide-default">
        {list.map(({ m, reasons }) => (
          <li key={`${m.protocol}-${m.id}`} className="flex flex-col gap-1 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} compact />
              </div>
              <span className="text-xs text-muted">
                Implied <Num>{formatPercent(m.impliedAPY, 1)}</Num>
                {m.baseAPY !== null && (
                  <>
                    {' '}
                    · پایه <Num>{formatPercent(m.baseAPY, 1)}</Num>
                  </>
                )}
              </span>
              <EntryLink m={m} strategy={strategy} />
            </div>
            {reasons.length > 0 && <p className="text-xs text-warning leading-6">{reasons.join(' ')}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
