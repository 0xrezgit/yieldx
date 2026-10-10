'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ExternalLink, Info, Landmark, Loader2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';
import { collateralPairs, COLLATERAL_POLICY, entryToken, fundingOptions, holdingId, holdingOptions, type Funding, type Holding, type Pair } from '../../lib/opportunity/collateral';
import { collateralSteps, stepsFor } from '../../lib/market/steps';
import { DEFAULT_HORIZON, HORIZONS, isHorizon, type HorizonDays } from '../../lib/opportunity/policy';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { networkByKey } from '../../lib/registry/networks';
import { FAMILY_LABEL } from '../../lib/market/labels';
import { formatAgo, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField, SelectField } from '../ui/field';
import { Num } from '../ui/num';
import { LogoWithNetwork } from '../ui/asset-identity';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { StepList } from '../market/ActionPlan';
import { ghostAction, primaryAction } from '../market/RowParts';

interface Stored {
  holding: string;
  valueUsd: number;
  ltvPct: number;
  days: HorizonDays;
  bridgeUsd: number;
}

const LTVS = [30, 40, 50, 60, 70] as const;
const START: Stored = { holding: 'c:btc', valueUsd: 10_000, ltvPct: COLLATERAL_POLICY.defaultLtv * 100, days: DEFAULT_HORIZON, bridgeUsd: COLLATERAL_POLICY.defaultBridgeUsd };

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const tone = (x: number) => (x >= 0 ? 'text-success' : 'text-danger');

/** Where else in the app the same dollar opportunity shows (the combination itself is only here). */
function alsoIn(p: Pair): string[] {
  const o = p.deploy.o;
  const out = ['تحلیل بازار'];
  if (o.family === 'leverage' && o.maturity) out.push('لوپ PT');
  if (o.family === 'yt') out.push('دلاری YT');
  return out;
}

function Leg({ label, o, line }: { label: string; o: Pair['deploy']['o'] | Funding['o']; line: ReactNode }) {
  const net = networkByKey(o.chain);
  const symbol = o.assets.deposit[0]?.symbol ?? o.market.name;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <LogoWithNetwork icon={o.icon} name={symbol} chain={net.name} size={32} />
      <div className="min-w-0 flex flex-col leading-tight">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="text-sm text-primary truncate">
          <bdi dir="ltr">{o.protocol.name}</bdi> · {net.nameFa}
        </span>
        <span className="text-xs text-secondary truncate">{line}</span>
      </div>
    </div>
  );
}

function stepsOf(p: Pair, s: Stored) {
  const f = p.funding;
  const e = p.estimate;
  const from = networkByKey(f.o.chain).nameFa;
  const to = networkByKey(p.deploy.o.chain).nameFa;
  const loan = f.o.assets.deposit[0]?.symbol ?? 'USDC';
  const need = entryToken(p.deploy.o);
  return collateralSteps({
    collateral: f.collateral,
    valueUsd: s.valueUsd,
    ltv: s.ltvPct / 100,
    borrowUsd: f.borrowUsd,
    loanSymbol: loan,
    swapTo: need.toLowerCase() === loan.toLowerCase() ? null : need,
    lender: f.o.protocol.name,
    lenderChain: from,
    lenderUrl: f.o.url ?? null,
    liquidationDrop: f.liquidationDrop,
    bridge: p.bridgeUsd > 0 ? { from, to, usd: p.bridgeUsd } : null,
    deploySteps: stepsFor(p.deploy.o, e),
    deployDrop: e.leverage ? e.leverage.liquidationDrop : null,
  });
}

/** The numbers of one combination: what is earned, what the loan costs, the bridge. */
function Breakdown({ p }: { p: Pair }) {
  const lines: [string, number][] = [
    [`سود فرصت دلاری (${FAMILY_LABEL[p.deploy.o.family] ?? p.deploy.o.family})`, p.estimate.net ?? 0],
    [`بهره‌ی وام (محتمل، ${formatPercent(p.funding.rate.likely, 2)})`, -p.funding.cost.likely],
    ...(p.bridgeUsd > 0 ? ([['پل رفت‌وبرگشت', -p.bridgeUsd]] as [string, number][]) : []),
  ];
  return (
    <dl className="flex flex-col text-sm">
      {lines.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-default">
          <dt className="text-secondary">{k}</dt>
          <dd className={tone(v)}>
            <Num>{usd(v)}</Num>
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 py-1.5">
        <dt className="text-primary font-medium">سود خالص (محتمل)</dt>
        <dd className={`font-semibold ${tone(p.net)}`}>
          <Num>{usd(p.net)}</Num>
        </dd>
      </div>
    </dl>
  );
}

function Chips({ p }: { p: Pair }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Pill>هم در: {alsoIn(p).join('، ')}</Pill>
      {p.bridgeUsd > 0 && <Pill tone="info">پل بین دو شبکه</Pill>}
      {p.funding.rate.rising && <Pill tone="warning">نرخ وام در حال بالا رفتن</Pill>}
      {p.estimate.leverage && <Pill tone="warning">لوپ <Num>{formatNumber(p.estimate.leverage.leverage, 1)}×</Num></Pill>}
    </div>
  );
}

function BestPair({ p, s }: { p: Pair; s: Stored }) {
  return (
    <section className="spotlight p-5 sm:p-7 flex flex-col gap-5" aria-label="بهترین ترکیب">
      <div className="flex items-center gap-2 text-sm text-accent font-medium">
        <Sparkles size={16} aria-hidden /> بهترین ترکیب برای <Num>{usd(s.valueUsd)}</Num> در <Num>{formatNumber(s.days, 0)}</Num> روز
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div className="flex flex-col gap-3 min-w-0">
          <Leg label="۱ · وام دلار" o={p.funding.o} line={<>وثیقه <bdi dir="ltr">{p.funding.collateral}</bdi> · نرخ <Num>{formatPercent(p.funding.rate.today, 2)}</Num></>} />
          <ArrowDown size={14} className="text-muted ms-2" aria-hidden />
          <Leg label="۲ · سرمایه‌گذاری دلار" o={p.deploy.o} line={<bdi>{p.deploy.o.market.name}</bdi>} />
        </div>
        <div className="flex flex-col sm:items-end shrink-0">
          <span className={`hero-num font-semibold ${tone(p.net)}`}>
            <Num>{usd(p.net)}</Num>
          </span>
          <span className="text-sm text-secondary">
            بدبینانه <Num>{usd(p.low)}</Num> · خوش‌بینانه <Num>{usd(p.high)}</Num>
          </span>
          <span className="text-xs text-muted">سود دلاری روی دارایی‌تان؛ قیمت خود دارایی ثابت فرض شده</span>
        </div>
      </div>
      <Chips p={p} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div className="rounded-xl border border-default bg-canvas p-4">
          <h3 className="text-sm font-semibold text-primary mb-3">قدم‌به‌قدم در اپ‌ها</h3>
          <StepList steps={stepsOf(p, s)} />
        </div>
        <div className="rounded-xl border border-default bg-canvas p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-primary">حساب</h3>
          <Breakdown p={p} />
          <div className="flex flex-wrap gap-2">
            {p.funding.o.url && (
              <a href={p.funding.o.url} target="_blank" rel="noopener noreferrer" className={`${primaryAction} grow`}>
                <ExternalLink size={15} aria-hidden /> بازار وام
              </a>
            )}
            {p.deploy.o.url && (
              <a href={p.deploy.o.url} target="_blank" rel="noopener noreferrer" className={`${ghostAction} grow min-h-11`}>
                <ExternalLink size={14} aria-hidden /> فرصت دلاری
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PairRow({ p, s, rank, open, onToggle }: { p: Pair; s: Stored; rank: number; open: boolean; onToggle: () => void }) {
  const symbol = p.deploy.o.assets.deposit[0]?.symbol ?? p.deploy.o.market.name;
  return (
    <li className="py-3">
      <div className="line-row">
        <button type="button" onClick={onToggle} aria-expanded={open} className="l-id flex items-center gap-2.5 min-w-0 text-right">
          <span className="grid place-items-center size-6 shrink-0 rounded-full bg-hover text-[11px] font-semibold text-muted num">{formatNumber(rank, 0)}</span>
          <LogoWithNetwork icon={p.deploy.o.icon} name={symbol} chain={networkByKey(p.deploy.o.chain).name} size={32} />
          <span className="min-w-0 flex flex-col leading-tight">
            <span className="text-sm font-semibold text-primary truncate">
              <bdi dir="ltr">{symbol}</bdi> <span className="font-normal text-secondary">· <bdi dir="ltr">{p.deploy.o.protocol.name}</bdi></span>
            </span>
            <span className="text-xs text-muted truncate">
              وام از <bdi dir="ltr">{p.funding.o.protocol.name}</bdi> {networkByKey(p.funding.o.chain).nameFa} · وثیقه <bdi dir="ltr">{p.funding.collateral}</bdi>
            </span>
          </span>
        </button>
        <div className="l-stats flex items-center gap-3 text-xs min-w-0">
          <span className="flex flex-col leading-tight">
            <span className="text-muted">نرخ وام</span>
            <span className="text-sm text-primary"><Num>{formatPercent(p.funding.rate.likely, 2)}</Num></span>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-muted">لیکویید با افت</span>
            <span className="text-sm text-primary"><Num>{formatPercent(p.funding.liquidationDrop * 100, 0)}</Num></span>
          </span>
        </div>
        <div className="l-pnl flex flex-col items-end gap-0.5">
          <span className={`text-lg font-semibold leading-tight ${tone(p.net)}`}><Num>{usd(p.net)}</Num></span>
          <span className="text-[11px] text-muted">بدبینانه <Num>{usd(p.low)}</Num></span>
        </div>
        <div className="l-act flex items-center gap-1.5">
          <button type="button" onClick={onToggle} aria-expanded={open} className={`${ghostAction} grow`}>
            قدم‌ها <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </div>
        <div className="l-tags">
          <Chips p={p} />
        </div>
      </div>
      {open && (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 rounded-xl border border-default bg-canvas p-3 sm:p-4">
          <StepList steps={stepsOf(p, s)} />
          <Breakdown p={p} />
        </div>
      )}
    </li>
  );
}

function FundingTable({ list }: { list: Funding[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-default">
            <th className="py-2 px-2 text-right font-medium">بازار وام</th>
            <th className="py-2 px-2 text-right font-medium">نرخ امروز / محتمل / بدبینانه</th>
            <th className="py-2 px-2 text-right font-medium">بهره‌ی دوره</th>
            <th className="py-2 px-2 text-right font-medium">لیکویید با افت</th>
            <th className="py-2 px-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-default">
          {list.map((f, i) => (
            <tr key={`${f.o.key}:${f.collateral}:${i}`}>
              <td className="py-2 px-2">
                <bdi dir="ltr">{f.o.protocol.name}</bdi> · {networkByKey(f.o.chain).nameFa} · <bdi dir="ltr">{f.collateral}</bdi>
                {f.rate.rising && <span className="text-warning text-xs"> · در حال بالا رفتن</span>}
              </td>
              <td className="py-2 px-2 whitespace-nowrap">
                <Num>{formatPercent(f.rate.today, 2)}</Num> / <Num>{formatPercent(f.rate.likely, 2)}</Num> / <Num>{formatPercent(f.rate.high, 2)}</Num>
              </td>
              <td className="py-2 px-2 text-danger whitespace-nowrap"><Num>{usd(-f.cost.likely)}</Num></td>
              <td className="py-2 px-2 whitespace-nowrap"><Num>{formatPercent(f.liquidationDrop * 100, 0)}</Num></td>
              <td className="py-2 px-2 text-left">
                {f.o.url && (
                  <a href={f.o.url} target="_blank" rel="noopener noreferrer" className="text-accent inline-flex items-center gap-1 text-xs">
                    <ExternalLink size={12} aria-hidden /> باز کردن
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * «وام با وثیقه»: an asset you keep as collateral, dollars borrowed against it, and those
 * dollars in the best dollar opportunity. Separate from the market ranking (a loan, a second
 * liquidation and often a bridge are added); every leg links to its app.
 */
export default function CollateralStrategy() {
  const [s, setS] = useState<Stored | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.collateral, {});
    setS({
      holding: typeof saved.holding === 'string' ? saved.holding : START.holding,
      valueUsd: typeof saved.valueUsd === 'number' && saved.valueUsd > 0 ? saved.valueUsd : START.valueUsd,
      ltvPct: LTVS.includes(saved.ltvPct as (typeof LTVS)[number]) ? (saved.ltvPct as number) : START.ltvPct,
      days: isHorizon(saved.days) ? saved.days : START.days,
      bridgeUsd: typeof saved.bridgeUsd === 'number' && saved.bridgeUsd >= 0 ? saved.bridgeUsd : START.bridgeUsd,
    });
  }, []);
  const patch = (p: Partial<Stored>) => {
    if (!s) return;
    const next = { ...s, ...p };
    setS(next);
    writeLocal(STORAGE_KEYS.collateral, next);
    setOpen(null);
  };

  const borrowUsd = s ? (s.valueUsd * s.ltvPct) / 100 : 0;
  const m = useMarketAnalysis(borrowUsd);
  const opps = m.lending.opportunities;
  const options = useMemo(() => (opps ? holdingOptions(opps) : []), [opps]);
  const holding: Holding | null = useMemo(() => options.find((o) => holdingId(o.holding) === s?.holding)?.holding ?? options[0]?.holding ?? null, [options, s?.holding]);
  const fundings = useMemo(() => (opps && s && holding ? fundingOptions(opps, { holding, valueUsd: s.valueUsd, ltv: s.ltvPct / 100, days: s.days }) : []), [opps, s, holding]);
  const pairs = useMemo(() => (m.analysis && s ? collateralPairs(fundings, m.analysis, s.days, s.bridgeUsd) : []), [fundings, m.analysis, s]);

  if (!s) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }

  const loading = m.lending.loading || m.loading || (!m.analysis && !m.failed);
  const best = pairs[0];
  const rest = pairs.slice(1);

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-5 lg:py-8 flex flex-col gap-4 lg:gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="page-title">وام با وثیقه</h1>
          <p className="page-sub max-w-2xl">دارایی‌تان (مثلاً BTC) را نگه دارید، با وثیقه‌اش دلار وام بگیرید و آن دلار را در بهترین فرصت بگذارید. جدا از رتبه‌بندی تحلیل بازار.</p>
        </div>
        <button type="button" onClick={m.refresh} disabled={m.refreshing} className="tap shrink-0 inline-flex items-center gap-1.5 rounded-md border border-default px-3 min-h-9 text-xs font-medium text-muted hover:text-primary hover:bg-elevated disabled:opacity-60" aria-label="به‌روزرسانی داده‌ها">
          <RefreshCw size={14} className={m.refreshing ? 'animate-spin' : ''} aria-hidden />
          {m.updatedAt ? formatAgo(m.updatedAt) : 'به‌روزرسانی'}
        </button>
      </header>

      <ol className="grid grid-cols-3 gap-2 text-xs sm:text-sm" aria-label="روش کار">
        {['دارایی را وثیقه بگذارید', 'دلار وام بگیرید', 'دلار را سرمایه‌گذاری کنید'].map((t, i) => (
          <li key={t} className="flex items-center gap-2 rounded-xl border border-default bg-surface px-3 py-2.5 text-secondary">
            <span className="grid place-items-center size-6 shrink-0 rounded-full bg-brand text-on-brand text-xs font-semibold num">{formatNumber(i + 1, 0)}</span>
            <span className="leading-snug">{t}</span>
          </li>
        ))}
      </ol>

      <section className="sx-card p-4 flex flex-col gap-3" aria-label="ورودی‌ها">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:items-end">
          <SelectField
            label="دارایی شما"
            value={holding ? holdingId(holding) : ''}
            onChange={(holding) => patch({ holding })}
            options={options.length ? options.map((o) => ({ value: holdingId(o.holding), label: `${o.label} (${formatNumber(o.markets, 0)} بازار)` })) : [{ value: '', label: loading ? 'در حال دریافت…' : '—' }]}
          />
          <NumberField label="ارزش دارایی" value={s.valueUsd} onChange={(v) => Number.isFinite(v) && v > 0 && patch({ valueUsd: v })} suffix="دلار" />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">LTV وام</span>
            <Segmented<`${(typeof LTVS)[number]}`> value={`${s.ltvPct}` as `${(typeof LTVS)[number]}`} onChange={(v) => patch({ ltvPct: Number(v) })} label="LTV وام" size="sm" options={LTVS.map((x) => ({ id: `${x}` as `${(typeof LTVS)[number]}`, label: <Num>{formatPercent(x, 0)}</Num> }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">مدت</span>
            <Segmented<`${HorizonDays}`> value={`${s.days}`} onChange={(v) => patch({ days: Number(v) as HorizonDays })} label="مدت" size="sm" options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-3 text-sm">
          <span className="text-secondary">
            وام: <b className="text-primary"><Num>{usd(borrowUsd)}</Num></b> دلار
            {fundings[0] && (
              <>
                {' '}· لیکوییدشدن اگر دارایی حدود <b className="text-warning"><Num>{formatPercent(fundings[0].liquidationDrop * 100, 0)}</Num></b> افت کند
              </>
            )}
          </span>
          <label className="flex items-center gap-2 text-secondary">
            هزینه‌ی کل پل
            <input type="number" min={0} step={0.5} value={s.bridgeUsd} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber >= 0 && patch({ bridgeUsd: e.target.valueAsNumber })} className="w-20 px-2 text-sm !min-h-9" aria-label="هزینه‌ی کل پل به دلار" />
            دلار
          </label>
        </div>
      </section>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-56 rounded-2xl bg-surface border border-default animate-pulse" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : m.failed ? (
        <Empty>منبعی پاسخ نداد.</Empty>
      ) : !fundings.length ? (
        <Empty>هیچ بازار وام دلاری این دارایی را با این LTV و این مبلغ نمی‌پذیرد. LTV یا مبلغ را کم کنید.</Empty>
      ) : !best ? (
        <Empty>برای این مبلغ فرصت دلاری سودده‌ای پیدا نشد.</Empty>
      ) : (
        <>
          <BestPair key={best.key} p={best} s={s} />

          {rest.length > 0 && (
            <section className="sx-card px-3 pt-3 sm:px-5 sm:pt-4 pb-1" aria-label="ترکیب‌های دیگر">
              <h2 className="flex items-baseline justify-between gap-3 pb-1">
                <span className="font-semibold text-primary">ترکیب‌های دیگر</span>
                <span className="text-xs text-muted">به ترتیب سود خالص محتمل</span>
              </h2>
              <ol className="rank-list flex flex-col divide-y divide-default">
                {rest.map((p, i) => (
                  <PairRow key={p.key} p={p} s={s} rank={i + 2} open={open === p.key} onToggle={() => setOpen(open === p.key ? null : p.key)} />
                ))}
              </ol>
            </section>
          )}

          <details className="group sx-card">
            <summary className="tap flex items-center justify-between gap-2 px-4 min-h-12 text-sm font-semibold text-primary">
              <span className="flex items-center gap-2">
                <Landmark size={16} className="text-accent" aria-hidden /> همه‌ی بازارهای وام برای این دارایی (<Num>{formatNumber(fundings.length, 0)}</Num>)
              </span>
              <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-muted" aria-hidden />
            </summary>
            <div className="px-3 pb-3 sm:px-4">
              <FundingTable list={fundings} />
            </div>
          </details>
        </>
      )}

      <section className="rounded-xl border border-default bg-surface p-4 flex flex-col gap-2 text-sm text-secondary leading-7" aria-label="هشدارها">
        <h2 className="flex items-center gap-2 font-semibold text-primary">
          <ShieldAlert size={16} className="text-warning" aria-hidden /> پیش از ورود
        </h2>
        <ul className="list-disc pr-5 flex flex-col gap-1 marker:text-muted">
          <li>قیمت دارایی وثیقه ثابت فرض شده؛ سود بالا دلار اضافه روی دارایی شماست و ریسک قیمت خود دارایی سر جایش است.</li>
          <li>دو جای لیکوییدشدن دارید: وام دلار (با افت قیمت دارایی) و اگر فرصت دوم لوپ است، خود لوپ. برای هر دو روی همان شبکه پول آماده داشته باشید.</li>
          <li>
            نرخ وام متغیر است: «محتمل» یعنی نرخ امروز، و برای بازار پر Morpho رشد خودکار آن در <Num>{formatNumber(COLLATERAL_POLICY.likelyDays, 0)}</Num> روز؛ «بدبینانه» <Num>{formatNumber(COLLATERAL_POLICY.highDays, 0)}</Num> روز.
          </li>
          <li>لوپ‌های PT با همان سیاست اهرم اپ (۳× یا ۲٫۵×) حساب شده‌اند، نه اهرم حداکثری.</li>
          <li className="flex gap-1.5 list-none -mr-5">
            <Info size={14} className="shrink-0 mt-1.5 text-accent" aria-hidden /> هزینه‌ی پل فرضی شماست (پیش‌فرض <Num>{formatNumber(COLLATERAL_POLICY.defaultBridgeUsd, 0)}</Num> دلار رفت‌وبرگشت)؛ فقط وقتی دو بخش روی دو شبکه‌اند کم می‌شود.
          </li>
        </ul>
      </section>
    </main>
  );
}
