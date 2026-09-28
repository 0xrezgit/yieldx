'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, Download, Loader2, PieChart, Plus, RefreshCw, Upload, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import protocols from '../../config/protocols.json';
import { usePortfolioView, type PositionView } from '../../hooks/usePortfolioView';
import { allocation, concentration } from '../../lib/portfolio/portfolio';
import { chainFa, KIND_LABEL, STATUS_FA } from '../../lib/portfolio/labels';
import { fmtDays } from '../../lib/portfolio/analysis';
import { formatDateTime, formatNumber, formatPercent } from '../../lib/utils/formatting';
import type { PositionKind } from '../../types/position';
import type { ProtocolId } from '../../types/protocol';
import type { PositionStatus } from '../../lib/portfolio/valuation';
import { Num } from '../ui/num';
import { AlertList, btn, Disclosure, MarketIdentity, NoWalletNote, Panel, Pnl, QualityBadge, ShareBars, SnapshotChart, StatusBadge, SxPage, Usd } from './parts';

interface Filters {
  protocol: ProtocolId | 'all';
  chain: string;
  asset: string;
  kind: PositionKind | 'all';
  status: PositionStatus | 'all';
}

const ALL: Filters = { protocol: 'all', chain: 'all', asset: 'all', kind: 'all', status: 'all' };

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-sx-muted min-w-0">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-10 px-2.5 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A figure in the hero band's secondary row. */
function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 flex flex-col gap-1 py-3 border-t border-sx-border lg:border-t-0 lg:py-0">
      <span className="text-xs text-sx-muted">{label}</span>
      <span className="text-base font-normal text-sx-text">{children}</span>
      {hint && <span className="text-[11px] text-sx-faint">{hint}</span>}
    </div>
  );
}

type SortKey = 'value' | 'pnl' | 'pnlPct' | 'exit' | 'days';

const SORTERS: Record<SortKey, (x: PositionView) => number> = {
  value: (x) => x.v.netValueUsd,
  pnl: (x) => x.v.pnlUsd,
  pnlPct: (x) => x.v.pnlPct,
  exit: (x) => x.v.exit.proceedsUsd,
  days: (x) => (x.v.status === 'closed' ? Infinity : x.v.daysLeft),
};

function sortViews(views: PositionView[], key: SortKey, dir: 1 | -1): PositionView[] {
  const f = SORTERS[key];
  // Unknown values (no price) always sink to the bottom.
  return [...views].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    if (!Number.isFinite(x) && !Number.isFinite(y)) return 0;
    if (!Number.isFinite(x)) return 1;
    if (!Number.isFinite(y)) return -1;
    return (x - y) * dir;
  });
}

/**
 * All positions side by side: one row each, the same columns for every row so
 * many positions stay comparable. On narrow screens the table scrolls sideways
 * while the position column stays pinned.
 */
export function PositionTable({ views }: { views: PositionView[] }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const rows = sortViews(views, sort.key, sort.dir);
  const Th = ({ k, children }: { k?: SortKey; children: ReactNode }) => {
    const active = k && sort.key === k;
    return (
      <th scope="col" className="px-4 py-3 font-normal text-right whitespace-nowrap" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
        {k ? (
          <button type="button" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : -1 })} className={`inline-flex items-center gap-1 hover:text-sx-text transition-colors ${active ? 'text-sx-text' : ''}`}>
            {children}
            {active ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-40" />}
          </button>
        ) : (
          children
        )}
      </th>
    );
  };
  return (
    <div className="sx-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="text-xs text-sx-muted border-b border-sx-border bg-sx-raised/40">
              <th scope="col" className="sticky right-0 z-10 bg-[#1f1f28] px-4 py-3 font-normal text-right min-w-[15rem]">پوزیشن</th>
              <Th>وضعیت</Th>
              <Th k="value">ارزش خالص</Th>
              <Th k="pnl">سود و زیان</Th>
              <Th k="exit">خروج اکنون</Th>
              <Th k="days">تا سررسید</Th>
              <Th>داده</Th>
              <th scope="col" className="w-8" aria-label="باز کردن" />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const { p, v } = x;
              const href = `/portfolio/${encodeURIComponent(p.id)}`;
              const warn = x.alerts.filter((a) => a.level === 'danger' || a.level === 'warning').length;
              return (
                <tr key={p.id} onClick={() => router.push(href)} className="group border-b border-sx-border last:border-b-0 cursor-pointer hover:bg-sx-raised/50 transition-colors">
                  <td className="sticky right-0 z-10 bg-sx-surface group-hover:bg-[#23232c] px-4 py-3.5 transition-colors">
                    {/* The real link keeps rows reachable by keyboard and screen readers. */}
                    <Link href={href} onClick={(e) => e.stopPropagation()} className="block">
                      <MarketIdentity p={p} size={36} />
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge s={v.status} />
                      {warn > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-sx-orange">
                          <AlertTriangle size={11} /> <Num>{formatNumber(warn, 0)}</Num> هشدار
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-[15px]">
                    <Usd x={v.netValueUsd} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="sm" word={false} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <Usd x={v.exit.proceedsUsd} />
                      {v.exit.quality === 'estimate' && <span className="text-[11px] text-sx-orange">تخمینی</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">{v.status === 'closed' ? <span className="text-sx-muted">بسته شده</span> : fmtDays(v.daysLeft)}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap">{v.status === 'closed' ? <span className="text-sx-faint">—</span> : <QualityBadge q={v.tokenPrice.quality} />}</td>
                  <td className="pl-4 py-3.5">
                    <ChevronLeft size={16} className="text-sx-faint group-hover:text-sx-accent transition-colors" aria-hidden />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const { positions, views, totals, history, refresh, refreshing, updatedAt, exportFile, importFile } = usePortfolioView();
  const [f, setF] = useState<Filters>(ALL);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
    return {
      protocols: uniq(views.map((x) => x.p.protocol)) as ProtocolId[],
      chains: uniq(views.map((x) => x.p.chain)),
      assets: uniq(views.map((x) => x.p.assetSymbol || x.p.marketName)),
    };
  }, [views]);

  const shown = views.filter(
    (x) =>
      (f.protocol === 'all' || x.p.protocol === f.protocol) &&
      (f.chain === 'all' || x.p.chain === f.chain) &&
      (f.asset === 'all' || (x.p.assetSymbol || x.p.marketName) === f.asset) &&
      (f.kind === 'all' || x.p.kind === f.kind) &&
      (f.status === 'all' || x.v.status === f.status),
  );

  const byChain = allocation(views, (x) => x.p.chain);
  const byProtocol = allocation(views, (x) => x.p.protocol);
  const byAsset = allocation(views, (x) => x.p.assetSymbol || x.p.marketName);
  const hhi = concentration(byAsset);
  const alerts = views.flatMap((x) => x.alerts.filter((a) => a.level !== 'info').map((a) => ({ ...a, text: `${KIND_LABEL[x.p.kind]} ${x.p.marketName}: ${a.text}` })));
  const open = views.filter((x) => x.v.status !== 'closed').length;

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportFile(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yieldx-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    const n = importFile(await file.text());
    setMessage(n === null ? 'فایل پشتیبان معتبر نیست.' : `${formatNumber(n, 0)} پوزیشن بازیابی شد.`);
  };

  if (positions === null) {
    return (
      <main className="sx grid place-items-center py-24 text-sx-muted">
        <Loader2 className="animate-spin" />
      </main>
    );
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) doImport(file);
        e.target.value = '';
      }}
    />
  );

  return (
    <SxPage>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl lg:text-4xl font-medium tracking-tight">پرتفوی من</h1>
          <p className="text-[15px] text-sx-muted max-w-xl leading-7">چه خریده‌اید، چقدر هزینه کرده‌اید، اکنون چقدر می‌ارزد و اگر خارج شوید چه مبلغی می‌گیرید.</p>
          <p className="text-xs text-sx-faint flex items-center gap-1.5">
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <span className={`size-1.5 rounded-full ${updatedAt ? 'bg-sx-green' : 'bg-sx-faint'}`} aria-hidden />}
            {updatedAt ? (
              <>
                آخرین دریافت داده: <Num>{formatDateTime(new Date(updatedAt).toISOString())}</Num> · تازه‌سازی خودکار هر ۵ دقیقه
              </>
            ) : views.length ? (
              'در حال دریافت قیمت‌ها…'
            ) : (
              'هنوز پوزیشنی ثبت نشده'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={refresh} disabled={refreshing} className={btn.ghost}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> تازه‌سازی
          </button>
          <Link href="/portfolio/new" className={btn.primary}>
            <Plus size={16} /> ثبت پوزیشن
          </Link>
        </div>
      </header>

      {views.length === 0 ? (
        <section className="sx-hero px-6 py-14 flex flex-col items-center gap-4 text-center">
          <span className="grid place-items-center size-14 rounded-full bg-sx-accent/15 text-sx-accent">
            <Wallet size={26} />
          </span>
          <h2 className="text-xl font-medium">اولین پوزیشن را ثبت کنید</h2>
          <p className="text-sm text-sx-muted max-w-md leading-7">خریدی را که انجام داده‌اید ثبت کنید، یا قبل از خرید محاسبه کنید چه مقدار توکن می‌گیرید.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/portfolio/new" className={btn.primary}>
              <Plus size={16} /> ثبت پوزیشن
            </Link>
            <button type="button" onClick={() => fileRef.current?.click()} className={btn.secondary}>
              <Upload size={15} /> بازیابی از فایل
            </button>
          </div>
          {fileInput}
          {message && <p className="text-sm text-sx-blue">{message}</p>}
        </section>
      ) : (
        <>
          <section className="sx-hero p-6 md:p-8 flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-sm text-sx-muted">ارزش خالص کل</span>
                <span className="text-4xl lg:text-5xl font-light tracking-tight">
                  <Usd x={totals.netValueUsd} />
                </span>
                <span className="text-xs text-sx-faint">{totals.unpriced ? `${formatNumber(totals.unpriced, 0)} پوزیشن بدون قیمت، در جمع حساب نشده` : 'پس از کسر بدهی‌ها'}</span>
              </div>
              <div className="flex flex-col items-start gap-1">
                <span className="text-xs text-sx-muted">سود و زیان کل</span>
                <Pnl usd={totals.pnlUsd} pct={totals.pnlPct} size="lg" />
                <span className="text-[11px] text-sx-faint">واریز جدید سود حساب نمی‌شود</span>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-x-6 lg:gap-y-0 lg:border-t lg:border-sx-border lg:pt-5">
              <Figure label="سرمایه‌ی واردشده" hint="پول شخصی، بدون وام">
                <Usd x={totals.investedUsd} />
              </Figure>
              <Figure label="تحقق‌یافته">
                <Pnl usd={totals.realizedUsd} size="sm" word={false} />
              </Figure>
              <Figure label="تحقق‌نیافته">
                <Pnl usd={totals.unrealizedUsd} size="sm" word={false} />
              </Figure>
              <Figure label="درآمد دریافت‌شده">
                <Usd x={totals.incomeUsd} />
              </Figure>
              <Figure label="کارمزد و بهره">
                <Usd x={totals.feesUsd} />
              </Figure>
              <Figure label="بدهی‌ها">
                <Usd x={totals.debtUsd} />
              </Figure>
            </div>
          </section>

          {alerts.length > 0 && <AlertList alerts={alerts} />}

          <section className="flex flex-col gap-4 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium">پوزیشن‌ها</h2>
              <span className="text-xs text-sx-muted">
                <Num>{formatNumber(open, 0)}</Num> باز از <Num>{formatNumber(views.length, 0)}</Num> · برای مرتب‌سازی روی سرستون بزنید
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Select label="پلتفرم" value={f.protocol} onChange={(protocol) => setF({ ...f, protocol })} options={[{ value: 'all', label: 'همه' }, ...options.protocols.map((p) => ({ value: p, label: protocols[p].name }))]} />
                <Select label="شبکه" value={f.chain} onChange={(chain) => setF({ ...f, chain })} options={[{ value: 'all', label: 'همه' }, ...options.chains.map((c) => ({ value: c, label: chainFa(c) }))]} />
                <Select label="دارایی" value={f.asset} onChange={(asset) => setF({ ...f, asset })} options={[{ value: 'all', label: 'همه' }, ...options.assets.map((a) => ({ value: a, label: a }))]} />
                <Select label="استراتژی" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'all', label: 'همه' }, { value: 'pt', label: 'PT' }, { value: 'yt', label: 'YT' }, { value: 'loop', label: 'PT Loop' }]} />
                <Select label="وضعیت" value={f.status} onChange={(status) => setF({ ...f, status })} options={[{ value: 'all', label: 'همه' }, ...(['open', 'matured', 'closed'] as const).map((s) => ({ value: s, label: STATUS_FA[s] }))]} />
              </div>
            {shown.length ? <PositionTable views={shown} /> : <p className="sx-card text-sm text-sx-muted text-center py-10">پوزیشنی با این فیلترها نیست.</p>}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <Panel title="عملکرد" icon={<PieChart size={17} />} subtitle="ارزش خالص ثبت‌شده، فقط از داده‌ی واقعی">
                <SnapshotChart label="ارزش خالص ثبت‌شده‌ی پرتفوی" points={history.map((h) => ({ t: new Date(h.at).getTime(), y: h.netValueUsd }))} />
              </Panel>
              <Panel title="تخصیص و تمرکز ریسک">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2.5">
                    <h3 className="text-xs text-sx-muted">شبکه</h3>
                    <ShareBars slices={byChain} name={chainFa} />
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <h3 className="text-xs text-sx-muted">پروتکل</h3>
                    <ShareBars slices={byProtocol} name={(k) => <span dir="ltr">{protocols[k as ProtocolId]?.name ?? k}</span>} />
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <h3 className="text-xs text-sx-muted">دارایی پایه</h3>
                    <ShareBars slices={byAsset} name={(k) => <span dir="ltr">{k}</span>} />
                  </div>
                </div>
                {byAsset.length > 0 && (
                  <p className={`text-sm leading-7 ${hhi > 5000 ? 'text-sx-orange' : 'text-sx-muted'}`}>
                    {byAsset[0].share >= 50
                      ? `⚠ تمرکز بالا: ${formatPercent(byAsset[0].share, 0)} از ارزش پرتفوی در ${byAsset[0].key} است؛ ریسک این دارایی (دیپگ، قرارداد هوشمند) بر کل پرتفوی اثر زیادی دارد.`
                      : 'ارزش پرتفوی بین چند دارایی پخش شده است.'}
                  </p>
                )}
              </Panel>
              <Disclosure title="پشتیبان" icon={<Download size={17} />}>
                <p className="text-sm text-sx-muted leading-7">داده‌ها فقط در همین مرورگر هستند و با پاک شدن داده‌های مرورگر از بین می‌روند. در بازیابی، پوزیشن‌های هم‌شناسه با نسخه‌ی فایل جایگزین می‌شوند.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={doExport} className={btn.secondary}>
                    <Download size={15} /> خروجی JSON
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()} className={btn.ghost}>
                    <Upload size={15} /> بازیابی از فایل
                  </button>
                  {fileInput}
                </div>
                {message && <p className="text-sm text-sx-blue">{message}</p>}
              </Disclosure>
          </div>
        </>
      )}

      <footer className="flex flex-col gap-2 border-t border-sx-border pt-5">
        <NoWalletNote />
        <p className="text-xs text-sx-faint">ارزش‌ها به دلار آمریکا هستند. هیچ معامله یا خروجی خودکار انجام نمی‌شود.</p>
      </footer>
    </SxPage>
  );
}
