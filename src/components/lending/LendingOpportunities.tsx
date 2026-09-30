'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, CircleSlash, ExternalLink, ListChecks, Loader2, RefreshCw } from 'lucide-react';
import { useLending } from '../../hooks/useLending';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { useMerkl } from '../../hooks/useMerkl';
import { liveAt } from '../../lib/merkl/filters';
import { buildContext } from '../../lib/merkl/vetting';
import { ptOpportunity } from '../../lib/opportunity/from-market';
import { protocolIdentity } from '../../lib/registry/identity';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { clampDays, defaultLendingSettings, MAX_DAYS, MIN_DAYS, MIN_HEALTH_FLOOR, rankLending, TX_ENTRY, TX_EXIT, type FamilyView, type LendingSettings } from '../../lib/lending/rank';
import type { SourceStatus } from '../../lib/lending/types';
import { TOP_LIMIT } from '../../lib/opportunity/rank';
import { networkByKey } from '../../lib/registry/networks';
import type { DataQuality, Estimate, Opportunity, Placement } from '../../types/opportunity';
import { formatAgo, formatDate, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { LogoWithNetwork } from '../ui/asset-identity';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { SectionSwitch } from '../opportunities/SectionSwitch';
import { BorrowBoard } from './BorrowBoard';
import Link from 'next/link';
import { lpLink } from '../opportunities/LpAnalyzer';
import { earnFromOpportunity } from '../../lib/portfolio/earn';
import { borrowQuotes, type BorrowClass } from '../../lib/opportunity/borrow';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 2 : 4);

const FAMILY: Record<string, string> = { lend: 'وام‌دهی متغیر', vault: 'خزانه', 'fixed-lend': 'نرخ ثابت', pt: 'PT تا سررسید', stake: 'نگه‌داری / استیک', lp: 'نقدینگی (LP)', leverage: 'اهرم', yt: 'YT', borrow: 'وام‌گیری' };
const QUALITY: Record<DataQuality, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = {
  current: { label: 'داده‌ی فعلی', tone: 'success' },
  partial: { label: 'داده‌ی ناقص', tone: 'warning' },
  stale: { label: 'داده‌ی قدیمی', tone: 'danger' },
  insufficient: { label: 'داده‌ی ناکافی', tone: 'danger' },
};
const BASIS: Record<'measured' | 'assumed' | 'model', string> = { measured: 'اندازه‌گیری‌شده', assumed: 'فرض شما', model: 'مدل' };
const ASIDE: { id: Exclude<Placement, 'ranked'>; title: string; why: string }[] = [
  { id: 'specialist', title: 'تحلیل تخصصی: نقدینگی (LP)، اهرم، YT', why: 'سود این‌ها به مسیر قیمت، نرخ وام یا ارزش YT بستگی دارد و با یک عدد دلاری قابل دفاع در فهرست عمومی نمی‌آیند. PT، YT و لوپ در بخش «سررسیددار» و LP در صفحه‌ی Merkl بررسی می‌شوند.' },
  { id: 'beyond-horizon', title: 'نرخ ثابت با سررسید بعد از مدت شما', why: 'فروش پیش از سررسید به خریدار آن روز بستگی دارد و مدل معتبری ندارد؛ عدد کنار هر ردیف سود تا سررسید است. اگر تا سررسید نگه می‌دارید، «خروج پیش از سررسید» را روی «لازم ندارم» بگذارید.' },
  { id: 'low-capacity', title: 'ظرفیت کمتر از نیمی از مبلغ شما', why: 'بیش از نیمی از سرمایه جا نمی‌شود.' },
  { id: 'unprofitable', title: 'غیرسودآور برای این مبلغ و مدت', why: 'هزینه‌ها از درآمد بیشترند.' },
  { id: 'stale', title: 'داده‌ی قدیمی', why: 'نرخ منبع قدیمی‌تر از حد مجاز است.' },
  { id: 'insufficient', title: 'داده‌ی ناکافی یا بازار غیرفعال', why: 'نرخ، وضعیت یا هشدار بازار اجازه‌ی برآورد نمی‌دهد.' },
];

type Mode = 'earn' | 'borrow';

interface Stored {
  settings: LendingSettings;
  mode?: Mode;
  borrowClass?: BorrowClass;
}

function restore(): Stored {
  const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.lending, {});
  const s = { ...defaultLendingSettings, ...(saved.settings ?? {}) };
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
  return {
    mode: saved.mode === 'borrow' ? 'borrow' : 'earn',
    borrowClass: saved.borrowClass === 'eth' || saved.borrowClass === 'btc' || saved.borrowClass === 'all' ? saved.borrowClass : 'usd',
    settings: {
      capital: num(s.capital, defaultLendingSettings.capital),
      days: clampDays(num(s.days, defaultLendingSettings.days)),
      txEthereum: num(s.txEthereum, defaultLendingSettings.txEthereum),
      txOther: num(s.txOther, defaultLendingSettings.txOther),
      view: s.view === 'lend' || s.view === 'vault' || s.view === 'fixed' || s.view === 'rewards' || s.view === 'leverage' ? s.view : (s.view as string) === 'fixed-lend' ? 'fixed' : 'all',
      needsEarlyExit: typeof s.needsEarlyExit === 'boolean' ? s.needsEarlyExit : true,
      allowLeverage: typeof s.allowLeverage === 'boolean' ? s.allowLeverage : false,
      minHealth: num(s.minHealth, defaultLendingSettings.minHealth),
      leverageTarget: num(s.leverageTarget, 0),
    },
  };
}

function Identity({ o }: { o: Opportunity }) {
  const net = networkByKey(o.chain);
  const symbol = o.assets.deposit[0]?.symbol ?? o.market.name;
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <LogoWithNetwork icon={o.icon} name={symbol} chain={net.name} size={32} />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold text-primary min-w-0">
          <bdi dir="ltr" className="truncate">
            {symbol}
          </bdi>
          <span className="text-secondary font-normal">·</span>
          <bdi dir="ltr" className="text-secondary font-normal shrink-0">
            {o.protocol.name}
          </bdi>
        </span>
        <span className="text-xs text-secondary truncate mt-0.5">
          {FAMILY[o.family] ?? o.family} · {net.nameFa}
          {o.maturity && <> · سررسید {formatDate(o.maturity)}</>} · <bdi>{o.market.name}</bdi>
        </span>
      </span>
    </span>
  );
}

function exitLine(e: Estimate, o: Opportunity): ReactNode {
  if (o.exit.type === 'maturity') {
    if (!e.exitToday) return 'خروج: در سررسید';
    if (e.exitToday.usd === null) return 'خروج زودتر: خریداری نیست';
    return (
      <>
        فروش امروز: <Num>{usd(e.exitToday.usd)}</Num>
        {!e.exitToday.complete && ' (بخشی)'}
      </>
    );
  }
  if (o.exit.type === 'secondary') return 'خروج: فروش در استخر یا بازخرید در سررسید';
  const w = o.capacity.withdrawableNowUsd;
  if (w === null) return 'خروج فوری: نامعلوم';
  if (w >= e.allocatable) return 'خروج فوری: کل مبلغ';
  return (
    <>
      خروج فوری فقط تا <Num>{formatUSDCompact(w)}</Num>
    </>
  );
}

function Line({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-default last:border-0">
      <span className="text-secondary">{label}</span>
      <span className={tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-primary'}>{children}</span>
    </div>
  );
}

function LeverageLines({ x, e, o }: { x: NonNullable<Estimate['leverage']>; e: Estimate; o: Opportunity }) {
  const debt = o.loop?.debt.token.symbol ?? 'بدهی';
  const coll = o.loop?.collateral.token.symbol ?? 'وثیقه';
  return (
    <>
      <h3 className="text-xs text-muted mt-4 mb-1">اهرم</h3>
      <Line label="اهرم (بیشترین اهرم ایمن برای حد سلامت شما)">
        <Num>{formatNumber(x.leverage, 2)}×</Num> از <Num>{formatNumber(x.maxSafe, 2)}×</Num>
      </Line>
      <Line label="آورده‌ی شما">
        <Num>{usd(x.equity)}</Num>
      </Line>
      <Line label={<>وثیقه‌ی ناخالص (<bdi dir="ltr">{coll}</bdi>)</>}>
        <Num>{usd(x.gross)}</Num>
      </Line>
      <Line label={<>بدهی (<bdi dir="ltr">{debt}</bdi>)</>}>
        <Num>{usd(x.debt)}</Num>
      </Line>
      <Line label="هزینه‌ی بدهی در این دوره" tone="danger">
        <Num>{usd(-e.debtCost)}</Num>
      </Line>
      <Line label="نرخ وام پس از وام شما">
        <Num>{formatPercent(x.borrowPct, 2)}</Num>
      </Line>
      <Line label={x.health.metric === 'hf' ? 'ضریب سلامت (HF)' : 'نسبت وام به وثیقه (LTV) در برابر LLTV'}>
        {x.health.metric === 'hf' ? (
          <Num>{formatNumber(x.health.value, 2)}</Num>
        ) : (
          <>
            <Num>{formatPercent(x.ltv * 100, 1)}</Num> از <Num>{formatPercent(x.maxLtv * 100, 1)}</Num>
          </>
        )}
      </Line>
      <Line label="افت قیمت نسبی تا لیکوییدشدن" tone={x.liquidationDrop < 0.05 ? 'danger' : undefined}>
        <Num>{formatPercent(x.liquidationDrop * 100, 1)}</Num>
      </Line>
      <Line label="حاشیه‌ی سالانه (L × بازده − (L − ۱) × نرخ وام)" tone={x.carryPct > 0 ? 'success' : 'danger'}>
        <Num>{formatPercent(x.carryPct, 2)}</Num>
      </Line>
    </>
  );
}

export function LendingDetails({ e, o }: { e: Estimate; o: Opportunity }) {
  const costs = e.costs.reduce((a, c) => a + c.usd, 0);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <section className="flex flex-col">
        <h3 className="text-xs text-muted mb-1">نتیجه برای این دوره</h3>
        <Line label="درآمد پایه">{e.baseIncome === null ? '—' : <Num>{usd(e.baseIncome)}</Num>}</Line>
        <Line label="پاداش قابل ارزش‌گذاری">
          <Num>{usd(e.rewards)}</Num>
        </Line>
        <Line label="هزینه‌های لحاظ‌شده">
          <Num>{usd(-costs)}</Num>
        </Line>
        <Line label="سود خالص قابل برآورد" tone={e.net !== null && e.net >= 0 ? 'success' : 'danger'}>
          {e.net === null ? '—' : <Num>{usd(e.net)}</Num>}
        </Line>
        <h3 className="text-xs text-muted mt-4 mb-1">سرمایه</h3>
        <Line label="ورودی">
          <Num>{usd(e.capital)}</Num>
        </Line>
        <Line label="قابل تخصیص">
          <Num>{usd(e.allocatable)}</Num>
        </Line>
        {e.unallocated > 0 && (
          <Line label="تخصیص‌نیافته (بی‌درآمد)">
            <Num>{usd(e.unallocated)}</Num>
          </Line>
        )}
        {e.unallocatedReason && <p className="text-xs text-warning mt-1">{e.unallocatedReason}</p>}
        {e.leverage && <LeverageLines x={e.leverage} e={e} o={o} />}
        <h3 className="text-xs text-muted mt-4 mb-1">نرخ</h3>
        <Line label={e.leverage ? 'بازده وثیقه (سالانه)' : o.book ? 'نرخ بهترین سفارش (سالانه، با کارمزد تسویه)' : 'نرخ فعلی (APY، پس از کارمزد، بدون پاداش)'}>{e.rateNow === null ? '—' : <Num>{formatPercent(e.rateNow, 2)}</Num>}</Line>
        <Line label={e.leverage ? 'بازده سالانه روی آورده‌ی شما (پیش از گس)' : o.book ? 'نرخ مؤثر برای مبلغ شما (سالانه، پس از همه‌ی کارمزدها)' : 'نرخ پس از ورود سرمایه‌ی شما'}>{e.rateAfterEntry === null ? '—' : <Num>{formatPercent(e.rateAfterEntry, 2)}</Num>}</Line>
        {e.exitToday && (
          <Line label="ارزش فروش امروز در دفتر خرید (مرجع، جدا از نتیجه)">{e.exitToday.usd === null ? 'خریداری نیست' : <><Num>{usd(e.exitToday.usd)}</Num>{!e.exitToday.complete && ' — فقط بخشی فروش می‌رود'}</>}</Line>
        )}
      </section>
      <section className="flex flex-col gap-3">
        {e.costs.length > 0 && (
          <div>
            <h3 className="text-xs text-muted mb-1">هزینه‌ها</h3>
            {e.costs.map((c) => (
              <Line key={c.key} label={<>{c.label} <span className="text-xs text-muted">({BASIS[c.basis]})</span></>}>
                <Num>{usd(c.usd)}</Num>
              </Line>
            ))}
          </div>
        )}
        {e.rewardLines.length > 0 && (
          <div>
            <h3 className="text-xs text-muted mb-1">پاداش‌ها (هر کمپین تا پایان خودش)</h3>
            {e.rewardLines.map((r) => (
              <Line key={r.key} label={<><bdi>{r.label}</bdi> · <Num>{formatNumber(r.days, 0)}</Num> روز</>}>
                <Num>{usd(r.usd)}</Num>
              </Line>
            ))}
          </div>
        )}
        <div>
          <h3 className="text-xs text-muted mb-1">خروج</h3>
          <p className="text-secondary leading-6">{o.exit.note ?? '—'}</p>
        </div>
        {e.unknown.length > 0 && (
          <div>
            <h3 className="text-xs text-muted mb-1">داده‌ها یا هزینه‌های لحاظ‌نشده</h3>
            <ul className="list-disc ps-5 text-secondary leading-6">
              {e.unknown.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="text-xs text-muted mb-1">فرض‌ها</h3>
          <ul className="list-disc ps-5 text-secondary leading-6">
            {e.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-muted flex flex-col gap-1">
          {o.sources.map((s) => (
            <span key={s.name}>
              منبع: <bdi dir="ltr">{s.name}</bdi> · دریافت {formatAgo(new Date(s.fetchedAt).getTime())}
              {s.sourceUpdatedAt && <> · به‌روزرسانی منبع {formatAgo(new Date(s.sourceUpdatedAt).getTime())}</>}
            </span>
          ))}
        </div>
        {earnFromOpportunity(o, 'draft') && (
          <Link href={`/portfolio?addEarn=${encodeURIComponent(JSON.stringify(earnFromOpportunity(o, 'draft')))}`} className="tap self-start inline-flex items-center gap-1.5 rounded-lg border border-control px-3 min-h-10 text-sm text-primary hover:bg-elevated">
            ثبت در پرتفوی من
          </Link>
        )}
        {o.url && (
          <a href={o.url} target="_blank" rel="noopener noreferrer" className="tap self-start inline-flex items-center gap-1.5 rounded-lg border border-control px-3 min-h-10 text-sm text-primary hover:bg-elevated">
            <ExternalLink size={14} aria-hidden /> اپ رسمی <bdi dir="ltr">{o.protocol.name}</bdi>
          </a>
        )}
      </section>
    </div>
  );
}

export function LendingRow({ e, o, rank }: { e: Estimate; o: Opportunity; rank: number }) {
  const [open, setOpen] = useState(false);
  const q = QUALITY[e.quality];
  return (
    <li className="flex flex-col">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-start gap-3 py-3 px-1 text-right rounded-lg hover:bg-elevated transition-colors">
        <span className="grid place-items-center size-7 mt-1 rounded-full bg-elevated text-xs font-semibold text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
        <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <Identity o={o} />
            <div className="flex flex-wrap items-center gap-1">
              <Pill tone={q.tone}>{q.label}</Pill>
              {e.unallocated > 0 && <Pill tone="warning">ظرفیت کمتر از مبلغ شما</Pill>}
              <Pill>{exitLine(e, o)}</Pill>
            </div>
          </div>
          <div className="shrink-0 flex flex-wrap sm:flex-col items-baseline sm:items-end gap-x-3 gap-y-0.5">
            <div className={`font-semibold text-lg leading-tight ${e.net !== null && e.net >= 0 ? 'text-success' : 'text-danger'}`}>{e.net === null ? '—' : <Num>{usd(e.net)}</Num>}</div>
            <div className="text-xs text-secondary">
              {e.netPct === null ? '—' : <Num>{formatPercent(e.netPct, 2)}</Num>} در <Num>{formatNumber(e.earningDays, 0)}</Num> روز
            </div>
            <ChevronDown size={16} className={`self-center sm:self-end text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </div>
        </div>
      </button>
      {open && (
        <div className="px-1 pb-4 pt-3 border-t border-default">
          <LendingDetails e={e} o={o} />
        </div>
      )}
    </li>
  );
}

export function Sources({ list }: { list: SourceStatus[] }) {
  const look = { ok: { dot: 'bg-success', label: 'سالم' }, stale: { dot: 'bg-warning', label: 'قدیمی — آخرین داده‌ی سالم' }, error: { dot: 'bg-danger', label: 'در دسترس نیست' } } as const;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="وضعیت منابع">
      {list.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 text-secondary">
          <span className={`size-2 rounded-full ${look[s.state].dot}`} aria-hidden />
          <bdi dir="ltr">{s.name}</bdi>: {look[s.state].label}
          {s.state !== 'error' && (
            <>
              {' '}
              · <Num>{formatNumber(s.count, 0)}</Num> فرصت
            </>
          )}
          {s.fetchedAt && <> · دریافت {formatAgo(new Date(s.fetchedAt).getTime())}</>}
        </li>
      ))}
    </ul>
  );
}

/** Variable-rate lending and vaults ranked by the estimated net dollars for the user's amount and period. */
export default function LendingOpportunities() {
  const { feed, loading, refreshing, stale, failed, refresh } = useLending();
  const [st, setSt] = useState<Stored | null>(null);
  useEffect(() => setSt(restore()), []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.lending, st);
  }, [st]);
  const setS = useCallback((p: Partial<LendingSettings>) => setSt((s) => (s ? { ...s, settings: { ...s.settings, ...p } } : s)), []);
  const patch = useCallback((p: Partial<Stored>) => setSt((s) => (s ? { ...s, ...p } : s)), []);

  const settings = st?.settings ?? defaultLendingSettings;
  // PT markets (Pendle, Exponent, Spectra) and Merkl incentives join the same list.
  const pt = useAllMarkets();
  const merkl = useMerkl();
  const minute = Math.floor(merkl.now / 60) * 60;
  const ptOpps = useMemo(
    () => pt.markets.filter((m) => !m.expired).map((m) => ptOpportunity(m.protocol, m, new Date(pt.feeds[m.protocol]?.at ?? Date.now()).toISOString())),
    [pt.markets, pt.feeds],
  );
  const merklInput = useMemo(() => {
    const f = merkl.feed;
    if (!f) return null;
    const list = f.opportunities.map((o) => liveAt(o, minute)).filter((o) => o.campaigns.length > 0);
    return { list, ctx: buildContext(list, f.markets, f.marketChains, minute), gas: f.gas, stale: merkl.stale, fetchedAt: new Date(f.fetchedAt).toISOString() };
  }, [merkl.feed, merkl.stale, minute]);
  const result = useMemo(() => rankLending([...(feed?.opportunities ?? []), ...ptOpps], settings, Date.now(), merklInput), [feed, ptOpps, settings, merklInput]);
  const sources: SourceStatus[] = useMemo(
    () => [
      ...(feed?.sources ?? []),
      ...Object.entries(pt.feeds).map(([id, f]) => ({
        id,
        name: protocolIdentity(id as never).name,
        state: (f!.failed ? 'error' : f!.stale ? 'stale' : 'ok') as SourceStatus['state'],
        fetchedAt: f!.at ? new Date(f!.at).toISOString() : null,
        count: pt.markets.filter((m) => m.protocol === id && !m.expired).length,
        error: null,
      })),
      ...(merkl.loading ? [] : [{ id: 'merkl', name: 'Merkl', state: (merkl.failed ? 'error' : merkl.stale ? 'stale' : 'ok') as SourceStatus['state'], fetchedAt: merkl.feed ? new Date(merkl.feed.fetchedAt).toISOString() : null, count: merklInput?.list.length ?? 0, error: null }]),
    ],
    [feed, pt.feeds, pt.markets, merkl.loading, merkl.failed, merkl.stale, merkl.feed, merklInput],
  );
  const anyLoading = loading && pt.loading && merkl.loading;
  const mode: Mode = st?.mode ?? 'earn';
  const borrowClass: BorrowClass = st?.borrowClass ?? 'usd';
  const borrow = useMemo(() => (mode === 'borrow' ? borrowQuotes(feed?.opportunities ?? [], settings.capital, clampDays(settings.days), borrowClass) : null), [mode, feed, settings.capital, settings.days, borrowClass]);
  const nothing = failed && !pt.markets.length && merkl.failed;
  const refreshAll = () => {
    refresh();
    pt.refresh();
    merkl.refresh();
  };

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }
  const { top, aside } = result.ranking;

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">فرصت‌ها</h1>
          <p className="text-sm text-secondary">همه‌ی فرصت‌ها در یک فهرست: PT، وام‌دهی، خزانه، نرخ ثابت و پاداش‌های Merkl، به ترتیب سود خالص برای مبلغ و مدت شما.</p>
          <div className="mt-1">
            {anyLoading ? (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> در حال دریافت…
              </p>
            ) : sources.length ? (
              <Sources list={sources} />
            ) : (
              <p className="text-xs text-danger">هیچ منبعی پاسخ نداد.</p>
            )}
            {stale && <p className="text-xs text-warning mt-1">آخرین به‌روزرسانی ناموفق بود؛ داده‌ی قبلی نمایش داده می‌شود.</p>}
          </div>
        </div>
        <button type="button" onClick={refreshAll} disabled={refreshing} className="tap inline-flex items-center gap-1.5 rounded-lg px-3 min-h-10 text-sm text-secondary hover:text-primary hover:bg-elevated disabled:opacity-60">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden /> به‌روزرسانی
        </button>
      </header>

      <SectionSwitch current="ranking" />

      <Segmented<Mode>
        value={mode}
        onChange={(m) => patch({ mode: m })}
        label="پرسش"
        options={[
          { id: 'earn', label: 'کجا بیشترین سود؟' },
          { id: 'borrow', label: 'هزینه‌ی تأمین سرمایه (وام)' },
        ]}
      />

      <section className="sx-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="مبلغ و مدت">
        <NumberField label={mode === 'borrow' ? 'مبلغ وام' : 'مبلغ سرمایه'} value={settings.capital} onChange={(v) => setS({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        <NumberField
          label="مدت"
          value={settings.days}
          onChange={(v) => setS({ days: Number.isFinite(v) ? Math.max(0, v) : 0 })}
          suffix="روز"
          warning={settings.days !== clampDays(settings.days) ? `با ${formatNumber(clampDays(settings.days), 0)} روز حساب می‌شود.` : undefined}
          note={<>هر عدد صحیح از <Num>{formatNumber(MIN_DAYS, 0)}</Num> تا <Num>{formatNumber(MAX_DAYS, 0)}</Num> روز</>}
        />
      </section>

      {mode === 'earn' && (
        <>
      <Segmented<FamilyView>
        value={settings.view}
        onChange={(view) => setS({ view })}
        label="نوع فرصت"
        options={[
          { id: 'all', label: 'همه' },
          { id: 'fixed', label: 'ثابت' },
          { id: 'lend', label: 'وام‌دهی' },
          { id: 'vault', label: 'خزانه' },
          { id: 'rewards', label: 'پاداش‌دار' },
          ...(settings.allowLeverage ? [{ id: 'leverage' as const, label: 'اهرم' }] : []),
        ]}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-secondary">اگر سررسید بعد از مدت شما باشد، ممکن است پیش از سررسید پول لازم شود؟</span>
        <Segmented<'yes' | 'no'>
          value={settings.needsEarlyExit ? 'yes' : 'no'}
          onChange={(v) => setS({ needsEarlyExit: v === 'yes' })}
          label="خروج پیش از سررسید"
          size="sm"
          options={[
            { id: 'yes', label: 'ممکن است لازم شود' },
            { id: 'no', label: 'تا سررسید نگه می‌دارم' },
          ]}
        />
      </div>


      <div className="sx-card p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-secondary">اهرم (لوپ) در رتبه‌بندی بیاید؟</span>
          <Segmented<'no' | 'yes'>
            value={settings.allowLeverage ? 'yes' : 'no'}
            onChange={(v) => setS({ allowLeverage: v === 'yes', view: v === 'no' && settings.view === 'leverage' ? 'all' : settings.view })}
            label="اهرم"
            size="sm"
            options={[
              { id: 'no', label: 'نه، فقط بدون وام' },
              { id: 'yes', label: 'بله، با حد سلامت من' },
            ]}
          />
        </div>
        {settings.allowLeverage && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NumberField
              label="حداقل سلامت قابل قبول"
              value={settings.minHealth}
              onChange={(v) => setS({ minHealth: Number.isFinite(v) ? v : defaultLendingSettings.minHealth })}
              help="در Aave ضریب سلامت (HF)، در Morpho نسبت LLTV به LTV. بالاتر یعنی اهرم کمتر و فاصله‌ی بیشتر تا لیکوییدشدن."
              warning={settings.minHealth < MIN_HEALTH_FLOOR ? `کمتر از ${formatNumber(MIN_HEALTH_FLOOR, 2)} پذیرفته نمی‌شود.` : undefined}
            />
            <NumberField
              label="اهرم دلخواه"
              value={settings.leverageTarget}
              onChange={(v) => setS({ leverageTarget: Number.isFinite(v) ? Math.max(0, v) : 0 })}
              suffix="×"
              note="صفر یعنی بیشترین اهرمی که حد سلامت شما را نگه دارد؛ اهرم بالاتر از آن به کار نمی‌رود."
            />
          </div>
        )}
      </div>
        </>
      )}

      {mode === 'borrow' && (
        <Segmented<BorrowClass>
          value={borrowClass}
          onChange={(c) => patch({ borrowClass: c })}
          label="دارایی وام"
          options={[
            { id: 'usd', label: 'استیبل‌کوین دلاری' },
            { id: 'eth', label: 'ETH' },
            { id: 'btc', label: 'BTC' },
            { id: 'all', label: 'همه' },
          ]}
        />
      )}

{mode === 'earn' && (
      <p className="text-xs text-secondary leading-6 rounded-md bg-surface border border-default px-3 py-2">
        هر ردیف فرض می‌کند <b className="text-primary">کل</b> سرمایه در همان فرصت است؛ سود ردیف‌ها قابل جمع نیست. «سود خالص قابل برآورد در این دوره» با نرخ‌ها و قیمت‌های امروز حساب شده و پیش‌بینی نیست.
      </p>
      )}

      {mode === 'borrow' ? (
        loading ? (
          <div className="h-40 rounded-lg bg-surface border border-default animate-pulse" aria-busy="true" />
        ) : (
          <BorrowBoard rows={borrow?.rows ?? []} blocked={borrow?.blocked ?? []} amount={settings.capital} days={clampDays(settings.days)} />
        )
      ) : anyLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : nothing ? (
        <p className="text-sm text-secondary">دریافت داده ممکن نشد. چند لحظه‌ی دیگر «به‌روزرسانی» را بزنید.</p>
      ) : !(settings.capital > 0) ? (
        <p className="text-sm text-secondary">مبلغ سرمایه را وارد کنید.</p>
      ) : top.length === 0 ? (
        <Empty>برای این مبلغ و مدت فرصت واجد شرایطی پیدا نشد.</Empty>
      ) : (
        <section aria-label="فرصت‌های برتر" className="sx-card p-2 sm:p-3">
          <h2 className="text-sm text-secondary px-1 pb-2">
            <Num>{formatNumber(top.length, 0)}</Num> فرصت برتر از <Num>{formatNumber(result.total, 0)}</Num> (حداکثر <Num>{formatNumber(TOP_LIMIT, 0)}</Num>)
          </h2>
          <ol className="flex flex-col divide-y divide-default">
            {top.map((e, i) => {
              const o = result.byKey.get(e.key);
              return o ? <LendingRow key={e.key} e={e} o={o} rank={i + 1} /> : null;
            })}
          </ol>
        </section>
      )}

      {mode === 'earn' &&
        !anyLoading &&
        ASIDE.filter((a) => aside[a.id].length > 0).map((a) => (
          <Collapsible key={a.id} title={a.title} icon={<CircleSlash size={18} aria-hidden />} badge={<Num>{formatNumber(aside[a.id].length, 0)}</Num>}>
            <p className="text-xs text-secondary mb-2">{a.why}</p>
            <ul className="flex flex-col gap-2 text-sm">
              {aside[a.id].slice(0, 50).map((e) => {
                const o = result.byKey.get(e.key);
                if (!o) return null;
                return (
                  <li key={e.key} className="flex items-center justify-between gap-3">
                    <span className="flex flex-col gap-1 min-w-0">
                      <Identity o={o} />
                      {o.family === 'lp' && (
                        <Link href={lpLink({ name: o.market.name, a: o.assets.deposit[0]?.symbol ?? undefined, b: o.assets.deposit[1]?.symbol ?? undefined, feeApr: o.rate.value, capital: e.capital, days: e.days })} className="text-xs text-accent underline underline-offset-4">
                          تحلیل LP با سناریوی قیمت
                        </Link>
                      )}
                    </span>
                    <span className="text-xs text-secondary shrink-0 text-left">
                      {e.net === null ? (
                        e.assumptions[e.assumptions.length - 1]
                      ) : (
                        <>
                          <Num>{usd(e.net)}</Num>
                          {e.placement === 'beyond-horizon' && (
                            <>
                              {' '}
                              تا سررسید (<Num>{formatNumber(e.earningDays, 0)}</Num> روز)
                            </>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Collapsible>
        ))}

      <Collapsible title="فرض‌ها و هزینه‌ها" icon={<ListChecks size={18} aria-hidden />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField label="هزینه‌ی هر تراکنش در اتریوم" value={settings.txEthereum} onChange={(v) => setS({ txEthereum: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" help={`ورود ${formatNumber(TX_ENTRY, 0)} تراکنش (تأیید و سپرده) و خروج ${formatNumber(TX_EXIT, 0)} تراکنش؛ فرض شما.`} />
          <NumberField label="هزینه‌ی هر تراکنش در سایر شبکه‌ها" value={settings.txOther} onChange={(v) => setS({ txOther: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        </div>
        <div className="text-sm text-secondary leading-7 flex flex-col gap-2">
          <p>
            <b className="text-primary">سود خالص</b> = درآمد پایه با «نرخ پس از ورود» + پاداش‌هایی که قیمت و تاریخ پایان دارند (هر کدام فقط تا پایان کمپین خودش) − گس ورود و خروج. کارمزدی که در نرخ هست دوباره کم نمی‌شود و پاداشی که در نرخ هست دوباره اضافه نمی‌شود.
          </p>
          <p>
            <b className="text-primary">نرخ پس از ورود:</b> سپرده‌ی شما استفاده‌ی بازار را پایین می‌آورد و نرخ را کم می‌کند؛ از منحنی نرخ همان بازار حساب و برای کل دوره ثابت فرض می‌شود. برای خزانه‌ها این اثر به تخصیص curator بستگی دارد و مدل نشده است.
          </p>
          <p>
            <b className="text-primary">نرخ ثابت (Morpho Midnight):</b> مبلغ شما در دفتر فروش سطح به سطح پر می‌شود، نه با بهترین قیمت؛ آنچه جا نشود بی‌درآمد می‌ماند. کارمزد تسویه و کارمزد پیوسته با بیشینه‌ی مجاز پروتکل حساب می‌شوند (محافظه‌کارانه). «ارزش فروش امروز» فقط مرجع است و با نتیجه جمع نمی‌شود.
          </p>
          <p>
            <b className="text-primary">PT:</b> نگه‌داری تا سررسید با Implied APY فعلی (قیمت PT امروز)؛ اثر قیمت خرید در استخر برای مبلغ شما گزارش نمی‌شود و در «لحاظ‌نشده‌ها» می‌آید.
          </p>
          <p>
            <b className="text-primary">پاداش‌ها و Merkl:</b> پاداش Merkl فقط وقتی به یک فرصت پروتکل وصل می‌شود که شبکه، پروتکل و نشانی قرارداد دقیقاً یکی باشند؛ آن‌وقت همان پاداش که پروتکل گزارش کرده حذف و کمپین Merkl (با تاریخ پایان و قیمت اعتبارسنجی‌شده) یک‌بار شمرده می‌شود
            {result.linked > 0 && (
              <>
                {' '}
                — اکنون <Num>{formatNumber(result.linked, 0)}</Num> فرصت پیوند دارد
              </>
            )}
            . بازارهای Merkl پروتکل‌هایی که یلدایکس آداپتر دارد (Morpho، Pendle، Spectra، Exponent) دوباره فهرست نمی‌شوند و در صفحه‌ی Merkl می‌مانند؛ بقیه با موتور Merkl برآورد و اینجا آورده می‌شوند. پاداش‌های Morpho بدون پیوند، تاریخ پایان ندارند و به دلار تبدیل نمی‌شوند. پاداش‌های Aave که شرط دریافت دارند لحاظ نمی‌شوند.
          </p>
        </div>
      </Collapsible>

      <p className="text-xs text-muted leading-6">
        داده‌ها از API رسمی Morpho (از جمله Midnight)، AaveKit (Aave V4)، Pendle، Exponent، Spectra و Merkl. نرخ‌ها با استفاده‌ی بازار و تصمیم curatorها تغییر می‌کنند. اعداد برآوردی‌اند و توصیه‌ی مالی نیستند.
      </p>
    </main>
  );
}
