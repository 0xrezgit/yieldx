'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Calculator, Check, ChevronLeft, ClipboardCheck, Loader2, Search } from 'lucide-react';
import protocols from '../../config/protocols.json';
import thresholds from '../../config/thresholds.json';
import type { MarketData, MarketListing } from '../../types/market';
import type { LoopInfo, OracleMode, Position, PositionKind } from '../../types/position';
import { emptyManual, emptyTargets } from '../../types/position';
import type { ProtocolId } from '../../types/protocol';
import { fetchMarket, fetchMarkets } from '../../lib/data/market-data';
import { isLoopable } from '../../lib/risk/opportunities';
import { chainFa, chainLogo, KIND_FA, protocolLogo, RATE_FA } from '../../lib/portfolio/labels';
import { newId } from '../../lib/portfolio/portfolio';
import { apyFromPT } from '../../lib/portfolio/valuation';
import { usePortfolio } from '../../hooks/usePortfolio';
import { formatDate, formatNumber, formatPercent } from '../../lib/utils/formatting';
import { formatDollar, formatDollarCompact, priceDigits } from '../../lib/portfolio/format';
import { NumberField, SelectField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { LogoWithNetwork } from '../ui/asset-identity';
import { draftToEvent, emptyDraft, EventFields, validateDraft, type Draft } from './EventForm';
import { btn, NoWalletNote, Panel, Segmented, SxPage } from './parts';
import { TokenSelect, useTokenPrice } from './TokenSelect';
import { tokensForChain } from '../../lib/portfolio/tokens';
import type { RateSource } from '../../types/position';

const LIVE: ProtocolId[] = (Object.keys(protocols) as ProtocolId[]).filter((id) => protocols[id].liveData);
const STEPS = ['پلتفرم', 'شبکه', 'بازار', 'نوع', 'جزئیات'];
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id);

type Mode = 'plan' | 'record';

const defaultLoop = (debtAsset: string): LoopInfo => ({
  lendingPlatform: '',
  lendingMarket: '',
  debtAsset,
  debtIsAccountingAsset: true,
  debtAssetUsd: null,
  borrowAPY: 5,
  lltv: 86,
  oracle: 'unknown',
  oraclePtPrice: null,
  debtOverride: null,
});

/** One option of a single-choice group (radio semantics: role=radio inside role=radiogroup). */
function Choice({ selected, onClick, children, disabled }: { selected?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      onClick={onClick}
      disabled={disabled}
      aria-checked={!!selected}
      className={`w-full text-right rounded-lg border p-4 min-h-16 flex items-center gap-3.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        selected ? 'border-sx-accent bg-sx-accent/10 ring-1 ring-sx-accent' : 'border-sx-border bg-sx-surface hover:border-strong hover:bg-sx-raised'
      }`}
    >
      <span className={`grid place-items-center size-5 rounded-full border-2 shrink-0 ${selected ? 'border-sx-accent' : 'border-control'}`} aria-hidden>
        {selected && <span className="size-2.5 rounded-full bg-sx-accent" />}
      </span>
      {children}
    </button>
  );
}

/** Choices made so far, each one editable (jumps back to its step). */
function Summary({ items }: { items: { step: number; label: string; value: ReactNode; go: () => void }[] }) {
  if (!items.length) return null;
  return (
    <dl className="sx-card px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm" aria-label="انتخاب‌های شما">
      {items.map((i) => (
        <div key={i.step} className="flex items-center justify-between gap-2 min-w-0">
          <dt className="text-sx-muted shrink-0">{i.label}</dt>
          <dd className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sx-text">{i.value}</span>
            <button type="button" onClick={i.go} className="tap text-sx-accent underline underline-offset-4 shrink-0">
              ویرایش
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function NewPosition() {
  const router = useRouter();
  const { save } = usePortfolio();
  const [step, setStep] = useState(0);
  const [protocol, setProtocol] = useState<ProtocolId | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [markets, setMarkets] = useState<MarketListing[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [query, setQuery] = useState('');
  const [showExpired, setShowExpired] = useState(false);
  const [market, setMarket] = useState<MarketListing | null>(null);
  const [live, setLive] = useState<MarketData | null>(null);
  const [kind, setKind] = useState<PositionKind | null>(null);
  const [mode, setMode] = useState<Mode>('record');
  const [assetSymbol, setAssetSymbol] = useState('');
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('buy'));
  const [loop, setLoop] = useState<LoopInfo>(defaultLoop(''));
  const [borrowed, setBorrowed] = useState(NaN);
  const [borrowUsd, setBorrowUsd] = useState(NaN);
  const [borrowSource, setBorrowSource] = useState<RateSource>('unknown');
  const [points, setPoints] = useState<Position['points']>({ perDay: 0, multiplier: 1, basis: 'unit', valuePerPoint: 0 });
  // Pre-trade planner.
  const [planAmount, setPlanAmount] = useState(1000);
  const [planToken, setPlanToken] = useState('');
  const [planFee, setPlanFee] = useState(thresholds.exit.costPercent);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!protocol) return;
    const ctrl = new AbortController();
    setListState('loading');
    setMarkets([]);
    fetchMarkets(protocol, ctrl.signal)
      .then((m) => {
        setMarkets(m);
        setListState('idle');
      })
      .catch(() => !ctrl.signal.aborted && setListState('error'));
    return () => ctrl.abort();
  }, [protocol]);

  useEffect(() => {
    if (!market || !protocol) return;
    setLive(null);
    const ctrl = new AbortController();
    fetchMarket(protocol, market.id, 0, ctrl.signal)
      .then(({ market: m }) => {
        setLive(m);
        const sym = m.assetSymbol ?? '';
        setAssetSymbol(sym);
        setDraft((d) => ({ ...d, cash: { ...d.cash, token: d.cash.token || sym } }));
        setPlanToken((t) => t || sym);
        setLoop((l) => ({ ...l, debtAsset: l.debtAsset || sym }));
        if (m.points) setPoints((p) => ({ ...p, perDay: m.points!.pointsPerDay, multiplier: m.points!.ytMultiplier, basis: m.points!.basis }));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [market, protocol]);

  const chains = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of markets) if (!m.expired) map.set(m.chain, (map.get(m.chain) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [markets]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markets
      .filter((m) => m.chain === chain && (showExpired || !m.expired))
      .filter((m) => !q || [m.name, m.platform ?? '', m.id, ...m.categories].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
  }, [markets, chain, query, showExpired]);

  // Several markets can share a symbol: those rows show maturity and id prominently.
  const dupNames = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of list) c.set(m.name, (c.get(m.name) ?? 0) + 1);
    return new Set([...c.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [list]);

  const tokenPrice = live ? (kind === 'yt' ? live.ytPrice : live.ptPrice) : NaN;
  const assetUsd = live?.underlyingPrice ?? null;
  const tokens = useMemo(() => (market ? tokensForChain(market.chain, { symbol: assetSymbol, icon: market.icon }) : []), [market, assetSymbol]);
  const [nowIso] = useState(() => new Date().toISOString());
  const planPrice = useTokenPrice(planToken, nowIso);
  // The market's own asset may be unlisted; its live USD price comes from the market.
  const planUsdRate = planPrice?.usd ?? (planToken && planToken.toLowerCase() === assetSymbol.toLowerCase() ? assetUsd : null);
  const planUsd = planUsdRate !== null && planUsdRate !== undefined ? planAmount * planUsdRate : NaN;
  const debtPrice = useTokenPrice(loop.debtIsAccountingAsset ? '' : loop.debtAsset, draft.at);
  useEffect(() => {
    if (debtPrice && borrowSource !== 'manual') {
      setBorrowUsd(debtPrice.usd);
      setBorrowSource(debtPrice.source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the fetched price only
  }, [debtPrice?.usd, debtPrice?.source]);

  const draftError = validateDraft(draft);
  const loopError =
    kind === 'loop' && (!(borrowed > 0) || !loop.debtAsset.trim() || !(loop.lltv > 0 && loop.lltv < 100) || !(loop.borrowAPY >= 0))
      ? 'مقدار وام، دارایی بدهی، نرخ بهره و آستانه‌ی لیکویید شدن را کامل کنید.'
      : null;

  const create = () => {
    if (!protocol || !market || !kind) return;
    const buy = draftToEvent(draft);
    const events = [buy];
    if (kind === 'loop') {
      const rate = loop.debtIsAccountingAsset ? buy.assetUsd : Number.isFinite(borrowUsd) && borrowUsd > 0 ? borrowUsd : null;
      events.unshift({
        ...draftToEvent({ ...emptyDraft('borrow', loop.debtAsset, draft.at), cash: { amount: borrowed, token: loop.debtAsset, usdRate: rate ?? NaN, rateSource: loop.debtIsAccountingAsset ? buy.assetUsdSource : borrowSource }, assetUsd: draft.assetUsd, assetUsdSource: draft.assetUsdSource }),
      });
    }
    const now = new Date().toISOString();
    const p: Position = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      kind,
      protocol,
      chain: market.chain,
      marketId: market.id,
      marketName: market.name,
      platform: market.platform ?? '',
      icon: market.icon ?? '',
      maturity: market.maturity,
      assetSymbol: assetSymbol.trim(),
      events,
      loop: kind === 'loop' ? { ...loop, debtAssetUsd: loop.debtIsAccountingAsset ? null : Number.isFinite(borrowUsd) ? borrowUsd : null } : null,
      manual: emptyManual(),
      targets: emptyTargets(),
      points,
      snapshots: [],
      note: '',
    };
    save(p);
    router.push(`/portfolio/${encodeURIComponent(p.id)}`);
  };

  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <SxPage narrow>
      <header className="flex flex-col gap-4">
        <Link href="/portfolio" className="tap text-sm text-sx-muted hover:text-sx-text flex items-center gap-1 self-start min-h-10 transition-colors">
          <ArrowRight size={14} /> پرتفوی من
        </Link>
        <h1 className="page-title">ثبت پوزیشن</h1>
        <ol className="grid grid-cols-5 gap-2" aria-label="مراحل">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined} className="flex flex-col gap-2">
              <span className={`h-1 rounded-full transition-colors ${i < step ? 'bg-sx-accent' : i === step ? 'bg-gradient-to-l from-sx-primary to-sx-accent' : 'bg-sx-raised'}`} />
              <span className={`text-xs ${i === step ? 'text-sx-text font-medium' : i < step ? 'text-sx-accent' : 'text-sx-faint'}`}>
                <Num>{formatNumber(i + 1, 0)}</Num>. {s}
              </span>
            </li>
          ))}
        </ol>
      </header>

      <Summary
        items={[
          ...(protocol && step > 0 ? [{ step: 0, label: 'پلتفرم', value: <bdi dir="ltr">{protocols[protocol].name}</bdi>, go: () => setStep(0) }] : []),
          ...(chain && step > 1 ? [{ step: 1, label: 'شبکه', value: chainFa(chain), go: () => setStep(1) }] : []),
          ...(market && step > 2 ? [{ step: 2, label: 'بازار', value: <><bdi dir="ltr">{market.name}</bdi> · سررسید {formatDate(market.maturity)}</>, go: () => setStep(2) }] : []),
          ...(kind && step > 3 ? [{ step: 3, label: 'نوع', value: KIND_FA[kind], go: () => setStep(3) }] : []),
        ]}
      />

      {step === 0 && (
        <Panel title="پلتفرم را انتخاب کنید" subtitle="بازارهای زنده‌ی هر پلتفرم از API خودش خوانده می‌شود.">
          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="پلتفرم">
            {LIVE.map((id) => (
              <Choice key={id} selected={protocol === id} onClick={() => { setProtocol(id); setChain(null); setMarket(null); setStep(1); }}>
                <TokenLogo src={protocolLogo(id)} name={protocols[id].name} size={40} />
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="font-medium text-sx-text" dir="ltr">{protocols[id].name}</div>
                  <div className="text-xs text-sx-muted leading-5">{protocols[id].description}</div>
                </div>
                <ChevronLeft className="mr-auto text-sx-faint shrink-0" size={18} aria-hidden />
              </Choice>
            ))}
          </div>
        </Panel>
      )}

      {step === 1 && protocol && (
        <Panel title={`شبکه‌های ${protocols[protocol].name}`} subtitle="فقط شبکه‌هایی که این پلتفرم در آن‌ها بازار فعال دارد.">
          {listState === 'loading' && <p className="text-sm text-sx-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> در حال دریافت بازارها…</p>}
          {listState === 'error' && <p className="text-sm text-sx-red">دریافت بازارها ناموفق بود. کمی بعد دوباره تلاش کنید.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="شبکه">
            {chains.map(([c, n]) => (
              <Choice key={c} selected={chain === c} onClick={() => { setChain(c); setMarket(null); setStep(2); }}>
                <TokenLogo src={chainLogo(c)} name={c} size={34} />
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="font-medium text-sx-text">{chainFa(c)}</div>
                  <div className="text-xs text-sx-muted"><Num>{formatNumber(n, 0)}</Num> بازار فعال</div>
                </div>
              </Choice>
            ))}
          </div>
        </Panel>
      )}

      {step === 2 && protocol && chain && (
        <Panel title={`بازارهای ${chainFa(chain)}`} subtitle="بازارهای هم‌نام با سررسید و شناسه از هم جدا می‌شوند.">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-sx-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی نماد، پروژه یا شناسه‌ی بازار"
              aria-label="جست‌وجوی بازار"
              className="w-full pr-10 pl-3 h-11 text-base"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} /> نمایش بازارهای سررسیدشده
          </label>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="بازار">
            {list.map((m) => (
              <Choice key={m.id} selected={market?.id === m.id} onClick={() => { setMarket(m); setKind(null); setStep(3); }}>
                <LogoWithNetwork icon={m.icon} name={m.name} chain={m.chain} size={32} />
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <bdi className="font-medium text-sx-text truncate" dir="ltr">{m.name}</bdi>
                    {m.expired && <span className="text-xs text-sx-orange">سررسیدشده</span>}
                  </div>
                  <div className="text-xs text-sx-muted">
                    {m.platform ? <span dir="ltr">{m.platform} · </span> : null}
                    سررسید <span className={dupNames.has(m.name) ? 'font-medium text-sx-text' : ''}>{formatDate(m.maturity)}</span> · <Num>{formatNumber(m.daysToMaturity, 0)}</Num> روز
                  </div>
                  <div className="text-xs text-sx-faint flex flex-wrap gap-x-3">
                    <span>Implied <Num>{formatPercent(m.impliedAPY, 2)}</Num></span>
                    {m.liquidity !== null && <span>نقدینگی {formatDollarCompact(m.liquidity)}</span>}
                    <span className="font-mono whitespace-nowrap" dir="ltr" title={m.id}>{shortId(m.id)}</span>
                    {m.asset?.address && <span className="font-mono" dir="ltr" title={`${m.asset.symbol ?? ''} ${m.asset.address}`}>{m.asset.symbol} {shortId(m.asset.address)}</span>}
                  </div>
                </div>
              </Choice>
            ))}
            {!list.length && listState !== 'loading' && <p className="text-sm text-sx-muted text-center py-6">بازاری پیدا نشد.</p>}
          </div>
        </Panel>
      )}

      {step === 3 && market && (
        <Panel title="نوع پوزیشن">
          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="نوع پوزیشن">
            {(['pt', 'yt', 'loop'] as const).map((k) => {
              const loopOk = k !== 'loop' || isLoopable(market);
              return (
                <Choice key={k} selected={kind === k} disabled={!loopOk} onClick={() => { setKind(k); setStep(4); }}>
                  <span className="grid place-items-center size-10 rounded-md bg-sx-accent/15 text-sx-accent text-xs font-medium shrink-0" dir="ltr">{k === 'loop' ? 'Loop' : k.toUpperCase()}</span>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="font-medium text-sx-text">{KIND_FA[k]}</div>
                    {!loopOk && <div className="text-xs text-sx-muted">این بازار در فهرست بازارهای قابل لوپ پلتفرم نیست.</div>}
                  </div>
                </Choice>
              );
            })}
          </div>
        </Panel>
      )}

      {step === 4 && market && kind && protocol && (
        <>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            label="حالت"
            options={[
              { id: 'record', label: <><ClipboardCheck size={15} /> ثبت خرید انجام‌شده</> },
              { id: 'plan', label: <><Calculator size={15} /> محاسبه قبل از خرید</> },
            ]}
          />

          <section className="sx-hero p-5 md:p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3.5">
              <TokenLogo src={market.icon} name={market.name} size={44} />
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="font-medium text-lg" dir="ltr">{kind === 'loop' ? 'PT' : kind.toUpperCase()} {market.name}</div>
                <div className="text-xs text-sx-muted">
                  <span dir="ltr">{protocols[protocol].name}</span> · {chainFa(market.chain)} · سررسید {formatDate(market.maturity)} · <span className="font-mono whitespace-nowrap" dir="ltr" title={market.id}>{shortId(market.id)}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <TextField label="نماد دارایی پایه (واحد بازخرید)" value={assetSymbol} onChange={setAssetSymbol} placeholder="USDe" ltr />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-sx-muted">قیمت فعلی {kind === 'yt' ? 'YT' : 'PT'}</span>
                <span className="text-lg font-light">{live ? <><Num>{formatNumber(tokenPrice, 6)}</Num> <span className="text-sm text-sx-muted" dir="ltr">{assetSymbol}</span></> : <Loader2 size={14} className="inline animate-spin" />}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-sx-muted">قیمت دلاری دارایی</span>
                <span className="text-lg font-light">{assetUsd !== null ? formatDollar(assetUsd, priceDigits(assetUsd)) : 'نامعلوم'}</span>
              </div>
            </div>
            {kind !== 'yt' && <p className="text-xs text-sx-muted">هر PT در سررسید به ۱ واحد دارایی پایه بازخرید می‌شود؛ ارزش دلاری آن با قیمت همان دارایی تغییر می‌کند.</p>}
          </section>

          {mode === 'plan' ? (
            <Panel title="محاسبه قبل از خرید" subtitle="فقط یک تخمین با قیمت فعلی بازار است و ذخیره نمی‌شود. پس از خرید، تعداد واقعی دریافتی را ثبت کنید.">
              <div className="grid grid-cols-2 gap-4">
                <NumberField persian label="مقدار پرداختی" value={planAmount} onChange={setPlanAmount} />
                <TokenSelect label="رمزارز پرداختی" value={planToken} onChange={setPlanToken} tokens={tokens} />
                <NumberField persian label="کارمزد و لغزش تخمینی" value={planFee} onChange={setPlanFee} suffix="%" />
                <div className="flex flex-col justify-end gap-1 pb-2">
                  <span className="text-xs text-sx-muted">ارزش دلاری</span>
                  <span>{Number.isFinite(planUsd) ? formatDollar(planUsd) : planToken ? 'قیمت این ارز در دسترس نیست' : '—'}</span>
                </div>
              </div>
              {live && assetUsd && Number.isFinite(planUsd) ? (() => {
                const units = (planUsd * (1 - planFee / 100)) / (tokenPrice * assetUsd);
                const days = Math.max(1, live.daysToMaturity);
                return (
                  <div className="flex flex-col gap-5 border-t border-sx-border pt-5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-sx-muted">تعداد تقریبی قابل خرید</span>
                        <span className="text-2xl font-light"><Num>{formatNumber(units, 4)}</Num> <span className="text-sm text-sx-muted">{kind === 'yt' ? 'YT' : 'PT'}</span></span>
                      </div>
                      {kind !== 'yt' ? (
                        <>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-sx-muted">ارزش در سررسید (قیمت ثابت دارایی)</span>
                            <span className="text-2xl font-light">{formatDollar(units * assetUsd)}</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-sx-muted">بازده ثابت سالانه پس از کارمزد</span>
                            <span className="text-2xl font-light text-sx-green"><Num>{formatPercent(apyFromPT(tokenPrice / (1 - planFee / 100), days), 2)}</Num></span>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-sx-muted">مواجهه با بازده دارایی پایه</span>
                          <span className="text-2xl font-light">{formatDollar(units * assetUsd, 0)}</span>
                        </div>
                      )}
                    </div>
                    <button type="button" className={`${btn.secondary} self-start`} onClick={() => {
                      setDraft((d) => ({ ...d, at: new Date().toISOString(), cash: { ...d.cash, amount: planAmount, token: planToken } }));
                      setMode('record');
                    }}>
                      خرید را انجام دادم — ثبت خرید واقعی
                    </button>
                  </div>
                );
              })() : <p className="text-sm text-sx-orange">قیمت بازار، قیمت دلاری دارایی یا قیمت ارز پرداختی در دسترس نیست؛ تخمین ممکن نیست.</p>}
            </Panel>
          ) : (
            <>
              <Panel title="جزئیات خرید" subtitle="مبنای محاسبات، مبلغ واقعی پرداختی و تعداد واقعی دریافتی از تراکنش شماست؛ قیمت امروز جایگزین قیمت ورود نمی‌شود.">
                <EventFields draft={draft} onChange={setDraft} assetSymbol={assetSymbol} liveAssetUsd={assetUsd} types={['buy']} chain={market.chain} marketIcon={market.icon} showErrors={tried} />
              </Panel>

              {kind === 'loop' && (
                <Panel title="وام و بازار وام‌دهی" subtitle="مبلغ خرید بالا باید کل PT خریداری‌شده (سرمایه‌ی خودتان + وام) باشد. سرمایه‌ی شخصی = خرید − وام.">
                  <div className="grid grid-cols-2 gap-4">
                    <TextField label="پلتفرم وام‌دهی" value={loop.lendingPlatform} onChange={(lendingPlatform) => setLoop({ ...loop, lendingPlatform })} placeholder="Morpho" ltr />
                    <TextField label="بازار وام‌دهی" value={loop.lendingMarket} onChange={(lendingMarket) => setLoop({ ...loop, lendingMarket })} placeholder="PT-sUSDe / USDC" ltr />
                    <TokenSelect label="دارایی بدهی" value={loop.debtAsset} onChange={(debtAsset) => { setLoop({ ...loop, debtAsset }); setBorrowSource('unknown'); setBorrowUsd(NaN); }} tokens={tokens} />
                    <NumberField persian label="مقدار وام (بدهی)" value={borrowed} onChange={setBorrowed} />
                    <NumberField persian label="نرخ بهره‌ی وام" value={loop.borrowAPY} onChange={(borrowAPY) => setLoop({ ...loop, borrowAPY })} suffix="%" />
                    <NumberField persian label="آستانه‌ی لیکویید شدن (LLTV)" value={loop.lltv} onChange={(lltv) => setLoop({ ...loop, lltv })} suffix="%" />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={loop.debtIsAccountingAsset} onChange={(e) => setLoop({ ...loop, debtIsAccountingAsset: e.target.checked })} />
                    دارایی بدهی همان دارایی پایه‌ی بازار ({assetSymbol || '—'}) است
                  </label>
                  {!loop.debtIsAccountingAsset && (
                    <div className="flex flex-col gap-1">
                      <NumberField persian label={`نرخ دلاری ${loop.debtAsset || 'دارایی بدهی'} هنگام وام`} value={borrowUsd} onChange={(v) => { setBorrowUsd(v); setBorrowSource('manual'); }} suffix="دلار" />
                      <span className={`text-xs ${Number.isFinite(borrowUsd) ? 'text-sx-green' : 'text-sx-orange'}`}>{Number.isFinite(borrowUsd) ? RATE_FA[borrowSource] : 'نرخ نامعلوم — دستی وارد کنید'}</span>
                    </div>
                  )}
                  <SelectField<OracleMode>
                    label="اوراکل وثیقه"
                    value={loop.oracle}
                    onChange={(oracle) => setLoop({ ...loop, oracle })}
                    options={[
                      { value: 'unknown', label: 'نمی‌دانم (تخمین با قیمت بازار)' },
                      { value: 'market', label: 'قیمت بازار PT' },
                      { value: 'manual', label: 'قیمت اوراکل را دستی وارد می‌کنم' },
                    ]}
                  />
                  {loop.oracle === 'manual' && (
                    <NumberField persian label={`قیمت PT در اوراکل (${assetSymbol || 'واحد دارایی'})`} value={loop.oraclePtPrice ?? NaN} onChange={(oraclePtPrice) => setLoop({ ...loop, oraclePtPrice })} />
                  )}
                </Panel>
              )}

              {kind === 'yt' && (
                <Panel title="پوینت" subtitle="فقط برای سناریوی جدا؛ ارزش پوینت و ایردراپ هرگز وارد سود قطعی نمی‌شود.">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <NumberField persian label="پوینت روزانه به ازای هر واحد" value={points.perDay} onChange={(perDay) => setPoints({ ...points, perDay })} />
                    <NumberField persian label="ضریب YT" value={points.multiplier} onChange={(multiplier) => setPoints({ ...points, multiplier })} suffix="×" />
                    <SelectField label="مبنا" value={points.basis} onChange={(basis) => setPoints({ ...points, basis })} options={[{ value: 'unit', label: 'هر واحد دارایی' }, { value: 'usd', label: 'هر دلار' }]} />
                  </div>
                </Panel>
              )}

              <div className="sx-card p-5 flex flex-col gap-4">
                <NoWalletNote />
                {tried && (draftError || loopError) && (
                  <p className="text-sm text-sx-red" role="alert">
                    ذخیره نشد: {loopError ?? 'موارد قرمز بالا را اصلاح کنید.'}
                  </p>
                )}
                <button type="button" onClick={() => (draftError || loopError ? setTried(true) : create())} className={`${btn.primary} h-12 text-base`}>
                  <Check size={18} aria-hidden /> ذخیره‌ی پوزیشن
                </button>
              </div>
            </>
          )}
        </>
      )}

      {step > 0 && (
        <button type="button" onClick={back} className={`${btn.ghost} self-start`}>
          <ArrowRight size={14} /> مرحله‌ی قبل
        </button>
      )}
    </SxPage>
  );
}
