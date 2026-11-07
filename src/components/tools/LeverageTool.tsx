'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, ChevronLeft, ExternalLink, Loader2, RefreshCw, SlidersHorizontal, Star, X } from 'lucide-react';
import type { LeverageFeed } from '../../lib/leverage/types';
import { assetsOf, DEFAULT_INPUT, LEVERAGE_STEPS, offersFor, PERIODS, rank, type LeverageInput, type Offer, type Ranking, type Side } from '../../lib/leverage/model';
import { analyzeLongShort } from '../../lib/longshort/model';
import { analyzeMultiply } from '../../lib/multiply/model';
import { networkByKey } from '../../lib/registry/networks';
import { assetLogo, platformLogo, tokenLogo } from '../../lib/leverage/logos';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { formatMultiplier, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { LogoWithNetwork } from '../ui/asset-identity';
import { TokenLogo } from '../ui/token-logo';
import { Empty, Metric, Pill, Segmented } from '../opportunities/parts';
import { Differences, Outcomes, PerpCompare, Review, Summary as LoopSummary } from './LongShortTool';
import { Assumptions, PayoffChart, ScenarioCard, StrategyLegend, Summary as MultiplySummary } from './MultiplyTool';

interface Settings extends LeverageInput {
  asset: string | null;
  /** Loop network filter (`solana:mainnet`, `eip155:8453`); «all» shows every network. The perp is always shown. */
  chain: string;
}
const initial: Settings = { ...DEFAULT_INPUT, asset: null, chain: 'all' };
const ROW_PARAM = 'row';
const DESKTOP = '(min-width: 1024px)';
const PUSHED = 'yieldxLeverageRow';

const isFinitePos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** Saved settings, or — the first time — the amount, leverage and period last used on the Long/Short or Multiply page. */
function restore(): Settings {
  const saved = readLocal<Partial<Settings> | null>(STORAGE_KEYS.leverage, null);
  if (saved) return { ...initial, ...saved };
  const ls = readLocal<Partial<LeverageInput>>(STORAGE_KEYS.longShort, {});
  const mu = readLocal<Partial<LeverageInput>>(STORAGE_KEYS.multiply, {});
  const from = isFinitePos(ls.capital) ? ls : mu;
  return {
    ...initial,
    side: ls.side === 'short' ? 'short' : 'long',
    capital: isFinitePos(from.capital) ? from.capital : initial.capital,
    leverage: isFinitePos(from.leverage) && from.leverage >= 1.5 ? Math.min(5, from.leverage) : initial.leverage,
    days: PERIODS.includes(from.days as (typeof PERIODS)[number]) ? (from.days as number) : initial.days,
  };
}

interface Cached {
  feed: LeverageFeed;
  /** When this copy was received, ms. */
  at: number;
}

/**
 * A source still loading on the server («pending») keeps the rows the last copy had,
 * so the list does not empty and refill on a refresh.
 */
export function mergeFeed(prev: LeverageFeed | null, next: LeverageFeed): LeverageFeed {
  if (!prev) return next;
  return {
    ...next,
    kamino: next.kaminoError === 'pending' && !next.kamino.length ? prev.kamino : next.kamino,
    pendle: next.pendleError === 'pending' && !next.pendle.length ? prev.pendle : next.pendle,
    perps: { ...prev.perps, ...next.perps },
  };
}
const isPending = (f: LeverageFeed | null | undefined) => f?.kaminoError === 'pending' || f?.pendleError === 'pending';

/** The feed, refreshed every minute while visible (every few seconds while a source is still loading); the last good copy is kept for offline use. */
function useLeverageFeed() {
  const [data, setData] = useState<Cached | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    return fetch('/api/leverage', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<LeverageFeed>) : Promise.reject(new Error(String(r.status)))))
      .then((feed) => {
        setData((prev) => {
          const next = { feed: mergeFeed(prev?.feed ?? null, feed), at: Date.now() };
          if (!isPending(feed)) writeLocal(STORAGE_KEYS.leverageFeed, next);
          return next;
        });
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const cached = readLocal<Cached | null>(STORAGE_KEYS.leverageFeed, null);
    if (cached?.feed && Array.isArray(cached.feed.kamino) && Array.isArray(cached.feed.pendle)) setData((d) => d ?? cached);
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
  // A source the server is still reading: ask again shortly.
  const pending = isPending(data?.feed);
  useEffect(() => {
    if (!pending || loading) return;
    const t = setTimeout(load, 6_000);
    return () => clearTimeout(t);
  }, [pending, loading, load]);
  return { data, failed, loading, pending, reload: load };
}

const readRow = () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(ROW_PARAM));

/**
 * The open offer lives in the URL (`?tab=leverage&row=…`). On a phone, opening one
 * pushes a history entry, so the system back gesture closes the detail and not the
 * page; on a wide screen, picking a row only replaces it (both are on screen).
 */
function useRowParam() {
  const [row, setRow] = useState<string | null>(null);
  useEffect(() => {
    setRow(readRow());
    const onPop = () => setRow(readRow());
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Leaving the tool: the other tools do not keep their state in the URL.
      const url = new URL(window.location.href);
      if (url.searchParams.has(ROW_PARAM) || url.searchParams.get('tab') === 'leverage') {
        url.searchParams.delete(ROW_PARAM);
        url.searchParams.delete('tab');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    };
  }, []);
  const open = useCallback((key: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'leverage');
    url.searchParams.set(ROW_PARAM, key);
    if (window.matchMedia(DESKTOP).matches || readRow() !== null) window.history.replaceState(window.history.state, '', url.toString());
    // Marked, so closing knows the list is one step back.
    else window.history.pushState({ ...window.history.state, [PUSHED]: true }, '', url.toString());
    setRow(key);
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.[PUSHED]) return window.history.back();
    // Opened from a link: there is no list behind it to go back to.
    const url = new URL(window.location.href);
    url.searchParams.delete(ROW_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
    setRow(null);
  }, []);
  return { row, open, close };
}

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const ago = (ms: number) => {
  const min = Math.round(ms / 60_000);
  if (min < 2) return 'همین الان';
  if (min < 60) return `${formatNumber(min, 0)} دقیقه پیش`;
  const h = Math.round(min / 60);
  return h < 48 ? `${formatNumber(h, 0)} ساعت پیش` : `${formatNumber(Math.round(h / 24), 0)} روز پیش`;
};
const venueName = (o: Offer) => (o.venue === 'perp' ? `پرپ ${o.protocol}` : o.protocol);
const placeOf = (o: Offer) => (o.venue === 'perp' ? 'Hyperliquid' : networkByKey(o.chain).nameFa);
/** The token's own logo (a perp shows its underlying's). */
const logoOf = (o: Offer) => (o.venue === 'perp' ? assetLogo(o.asset, o.kind) : tokenLogo(o.token, o.tokenIcon, o.kind));
const Platform = ({ o, size = 16 }: { o: Offer; size?: number }) => <TokenLogo src={platformLogo(o.protocol, o.protocolIcon)} name={o.protocol} size={size} square />;
/** The logo badge's network, by the name the logo registry knows. */
const badgeOf = (o: Offer) => (o.venue === 'perp' ? 'hyperliquid' : networkByKey(o.chain).name);

/**
 * «معامله‌ی اهرمی»: one leveraged long or short, compared across every venue the app
 * reads — Kamino Multiply, PendleLoop Long/Short (Aave, Morpho) and the Hyperliquid
 * perp. The list ranks by what holding costs over the period; the detail is each
 * venue's own page (Multiply's price paths, Long/Short's checks, the perp's terms).
 *
 * Wide screens: inputs and the list in a sticky side panel, the detail beside it.
 * Phones and the installed app: the list, then the detail as its own view with a URL,
 * so the system back gesture returns to the list.
 */
export function LeverageTool() {
  const { data, failed, loading, pending, reload } = useLeverageFeed();
  const { row: openKey, open, close } = useRowParam();
  const [s, setS] = useState<Settings | null>(null);
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setS(restore()), []);
  useEffect(() => {
    if (s) writeLocal(STORAGE_KEYS.leverage, s);
  }, [s]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const patch = useCallback((p: Partial<Settings>) => setS((x) => (x ? { ...x, ...p } : x)), []);
  const feed = data?.feed ?? null;

  const assets = useMemo(() => (feed && s ? assetsOf(feed, s.side) : []), [feed, s]);
  const asset = s && assets.find((a) => a.asset === s.asset) ? s.asset! : (assets[0]?.asset ?? null);
  const all = useMemo(() => (feed && s && asset ? offersFor(feed, asset, s) : []), [feed, s, asset]);
  const chains = useMemo(() => [...new Set(all.filter((o) => o.venue !== 'perp').map((o) => o.chain))], [all]);
  const chain = s && chains.includes(s.chain) ? s.chain : 'all';
  const ranking = useMemo(() => rank(chain === 'all' ? all : all.filter((o) => o.venue === 'perp' || o.chain === chain), s?.capital ?? 0), [all, chain, s?.capital]);
  // The open offer (URL), or on a wide screen the first one.
  const fromUrl = openKey ? (all.find((o) => o.key === openKey) ?? null) : null;
  const selected = fromUrl ?? ranking.offers[0] ?? null;

  // A link to an offer of another asset or side (a shared URL): show that asset.
  useEffect(() => {
    if (!feed || !s || !openKey || fromUrl) return;
    for (const side of ['long', 'short'] as const)
      for (const a of assetsOf(feed, side))
        if (offersFor(feed, a.asset, { ...s, side }).some((o) => o.key === openKey)) return patch({ side, asset: a.asset, chain: 'all' });
  }, [feed, s, openKey, fromUrl, patch]);

  const detailOpen = fromUrl !== null;
  // Phone: the detail replaces the list, so start it at the top.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detailOpen && !window.matchMedia(DESKTOP).matches) rootRef.current?.scrollIntoView({ block: 'start' });
  }, [detailOpen, openKey]);

  if (!s || (!data && loading) || (data && pending && !data.feed.kamino.length && !data.feed.pendle.length))
    return (
      <div className="grid place-items-center py-16 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </div>
    );
  if (!feed || (!feed.kamino.length && !feed.pendle.length))
    return (
      <Empty>
        داده‌ی Kamino و PendleLoop دریافت نشد.{' '}
        <button type="button" onClick={reload} className="tap text-accent underline">
          دوباره
        </button>
      </Empty>
    );

  const age = data ? now - data.at : 0;
  return (
    <div ref={rootRef} className="scroll-mt-[calc(var(--header-h)+0.5rem)] grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-start">
      <aside
        className={`${detailOpen ? 'hidden lg:flex' : 'flex'} min-w-0 flex-col gap-3 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:max-h-[calc(100dvh-var(--header-h)-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:pe-1`}
        aria-label="گزینه‌ها"
      >
        <Segmented<Side>
          value={s.side}
          onChange={(side) => patch({ side, chain: 'all' })}
          label="جهت"
          options={[
            { id: 'long', label: 'Long · صعودی' },
            { id: 'short', label: 'Short · نزولی' },
          ]}
        />
        {assets.length ? (
          <AssetStrip assets={assets} value={asset} onChange={(a) => patch({ asset: a, chain: 'all' })} />
        ) : (
          <Empty>برای {s.side === 'short' ? 'Short' : 'Long'} بازار وامی پیدا نشد.</Empty>
        )}
        {chains.length > 1 && (
          <Segmented<string>
            value={chain}
            onChange={(c) => patch({ chain: c })}
            label="شبکه‌ی وام"
            size="sm"
            options={[{ id: 'all', label: 'همه' }, ...chains.map((c) => ({ id: c, label: networkByKey(c).nameFa }))]}
          />
        )}

        {/* Phone: one line that opens the sheet. Wide screen: the fields themselves. */}
        <button type="button" onClick={() => setSheet(true)} className="lg:hidden tap flex items-center justify-between gap-2 rounded-xl border border-default bg-surface px-3 min-h-11 text-sm" aria-haspopup="dialog">
          <span className="flex items-center gap-1.5 flex-wrap">
            <Num>{formatUSD(s.capital, 0)}</Num>
            <span className="text-muted">·</span>
            <Num>{formatMultiplier(s.leverage, 1)}</Num>
            <span className="text-muted">·</span>
            <span>
              <Num>{formatNumber(s.days, 0)}</Num> روز
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-accent text-xs font-medium">
            <SlidersHorizontal size={14} aria-hidden /> تغییر
          </span>
        </button>
        <div className="hidden lg:block sx-card p-3">
          <Fields s={s} patch={patch} />
        </div>

        <p className="text-xs text-secondary">
          هر <Num>۱٪</Num> حرکت قیمت ≈ <Num>{usd(s.capital * s.leverage * 0.01)}</Num> سود یا زیان، در همه‌ی گزینه‌ها یکسان؛ فرقشان هزینه‌ی نگه‌داری و جای لیکوییدشدن است.
        </p>

        <SourceStatus feed={feed} reload={reload} loading={loading} />
        {asset && <OfferList ranking={ranking} selected={selected?.key ?? null} onPick={open} capital={s.capital} days={s.days} />}

        <p className="text-xs text-muted flex items-center gap-1.5">
          {failed ? <AlertTriangle size={12} className="text-warning" aria-hidden /> : <span className="size-1.5 rounded-full bg-success" aria-hidden />}
          {failed ? <>آفلاین یا خطا؛ داده‌ی {ago(age)}</> : <>داده‌ی {ago(age)}</>}
          {failed && (
            <button type="button" onClick={reload} className="tap inline-flex items-center gap-1 text-accent">
              <RefreshCw size={12} aria-hidden /> دوباره
            </button>
          )}
        </p>
      </aside>

      <section className={`${detailOpen ? 'flex' : 'hidden lg:flex'} flex-col gap-4 min-w-0`} aria-label="جزئیات">
        <button type="button" onClick={close} className="lg:hidden tap self-start inline-flex items-center gap-1 text-sm text-secondary hover:text-primary min-h-11">
          <ArrowRight size={16} aria-hidden /> همه‌ی گزینه‌های <bdi dir="ltr">{asset}</bdi>
        </button>
        {selected ? <Detail offer={selected} ranking={ranking} feed={feed} s={s} /> : <Empty>گزینه‌ای برای این دارایی نیست.</Empty>}
      </section>

      {sheet && <SettingsSheet s={s} patch={patch} onClose={() => setSheet(false)} />}
    </div>
  );
}

function AssetStrip({ assets, value, onChange }: { assets: ReturnType<typeof assetsOf>; value: string | null; onChange: (a: string) => void }) {
  const kinds = new Set(assets.map((a) => a.kind));
  const [kind, setKind] = useState<'all' | 'crypto' | 'stocks'>('all');
  const shown = kind === 'all' ? assets : assets.filter((a) => a.kind === kind);
  const strip = useRef<HTMLDivElement>(null);
  // The picked asset stays in view (it may be far along the strip after a link or a reload).
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const box = strip.current;
    if (!el || !box) return;
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right) box.scrollBy({ left: a.left + a.width / 2 - (b.left + b.width / 2) });
  }, [value, kind]);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {kinds.size > 1 && (
        <Segmented<'all' | 'crypto' | 'stocks'>
          value={kind}
          onChange={setKind}
          label="دسته"
          size="sm"
          options={[
            { id: 'all', label: 'همه' },
            { id: 'crypto', label: 'کریپتو' },
            { id: 'stocks', label: 'سهام' },
          ]}
        />
      )}
      <div ref={strip} className="strip -mx-[var(--space-page-x)] px-[var(--space-page-x)] lg:mx-0 lg:px-0 flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="دارایی">
        {shown.map((a) => {
          const on = a.asset === value;
          return (
            <button
              key={a.asset}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(a.asset)}
              className={`tap shrink-0 inline-flex items-center gap-1.5 rounded-full border ps-1.5 pe-3 min-h-10 text-sm font-medium ${on ? 'border-accent bg-accent/10 text-primary' : 'border-default bg-surface text-secondary hover:bg-elevated hover:text-primary'}`}
            >
              <TokenLogo src={assetLogo(a.asset, a.kind) ?? a.icon} name={a.asset} size={22} />
              <bdi dir="ltr">{a.asset}</bdi>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Fields({ s, patch }: { s: Settings; patch: (p: Partial<Settings>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <NumberField label="سرمایه" value={s.capital} onChange={(v) => patch({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-secondary">اهرم</span>
        <Segmented<string> value={String(s.leverage)} onChange={(v) => patch({ leverage: Number(v) })} label="اهرم" size="sm" options={LEVERAGE_STEPS.map((x) => ({ id: String(x), label: <Num>{formatMultiplier(x, 1)}</Num> }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-secondary">مدت نگه‌داری</span>
        <Segmented<string> value={String(s.days)} onChange={(v) => patch({ days: Number(v) })} label="مدت" size="sm" options={PERIODS.map((d) => ({ id: String(d), label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
      </div>
      <details className="group">
        <summary className="tap cursor-pointer list-none text-xs text-secondary min-h-9 flex items-center gap-1 hover:text-primary">
          <ChevronLeft size={14} className="transition-transform group-open:-rotate-90" aria-hidden />
          اسلیپیج سواپ <Num>{formatPercent(s.swapPct, 2)}</Num> · کارمزد پرپ <Num>{formatPercent(s.perpFeePct, 3)}</Num>
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <NumberField label="اسلیپیج سواپ (لوپ)" value={s.swapPct} onChange={(v) => patch({ swapPct: Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : 0 })} suffix="٪" />
          <NumberField label="کارمزد پرپ" value={s.perpFeePct} onChange={(v) => patch({ perpFeePct: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0 })} suffix="٪" />
        </div>
      </details>
    </div>
  );
}

/** Phone: the inputs in a sheet from the bottom, above the tab bar. */
function SettingsSheet({ s, patch, onClose }: { s: Settings; patch: (p: Partial<Settings>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-labelledby="lev-sheet-title">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="بستن" tabIndex={-1} />
      <div ref={ref} className="relative rounded-t-2xl border-t border-default bg-surface px-[var(--space-page-x)] pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-3 max-h-[85dvh] overflow-y-auto">
        <span className="mx-auto h-1 w-10 rounded-full bg-strong" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 id="lev-sheet-title" className="font-semibold">
            مبلغ، اهرم و مدت
          </h2>
          <button type="button" onClick={onClose} className="tap grid place-items-center size-10 rounded-full text-secondary hover:bg-elevated" aria-label="بستن">
            <X size={18} aria-hidden />
          </button>
        </div>
        <Fields s={s} patch={patch} />
        <button type="button" onClick={onClose} className="tap rounded-xl bg-accent text-white font-semibold min-h-12">
          نمایش گزینه‌ها
        </button>
      </div>
    </div>
  );
}

function SourceStatus({ feed, reload, loading }: { feed: LeverageFeed; reload: () => void; loading: boolean }) {
  const sources: [string, string | null][] = [
    ['Kamino', feed.kaminoError],
    ['PendleLoop', feed.pendleError],
    ['پرپ Hyperliquid', feed.perpError],
  ];
  const waiting = sources.filter(([, e]) => e === 'pending').map(([n]) => n);
  const down = sources.filter(([, e]) => e && e !== 'pending').map(([n]) => n);
  return (
    <>
      {waiting.length > 0 && (
        <p className="rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-secondary flex items-center gap-2" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          داده‌ی تازه‌ی {waiting.join('، ')} در حال دریافت است؛ فهرست بعد از رسیدنش کامل می‌شود.
        </p>
      )}
      {down.length > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning flex items-center gap-2 flex-wrap">
          <AlertTriangle size={14} aria-hidden />
          داده‌ی {down.join('، ')} این بار دریافت نشد؛ گزینه‌های آن در فهرست نیستند، نه این‌که وجود نداشته باشند.
          <button type="button" onClick={reload} disabled={loading} className="tap inline-flex items-center gap-1 text-accent font-medium">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden /> دوباره
          </button>
        </p>
      )}
    </>
  );
}

const VERDICT: Record<Ranking['verdict'], ((r: Ranking) => ReactNode) | null> = {
  best: null,
  tie: () => 'هزینه‌ها تقریباً برابرند؛ شبکه و پروتکلی را انتخاب کنید که سرمایه‌تان همان‌جاست.',
  uncertain: (r) => (r.offers[0]?.flags.rateJump ? 'ارزان‌ترین گزینه بخش بزرگی از نقدینگی بازارش را وام می‌گیرد؛ نرخ وام بعد از آن بالا می‌رود و هزینه‌ی واقعی از این عدد بیشتر است.' : 'ارزان‌ترین گزینه دارایی کم‌نقدینه را در حجم بالا سواپ می‌کند؛ اسلیپیج واقعی ممکن است از عدد واردشده خیلی بیشتر باشد.'),
  single: () => 'با این اهرم و مبلغ فقط همین یک گزینه ممکن است.',
  none: () => 'با این اهرم یا مبلغ هیچ گزینه‌ای ممکن نیست؛ اهرم یا مبلغ را کم کنید.',
};

function OfferList({ ranking, selected, onPick, capital, days }: { ranking: Ranking; selected: string | null; onPick: (key: string) => void; capital: number; days: number }) {
  const usable = ranking.offers.slice(0, ranking.usable);
  const blocked = ranking.offers.slice(ranking.usable);
  const cheapest = usable[0]?.cost.totalUsd ?? 0;
  const perp = usable.find((o) => o.venue === 'perp');
  const best = usable.find((o) => ranking.best.includes(o.key));
  const note = VERDICT[ranking.verdict]?.(ranking);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs text-secondary px-1">
        <span>هزینه‌ی کل در <Num>{formatNumber(days, 0)}</Num> روز</span>
        <span>ارزان‌ترین اول</span>
      </div>
      <ul className="flex flex-col gap-2" role="radiogroup" aria-label="گزینه‌ها">
        {usable.map((o) => (
          <li key={o.key}>
            <OfferRow o={o} on={o.key === selected} star={ranking.best[0] === o.key ? 'best' : ranking.best.includes(o.key) ? 'near' : null} gap={o.cost.totalUsd - cheapest} onPick={onPick} />
          </li>
        ))}
      </ul>
      {note && <p className="text-xs text-secondary leading-6 px-1">{note}</p>}
      {best && perp && best.venue !== 'perp' && perp.cost.totalUsd - best.cost.totalUsd >= 1 && (
        <p className="text-xs text-secondary leading-6 px-1">
          در این مدت <span className="text-primary font-medium">{venueName(best)}</span> حدود <Num className="text-success font-medium">{usd(perp.cost.totalUsd - best.cost.totalUsd)}</Num> ارزان‌تر از پرپ است
          {capital > 0 && <> (<Num>{formatPercent(((perp.cost.totalUsd - best.cost.totalUsd) / capital) * 100, 1)}</Num> سرمایه)</>}.
        </p>
      )}
      {blocked.length > 0 && (
        <details className="group">
          <summary className="tap cursor-pointer list-none text-xs text-secondary px-1 min-h-9 flex items-center gap-1 hover:text-primary">
            <ChevronLeft size={14} className="transition-transform group-open:-rotate-90" aria-hidden />
            <Num>{formatNumber(blocked.length, 0)}</Num> گزینه‌ی دیگر با این اهرم یا مبلغ ممکن نیست
          </summary>
          <ul className="flex flex-col gap-2 mt-2" role="radiogroup" aria-label="گزینه‌های ناممکن">
            {blocked.map((o) => (
              <li key={o.key}>
                <OfferRow o={o} on={o.key === selected} star={null} gap={0} onPick={onPick} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function OfferRow({ o, on, star, gap, onPick }: { o: Offer; on: boolean; star: 'best' | 'near' | null; gap: number; onPick: (key: string) => void }) {
  const income = o.cost.totalUsd < 0;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => onPick(o.key)}
      className={`tap w-full rounded-xl border px-3 py-2.5 flex flex-col gap-1.5 text-start transition-colors ${on ? 'lg:border-accent lg:bg-accent/8 border-default bg-surface' : 'border-default bg-surface hover:bg-elevated'} ${o.blocked ? 'opacity-70' : ''}`}
    >
      <span className="flex items-center gap-2.5 w-full">
        <LogoWithNetwork icon={logoOf(o)} name={o.token} chain={badgeOf(o)} size={32} />
        <span className="flex flex-col min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1.5 min-w-0">
            <Platform o={o} />
            <span className="font-semibold truncate">{venueName(o)}</span>
            {star === 'best' && (
              <Pill tone="accent">
                <Star size={11} className="fill-current" aria-hidden /> ارزان‌ترین
              </Pill>
            )}
            {star === 'near' && <Pill>تقریباً برابر</Pill>}
          </span>
          <span className="text-xs text-secondary truncate">
            <bdi dir="ltr">{o.venue === 'perp' ? `${o.token}-PERP` : o.token}</bdi>
            {o.venue === 'perp' && o.fundingPct !== null && (
              <>
                {' '}
                · فاندینگ <Num>{formatPercent(o.fundingPct, 1, true)}</Num>
              </>
            )}
            {o.debt && (
              <>
                {' '}
                · وام <bdi dir="ltr">{o.side === 'long' ? o.debt : o.token}</bdi>
              </>
            )}
            {o.venue !== 'perp' && <> · {placeOf(o)}</>}
          </span>
        </span>
        <span className="flex flex-col items-end shrink-0 leading-tight">
          <span className={`font-semibold ${income ? 'text-success' : 'text-primary'}`}>
            {income ? <span className="text-xs font-normal">درآمد </span> : null}
            <Num>{usd(Math.abs(o.cost.totalUsd))}</Num>
          </span>
          {gap >= 0.005 && !o.blocked && (
            <span className="text-xs text-secondary">
              <Num>{formatUSD(gap, gap >= 100 ? 0 : 2, true)}</Num>
            </span>
          )}
        </span>
        <ChevronLeft size={18} className="lg:hidden text-muted shrink-0" aria-hidden />
      </span>
      <span className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-secondary ps-[42px]">
        {o.blocked ? (
          <span className="text-danger">
            {o.blocked.reason === 'leverage' ? (
              <>
                سقف اهرم <Num>{formatMultiplier(o.blocked.max, 1)}</Num>
              </>
            ) : (
              <>
                نقدینگی قابل وام فقط <Num>{formatUSDCompact(o.blocked.availableUsd)}</Num>
              </>
            )}
          </span>
        ) : (
          <>
            <span>
              سربه‌سر <Num>{formatPercent(o.breakEvenMove * 100, 2, true)}</Num>
            </span>
            {o.liqMove !== null && (
              <span>
                لیکویید <Num className="text-danger">{formatPercent(o.liqMove * 100, 0, true)}</Num>
              </span>
            )}
          </>
        )}
        {o.flags.weekend && <Pill tone="warning">آخر هفته قیمت ثابت</Pill>}
        {o.flags.rateJump && !o.blocked && <Pill tone="warning">نقدینگی کم بازار</Pill>}
        {o.flags.thinSwap && !o.blocked && <Pill tone="warning">اسلیپیج نامعلوم</Pill>}
      </span>
    </button>
  );
}

const CostLine = ({ label, value, hint }: { label: string; value: number; hint?: ReactNode }) =>
  Math.abs(value) < 0.005 ? null : (
    <tr className="border-t border-default">
      <td className="py-1.5 text-secondary">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </td>
      <td className={`py-1.5 text-end ${value < 0 ? 'text-success' : ''}`}>
        <Num>{formatUSD(-value, Math.abs(value) >= 100 ? 0 : 2, true)}</Num>
      </td>
    </tr>
  );

/** What the period costs on this venue, part by part, against the cheapest. */
function CostCard({ o, ranking, s }: { o: Offer; ranking: Ranking; s: Settings }) {
  const cheapest = ranking.offers[0];
  const gap = cheapest && !o.blocked && cheapest.key !== o.key ? o.cost.totalUsd - cheapest.cost.totalUsd : 0;
  return (
    <section className="sx-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <LogoWithNetwork icon={logoOf(o)} name={o.token} chain={badgeOf(o)} size={48} />
          <div className="flex flex-col min-w-0">
            <h2 className="font-semibold text-lg flex items-center gap-1.5 flex-wrap">
              <bdi dir="ltr">{o.token}</bdi>
              <Pill tone={o.side === 'long' ? 'success' : 'danger'}>{o.side === 'long' ? 'Long' : 'Short'}</Pill>
              {ranking.best[0] === o.key && (
                <Pill tone="accent">
                  <Star size={11} className="fill-current" aria-hidden /> ارزان‌ترین
                </Pill>
              )}
            </h2>
            <span className="text-sm text-secondary inline-flex items-center gap-1.5 flex-wrap">
              <Platform o={o} />
              {venueName(o)}
              {o.market ? <> · {o.market}</> : null} · {placeOf(o)}
            </span>
          </div>
        </div>
        <a href={o.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 text-sm text-accent min-h-10">
          باز کردن در {o.venue === 'perp' ? o.protocol : o.venue === 'kamino' ? 'Kamino' : 'PendleLoop'} <ExternalLink size={14} aria-hidden />
        </a>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label={`هزینه در ${formatNumber(s.days, 0)} روز`} tone={o.cost.totalUsd < 0 ? 'text-success' : 'text-primary'} hint={gap > 0.005 ? <><Num>{formatUSD(gap, 2, true)}</Num> از ارزان‌ترین</> : ranking.best[0] === o.key ? 'ارزان‌ترین' : undefined}>
          <Num>{formatUSD(-o.cost.totalUsd, 2, true)}</Num>
        </Metric>
        <Metric label="سربه‌سر" hint={`قیمت باید این‌قدر ${o.side === 'long' ? 'بالا' : 'پایین'} برود`}>
          <Num>{formatPercent(o.breakEvenMove * 100, 2, true)}</Num>
        </Metric>
        <Metric label="حرکت تا لیکوییدشدن" tone="text-danger" hint={o.venue === 'perp' ? 'با حاشیه‌ی نگه‌داری پرپ' : 'با LLTV بازار وام'}>
          {o.liqMove === null ? '—' : <Num>{formatPercent(o.liqMove * 100, 1, true)}</Num>}
        </Metric>
        <Metric label="سقف اهرم" hint={o.blocked?.reason === 'leverage' ? <span className="text-danger">کمتر از اهرم انتخابی</span> : undefined}>
          <Num>{formatMultiplier(o.maxLeverage, 1)}</Num>
        </Metric>
      </div>

      <table className="w-full text-sm">
        <caption className="text-start text-xs text-secondary pb-1">اجزای هزینه (منفی هزینه است، مثبت درآمد)</caption>
        <tbody>
          <CostLine label="بهره‌ی وام" value={o.cost.interestUsd} />
          <CostLine label="بازده وثیقه" value={-o.cost.yieldUsd} hint="سود سپرده و استیکینگ خود وثیقه" />
          <CostLine label="فاندینگ" value={o.cost.fundingUsd} hint="میانگین ۷ روز، روی کل موقعیت" />
          <CostLine label="سواپ باز و بسته" value={o.cost.swapUsd} hint={o.venue === 'kamino' ? 'اسلیپیج واردشده و کارمزد فلش‌لون' : 'اسلیپیج واردشده'} />
          <CostLine label={o.venue === 'perp' ? 'کارمزد معامله' : 'کارمزد PendleLoop'} value={o.cost.feeUsd} />
          <tr className="border-t border-strong font-semibold">
            <td className="py-1.5">جمع</td>
            <td className={`py-1.5 text-end ${o.cost.totalUsd < 0 ? 'text-success' : ''}`}>
              <Num>{formatUSD(-o.cost.totalUsd, 2, true)}</Num>
            </td>
          </tr>
        </tbody>
      </table>

      <ul className="flex flex-col gap-1.5 text-xs leading-6">
        {o.blocked && (
          <li className="text-danger">
            {o.blocked.reason === 'leverage' ? <>این بازار حداکثر <Num>{formatMultiplier(o.blocked.max, 1)}</Num> اهرم می‌دهد؛ جزئیات پایین با همان سقف حساب شده است.</> : <>این بازار الان فقط <Num>{formatUSDCompact(o.blocked.availableUsd)}</Num> برای وام دارد؛ این موقعیت باز نمی‌شود.</>}
          </li>
        )}
        {o.flags.rateJump && !o.blocked && <li className="text-warning">وام این موقعیت بیش از یک‌پنجم نقدینگی قابل وام بازار است؛ با گرفتنش نرخ وام بالا می‌رود و هزینه از این بیشتر می‌شود.</li>}
        {o.flags.thinSwap && !o.blocked && <li className="text-warning">برای سواپ این حجم از دارایی کم‌نقدینه، اسلیپیج واقعی ممکن است از عدد واردشده خیلی بیشتر باشد؛ قبل از باز کردن، قیمت سواپ را در خود سایت ببینید.</li>}
        {o.flags.inexact && <li className="text-secondary">قیمت <bdi dir="ltr">{o.token}</bdi> با پرپ <bdi dir="ltr">{o.asset}</bdi> نزدیک ولی یکی نیست؛ مقایسه‌ی هزینه درست است، سود و زیان دقیقاً یکی نیست.</li>}
      </ul>
    </section>
  );
}

function PerpDetail({ o, feed, s }: { o: Offer; feed: LeverageFeed; s: Settings }) {
  const ref = feed.perps[o.key.replace(/^perp:/, '')];
  if (!ref) return null;
  return (
    <section className="sx-card p-4 flex flex-col gap-3">
      <h3 className="font-semibold">پرپ <bdi dir="ltr">{ref.coin}</bdi> روی {ref.venue}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="فاندینگ میانگین ۷ روز" hint="در سال؛ مثبت یعنی Long می‌پردازد">
          {ref.funding7dPct === null ? '—' : <Num>{formatPercent(ref.funding7dPct, 1, true)}</Num>}
        </Metric>
        <Metric label="فاندینگ الان" hint="هر ساعت عوض می‌شود">
          <Num>{formatPercent(ref.fundingNowPct, 1, true)}</Num>
        </Metric>
        <Metric label="اندازه‌ی موقعیت" hint={<>اهرم <Num>{formatMultiplier(s.leverage, 1)}</Num></>}>
          <Num>{formatUSDCompact(o.exposureUsd)}</Num>
        </Metric>
        <Metric label="قیمت مارک">
          <Num>{formatUSD(ref.markPx, ref.markPx < 10 ? 4 : 2)}</Num>
        </Metric>
      </div>
      <p className="text-xs text-secondary leading-6">
        فاندینگ روی کل موقعیت گرفته می‌شود، نه فقط بخش وام؛ برای همین در نگه‌داری طولانی معمولاً از بهره‌ی بازار وام گران‌تر است. علامتش هم می‌تواند برگردد. لیکوییدشدن با قیمت مارک صرافی و حاشیه‌ی نگه‌داری است، ۲۴ ساعت و ۷ روز هفته.
      </p>
    </section>
  );
}

function Detail({ offer, ranking, feed, s }: { offer: Offer; ranking: Ranking; feed: LeverageFeed; s: Settings }) {
  const input = { capital: s.capital, leverage: s.leverage, days: s.days, swapPct: s.swapPct, perpFeePct: s.perpFeePct };
  const kRow = offer.venue === 'kamino' ? feed.kamino.find((r) => r.key === offer.key) : undefined;
  const pRow = offer.venue === 'pendleloop' ? feed.pendle.find((r) => r.key === offer.key) : undefined;
  const ka = useMemo(() => (kRow && s.capital > 0 ? analyzeMultiply(kRow, { capital: s.capital, leverage: s.leverage, days: s.days, swapPct: s.swapPct }) : null), [kRow, s.capital, s.leverage, s.days, s.swapPct]);
  const pa = useMemo(
    () => (pRow && s.capital > 0 ? analyzeLongShort(pRow, { capital: s.capital, leverage: s.leverage, days: s.days, swapPct: s.swapPct, perpFeePct: s.perpFeePct }) : null),
    [pRow, s.capital, s.leverage, s.days, s.swapPct, s.perpFeePct],
  );
  return (
    <>
      <CostCard o={offer} ranking={ranking} s={s} />
      {offer.venue === 'perp' && <PerpDetail o={offer} feed={feed} s={s} />}
      {kRow && ka && (
        <>
          <MultiplySummary row={kRow} a={ka} capital={s.capital} />
          <PayoffChart row={kRow} a={ka} capital={s.capital} days={s.days} />
          <h3 className="font-semibold mt-1">شش مسیر قیمت، پنج روش مدیریت</h3>
          <div className="grid gap-3 xl:grid-cols-2">
            {ka.scenarios.map((sc) => (
              <ScenarioCard key={sc.scenario} sc={sc} row={kRow} liq={ka.leverage > 1 ? ka.liqPrice : 0} />
            ))}
          </div>
          <StrategyLegend />
          <Assumptions row={kRow} a={ka} />
        </>
      )}
      {pRow && pa && (
        <>
          <LoopSummary row={pRow} a={pa} s={input} />
          <Review row={pRow} a={pa} s={input} />
          <Outcomes row={pRow} a={pa} />
          {pa.perp && <PerpCompare row={pRow} a={pa} s={input} />}
        </>
      )}
      {offer.venue !== 'kamino' && <Differences />}
      <p className="text-xs text-secondary leading-6">
        نرخ‌ها برای کل دوره ثابت فرض شده‌اند: نرخ وام بیشترِ امروز و میانگین ۷ روز، فاندینگ میانگین ۷ روز. هزینه‌ها تخمین‌اند و با بازار عوض می‌شوند. منبع: API عمومی Kamino، PendleLoop (پندل) و Hyperliquid.
      </p>
    </>
  );
}
