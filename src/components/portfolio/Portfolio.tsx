'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, Filter, Loader2, PieChart, Plus, RefreshCw, Upload, Wallet } from 'lucide-react';
import protocols from '../../config/protocols.json';
import { usePortfolioView, type PositionView } from '../../hooks/usePortfolioView';
import { allocation, concentration } from '../../lib/portfolio/portfolio';
import { chainFa, KIND_LABEL, STATUS_FA } from '../../lib/portfolio/labels';
import { fmtDays } from '../../lib/portfolio/analysis';
import { formatDateTime, formatNumber } from '../../lib/utils/formatting';
import type { PositionKind } from '../../types/position';
import type { ProtocolId } from '../../types/protocol';
import type { PositionStatus } from '../../lib/portfolio/valuation';
import { Card, Collapsible } from '../ui/card';
import { Num } from '../ui/num';
import { AlertList, MarketIdentity, NoWalletNote, Pnl, QualityBadge, ShareBars, SnapshotChart, Stat, StatusBadge, usd } from './parts';

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
    <label className="flex flex-col gap-1 text-xs text-muted min-w-0">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="bg-elevated/70 border border-strong rounded-xl px-2 py-2 text-sm text-primary">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PositionCard({ x }: { x: PositionView }) {
  const { p, v } = x;
  return (
    <Link href={`/portfolio/${encodeURIComponent(p.id)}`} className="block rounded-2xl border border-default bg-surface/80 p-4 hover:border-accent/60 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <MarketIdentity p={p} />
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge s={v.status} />
          {v.status !== 'closed' && <QualityBadge q={v.tokenPrice.quality} prefix="قیمت" />}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <Stat label="ارزش خالص فعلی" q={v.tokenPrice.quality}>{usd(v.netValueUsd)}</Stat>
        <Stat label="سود و زیان کل">
          <Pnl usd={v.pnlUsd} pct={v.pnlPct} size="sm" word={false} />
        </Stat>
        <Stat label="خروج اکنون" q={v.exit.quality}>{usd(v.exit.proceedsUsd)}</Stat>
        <Stat label={v.status === 'closed' ? 'وضعیت' : 'تا سررسید'}>{v.status === 'closed' ? 'بسته شده' : fmtDays(v.daysLeft)}</Stat>
      </div>
      {x.alerts.length > 0 && (
        <div className="mt-3">
          <AlertList alerts={x.alerts.slice(0, 2)} />
        </div>
      )}
    </Link>
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
      <main className="grid place-items-center py-24 text-secondary">
        <Loader2 className="animate-spin" />
      </main>
    );
  }

  return (
    <main className="max-w-matrix mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold text-primary">پرتفوی من</h1>
          <p className="text-sm text-secondary">پوزیشن‌های واقعی شما: چه خریده‌اید، چقدر هزینه کرده‌اید، اکنون چقدر می‌ارزد و خروج چه می‌دهد.</p>
          <p className="text-xs text-muted flex items-center gap-1.5">
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh} disabled={refreshing} className="flex items-center gap-1.5 rounded-xl border border-strong px-3 py-2 text-sm text-secondary hover:text-primary disabled:opacity-50">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> تازه‌سازی
          </button>
          <Link href="/portfolio/new" className="flex items-center gap-1.5 rounded-xl brand-gradient px-4 py-2 text-sm font-bold text-white">
            <Plus size={16} /> ثبت پوزیشن
          </Link>
        </div>
      </header>

      <NoWalletNote />

      {views.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Wallet size={32} className="text-accent" />
            <p className="text-secondary">پوزیشنی ثبت نکرده‌اید. خریدی را که انجام داده‌اید ثبت کنید یا قبل از خرید محاسبه کنید.</p>
            <Link href="/portfolio/new" className="flex items-center gap-1.5 rounded-xl brand-gradient px-4 py-2 text-sm font-bold text-white">
              <Plus size={16} /> ثبت پوزیشن
            </Link>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-info underline">
              یا بازیابی از فایل پشتیبان
            </button>
          </div>
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Stat label="ارزش خالص کل" hint={totals.unpriced ? `${formatNumber(totals.unpriced, 0)} پوزیشن بدون قیمت، حساب نشده` : 'پس از کسر بدهی'}>
              <span className="text-xl">{usd(totals.netValueUsd)}</span>
            </Stat>
            <Stat label="سرمایه‌ی واردشده" hint="پول شخصی شما، بدون وام">
              <span className="text-xl">{usd(totals.investedUsd)}</span>
            </Stat>
            <Stat label="سود و زیان کل" hint="واریز جدید سود حساب نمی‌شود">
              <Pnl usd={totals.pnlUsd} pct={totals.pnlPct} />
            </Stat>
            <Stat label="تحقق‌یافته / تحقق‌نیافته">
              <div className="flex flex-col text-sm">
                <Pnl usd={totals.realizedUsd} size="sm" />
                <Pnl usd={totals.unrealizedUsd} size="sm" />
              </div>
            </Stat>
            <Stat label="درآمد دریافت‌شده" hint="سود و پاداش برداشت‌شده">{usd(totals.incomeUsd)}</Stat>
            <Stat label="کارمزدها و بهره‌ی پرداختی">{usd(totals.feesUsd)}</Stat>
            <Stat label="بدهی‌ها">{usd(totals.debtUsd)}</Stat>
            <Stat label="تعداد پوزیشن">
              <Num>{formatNumber(views.filter((x) => x.v.status !== 'closed').length, 0)}</Num> باز از <Num>{formatNumber(views.length, 0)}</Num>
            </Stat>
          </section>

          {alerts.length > 0 && <AlertList alerts={alerts} />}

          <Collapsible title="عملکرد پرتفوی" icon={<PieChart size={18} />} defaultOpen>
            <SnapshotChart label="ارزش خالص ثبت‌شده‌ی پرتفوی" points={history.map((h) => ({ t: new Date(h.at).getTime(), y: h.netValueUsd }))} />
          </Collapsible>

          <Collapsible title="سهم و تمرکز ریسک" icon={<PieChart size={18} />}>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold text-secondary">شبکه</h3>
                <ShareBars slices={byChain} name={chainFa} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold text-secondary">پروتکل</h3>
                <ShareBars slices={byProtocol} name={(k) => <span dir="ltr">{protocols[k as ProtocolId]?.name ?? k}</span>} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold text-secondary">دارایی پایه</h3>
                <ShareBars slices={byAsset} name={(k) => <span dir="ltr">{k}</span>} />
              </div>
            </div>
            {byAsset.length > 0 && (
              <p className={`text-sm ${hhi > 5000 ? 'text-warning' : 'text-secondary'}`}>
                {hhi > 5000 ? '⚠ تمرکز بالا: ' : 'تمرکز: '}
                {byAsset[0].share >= 50
                  ? `بیش از نیمی از ارزش پرتفوی در ${byAsset[0].key} است؛ ریسک این دارایی (دیپگ، قرارداد هوشمند) بر کل پرتفوی اثر زیادی دارد.`
                  : 'ارزش پرتفوی بین چند دارایی پخش شده است.'}
              </p>
            )}
          </Collapsible>

          <Collapsible title="فیلتر پوزیشن‌ها" icon={<Filter size={18} />}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Select label="پلتفرم" value={f.protocol} onChange={(protocol) => setF({ ...f, protocol })} options={[{ value: 'all', label: 'همه' }, ...options.protocols.map((p) => ({ value: p, label: protocols[p].name }))]} />
              <Select label="شبکه" value={f.chain} onChange={(chain) => setF({ ...f, chain })} options={[{ value: 'all', label: 'همه' }, ...options.chains.map((c) => ({ value: c, label: chainFa(c) }))]} />
              <Select label="دارایی" value={f.asset} onChange={(asset) => setF({ ...f, asset })} options={[{ value: 'all', label: 'همه' }, ...options.assets.map((a) => ({ value: a, label: a }))]} />
              <Select label="استراتژی" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'all', label: 'همه' }, { value: 'pt', label: 'PT' }, { value: 'yt', label: 'YT' }, { value: 'loop', label: 'PT Loop' }]} />
              <Select label="وضعیت" value={f.status} onChange={(status) => setF({ ...f, status })} options={[{ value: 'all', label: 'همه' }, ...(['open', 'matured', 'closed'] as const).map((s) => ({ value: s, label: STATUS_FA[s] }))]} />
            </div>
          </Collapsible>

          <section className="flex flex-col gap-3">
            {shown.length ? shown.map((x) => <PositionCard key={x.p.id} x={x} />) : <p className="text-sm text-secondary text-center py-6">پوزیشنی با این فیلترها نیست.</p>}
          </section>
        </>
      )}

      <Card title="پشتیبان" icon={<Download size={18} />}>
        <p className="text-sm text-secondary">داده‌ها فقط در همین مرورگر هستند. با پاک شدن داده‌های مرورگر از بین می‌روند؛ فایل پشتیبان بگیرید. در بازیابی، پوزیشن‌های هم‌شناسه با نسخه‌ی فایل جایگزین می‌شوند.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={doExport} disabled={!views.length} className="flex items-center gap-1.5 rounded-xl border border-strong px-3 py-2 text-sm text-secondary hover:text-primary disabled:opacity-50">
            <Download size={15} /> خروجی JSON
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-xl border border-strong px-3 py-2 text-sm text-secondary hover:text-primary">
            <Upload size={15} /> بازیابی از فایل
          </button>
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
        </div>
        {message && <p className="text-sm text-info">{message}</p>}
      </Card>
      <p className="text-[11px] text-muted text-center">ارزش‌ها به دلار آمریکا هستند. هیچ معامله یا خروجی خودکار انجام نمی‌شود.</p>
    </main>
  );
}
