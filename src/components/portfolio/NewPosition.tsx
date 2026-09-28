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
import { chainFa, chainLogo, KIND_FA, protocolLogo } from '../../lib/portfolio/labels';
import { newId } from '../../lib/portfolio/portfolio';
import { apyFromPT } from '../../lib/portfolio/valuation';
import { usePortfolio } from '../../hooks/usePortfolio';
import { formatDate, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Card } from '../ui/card';
import { NumberField, SelectField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { Segmented } from '../opportunities/parts';
import { draftToEvent, emptyDraft, EventFields, validateDraft, type Draft } from './EventForm';
import { NoWalletNote } from './parts';

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

function Choice({ selected, onClick, children, disabled }: { selected?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full text-right rounded-2xl border p-3 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        selected ? 'border-accent bg-accent/10' : 'border-default bg-surface/80 hover:border-strong'
      }`}
    >
      {children}
    </button>
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
  const [points, setPoints] = useState<Position['points']>({ perDay: 0, multiplier: 1, basis: 'unit', valuePerPoint: 0 });
  // Pre-trade planner.
  const [planAmount, setPlanAmount] = useState(1000);
  const [planFee, setPlanFee] = useState(thresholds.exit.costPercent);

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
        ...draftToEvent({ ...emptyDraft('borrow', loop.debtAsset, draft.at), cash: { amount: borrowed, token: loop.debtAsset, usdRate: rate ?? NaN, rateSource: loop.debtIsAccountingAsset ? buy.assetUsdSource : 'manual' }, assetUsd: draft.assetUsd, assetUsdSource: draft.assetUsdSource }),
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
    <main className="max-w-3xl mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Link href="/portfolio" className="text-sm text-secondary flex items-center gap-1">
          <ArrowRight size={14} /> پرتفوی من
        </Link>
        <h1 className="text-2xl font-extrabold text-primary">ثبت پوزیشن</h1>
        <ol className="flex gap-1 text-xs" aria-label="مراحل">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex-1 rounded-full px-2 py-1 text-center ${i === step ? 'bg-accent text-white font-bold' : i < step ? 'bg-accent/20 text-primary' : 'bg-elevated text-muted'}`} aria-current={i === step ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
      </header>

      {step === 0 && (
        <Card title="پلتفرم را انتخاب کنید">
          <div className="flex flex-col gap-2">
            {LIVE.map((id) => (
              <Choice key={id} selected={protocol === id} onClick={() => { setProtocol(id); setChain(null); setMarket(null); setStep(1); }}>
                <TokenLogo src={protocolLogo(id)} name={protocols[id].name} size={36} />
                <div className="min-w-0">
                  <div className="font-bold text-primary" dir="ltr">{protocols[id].name}</div>
                  <div className="text-xs text-secondary">{protocols[id].description}</div>
                </div>
                <ChevronLeft className="mr-auto text-muted" size={18} />
              </Choice>
            ))}
          </div>
        </Card>
      )}

      {step === 1 && protocol && (
        <Card title={`شبکه‌های ${protocols[protocol].name}`}>
          {listState === 'loading' && <p className="text-sm text-secondary flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> در حال دریافت بازارها…</p>}
          {listState === 'error' && <p className="text-sm text-danger">دریافت بازارها ناموفق بود. کمی بعد دوباره تلاش کنید.</p>}
          <p className="text-xs text-muted">فقط شبکه‌هایی که این پلتفرم در آن‌ها بازار فعال دارد.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {chains.map(([c, n]) => (
              <Choice key={c} selected={chain === c} onClick={() => { setChain(c); setMarket(null); setStep(2); }}>
                <TokenLogo src={chainLogo(c)} name={c} size={32} />
                <div className="min-w-0">
                  <div className="font-bold text-primary">{chainFa(c)}</div>
                  <div className="text-xs text-muted"><Num>{formatNumber(n, 0)}</Num> بازار فعال</div>
                </div>
              </Choice>
            ))}
          </div>
        </Card>
      )}

      {step === 2 && protocol && chain && (
        <Card title={`بازارهای ${chainFa(chain)}`}>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی نماد، پروژه یا شناسه‌ی بازار"
              aria-label="جست‌وجوی بازار"
              className="w-full bg-elevated/70 border border-strong rounded-xl pr-9 pl-3 py-2.5 text-primary text-base"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-secondary">
            <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} /> نمایش بازارهای سررسیدشده
          </label>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {list.map((m) => (
              <Choice key={m.id} selected={market?.id === m.id} onClick={() => { setMarket(m); setKind(null); setStep(3); }}>
                <TokenLogo src={m.icon} name={m.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary truncate" dir="ltr">{m.name}</span>
                    {m.expired && <span className="text-[11px] text-warning">سررسیدشده</span>}
                  </div>
                  <div className="text-xs text-secondary">
                    {m.platform ? <span dir="ltr">{m.platform} · </span> : null}
                    سررسید <span className={dupNames.has(m.name) ? 'font-bold text-primary' : ''}>{formatDate(m.maturity)}</span> · <Num>{formatNumber(m.daysToMaturity, 0)}</Num> روز
                  </div>
                  <div className="text-[11px] text-muted flex flex-wrap gap-x-2">
                    <span>Implied <Num>{formatPercent(m.impliedAPY, 2)}</Num></span>
                    {m.liquidity !== null && <span>نقدینگی <Num>{formatUSDCompact(m.liquidity)}</Num></span>}
                    <span className="font-mono" dir="ltr" title={m.id}>{shortId(m.id)}</span>
                  </div>
                </div>
              </Choice>
            ))}
            {!list.length && listState !== 'loading' && <p className="text-sm text-secondary text-center py-4">بازاری پیدا نشد.</p>}
          </div>
        </Card>
      )}

      {step === 3 && market && (
        <Card title="نوع پوزیشن">
          <div className="flex flex-col gap-2">
            {(['pt', 'yt', 'loop'] as const).map((k) => {
              const loopOk = k !== 'loop' || isLoopable(market);
              return (
                <Choice key={k} selected={kind === k} disabled={!loopOk} onClick={() => { setKind(k); setStep(4); }}>
                  <div className="min-w-0">
                    <div className="font-bold text-primary">{KIND_FA[k]}</div>
                    {!loopOk && <div className="text-xs text-muted">این بازار در فهرست بازارهای قابل لوپ پلتفرم نیست.</div>}
                  </div>
                </Choice>
              );
            })}
          </div>
        </Card>
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

          <Card>
            <div className="flex items-center gap-3">
              <TokenLogo src={market.icon} name={market.name} size={36} />
              <div className="min-w-0 text-sm">
                <div className="font-bold text-primary" dir="ltr">{market.name}</div>
                <div className="text-xs text-secondary">
                  <span dir="ltr">{protocols[protocol].name}</span> · {chainFa(market.chain)} · سررسید {formatDate(market.maturity)} · <span className="font-mono" dir="ltr">{shortId(market.id)}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <TextField label="نماد دارایی پایه (واحد بازخرید)" value={assetSymbol} onChange={setAssetSymbol} placeholder="USDe" ltr />
              <div className="text-xs text-secondary flex flex-col justify-end gap-0.5">
                <span>قیمت فعلی {kind === 'yt' ? 'YT' : 'PT'}: {live ? <Num>{formatNumber(tokenPrice, 5)} {assetSymbol}</Num> : <Loader2 size={12} className="inline animate-spin" />}</span>
                <span>قیمت دلاری دارایی: {assetUsd !== null ? <Num>{formatUSD(assetUsd, 4)}</Num> : 'نامعلوم'}</span>
              </div>
            </div>
            {kind !== 'yt' && <p className="text-xs text-muted">هر PT در سررسید به ۱ واحد دارایی پایه بازخرید می‌شود؛ ارزش دلاری آن با قیمت همان دارایی تغییر می‌کند.</p>}
          </Card>

          {mode === 'plan' ? (
            <Card title="محاسبه قبل از خرید">
              <p className="text-xs text-secondary">فقط یک تخمین با قیمت فعلی بازار است و ذخیره نمی‌شود. پس از خرید، تعداد واقعی دریافتی را ثبت کنید.</p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="مبلغ خرید" value={planAmount} onChange={setPlanAmount} suffix="$" />
                <NumberField label="کارمزد و لغزش تخمینی" value={planFee} onChange={setPlanFee} suffix="%" />
              </div>
              {live && assetUsd ? (() => {
                const units = (planAmount * (1 - planFee / 100)) / (tokenPrice * assetUsd);
                const days = Math.max(1, live.daysToMaturity);
                return (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>تعداد تقریبی قابل خرید: <Num className="font-bold">{formatNumber(units, 4)}</Num> {kind === 'yt' ? 'YT' : 'PT'}</div>
                    {kind !== 'yt' ? (
                      <>
                        <div>ارزش در سررسید (قیمت ثابت دارایی): <Num className="font-bold">{formatUSD(units * assetUsd)}</Num></div>
                        <div>بازده ثابت سالانه پس از کارمزد: <Num className="font-bold">{formatPercent(apyFromPT((tokenPrice / (1 - planFee / 100)), days), 2)}</Num></div>
                      </>
                    ) : (
                      <div>مواجهه با بازده: <Num className="font-bold">{formatUSD(units * assetUsd, 0)}</Num> دارایی پایه</div>
                    )}
                    <button type="button" className="col-span-2 rounded-xl border border-accent/60 px-3 py-2 text-sm text-primary" onClick={() => {
                      setDraft((d) => ({ ...d, cash: { ...d.cash, amount: planAmount, token: d.cash.token } }));
                      setMode('record');
                    }}>
                      خرید را انجام دادم — ثبت خرید واقعی
                    </button>
                  </div>
                );
              })() : <p className="text-sm text-warning">قیمت بازار یا قیمت دلاری دارایی در دسترس نیست؛ تخمین ممکن نیست.</p>}
            </Card>
          ) : (
            <>
              <Card title="جزئیات خرید">
                <p className="text-xs text-secondary">مبنای محاسبات، مبلغ واقعی پرداختی و تعداد واقعی دریافتی از تراکنش شماست؛ قیمت امروز جایگزین قیمت ورود نمی‌شود.</p>
                <EventFields draft={draft} onChange={setDraft} assetSymbol={assetSymbol} liveAssetUsd={assetUsd} types={['buy']} />
              </Card>

              {kind === 'loop' && (
                <Card title="وام و بازار وام‌دهی">
                  <p className="text-xs text-secondary">مبلغ خرید بالا باید کل PT خریداری‌شده (سرمایه‌ی خودتان + وام) باشد. سرمایه‌ی شخصی = خرید − وام.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="پلتفرم وام‌دهی" value={loop.lendingPlatform} onChange={(lendingPlatform) => setLoop({ ...loop, lendingPlatform })} placeholder="Morpho" ltr />
                    <TextField label="بازار وام‌دهی" value={loop.lendingMarket} onChange={(lendingMarket) => setLoop({ ...loop, lendingMarket })} placeholder="PT-sUSDe / USDC" ltr />
                    <TextField label="دارایی بدهی" value={loop.debtAsset} onChange={(debtAsset) => setLoop({ ...loop, debtAsset })} placeholder="USDC" ltr />
                    <NumberField label="مقدار وام (بدهی)" value={borrowed} onChange={setBorrowed} />
                    <NumberField label="نرخ بهره‌ی وام" value={loop.borrowAPY} onChange={(borrowAPY) => setLoop({ ...loop, borrowAPY })} suffix="%" />
                    <NumberField label="آستانه‌ی لیکویید شدن (LLTV)" value={loop.lltv} onChange={(lltv) => setLoop({ ...loop, lltv })} suffix="%" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input type="checkbox" checked={loop.debtIsAccountingAsset} onChange={(e) => setLoop({ ...loop, debtIsAccountingAsset: e.target.checked })} />
                    دارایی بدهی همان دارایی پایه‌ی بازار ({assetSymbol || '—'}) است
                  </label>
                  {!loop.debtIsAccountingAsset && <NumberField label={`نرخ دلاری ${loop.debtAsset || 'دارایی بدهی'} هنگام وام`} value={borrowUsd} onChange={setBorrowUsd} suffix="$" />}
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
                    <NumberField label={`قیمت PT در اوراکل (${assetSymbol || 'واحد دارایی'})`} value={loop.oraclePtPrice ?? NaN} onChange={(oraclePtPrice) => setLoop({ ...loop, oraclePtPrice })} />
                  )}
                </Card>
              )}

              {kind === 'yt' && (
                <Card title="پوینت (فقط برای سناریوی جدا)">
                  <p className="text-xs text-secondary">ارزش پوینت و ایردراپ هرگز وارد سود قطعی نمی‌شود.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <NumberField label="پوینت روزانه به ازای هر واحد" value={points.perDay} onChange={(perDay) => setPoints({ ...points, perDay })} />
                    <NumberField label="ضریب YT" value={points.multiplier} onChange={(multiplier) => setPoints({ ...points, multiplier })} suffix="×" />
                    <SelectField label="مبنا" value={points.basis} onChange={(basis) => setPoints({ ...points, basis })} options={[{ value: 'unit', label: 'هر واحد دارایی' }, { value: 'usd', label: 'هر دلار' }]} />
                  </div>
                </Card>
              )}

              <NoWalletNote />
              {(draftError || loopError) && <p className="text-sm text-warning">{draftError ?? loopError}</p>}
              <button type="button" disabled={!!draftError || !!loopError} onClick={create} className="flex items-center justify-center gap-2 rounded-xl brand-gradient px-4 py-3 font-bold text-white disabled:opacity-40">
                <Check size={18} /> ذخیره‌ی پوزیشن
              </button>
            </>
          )}
        </>
      )}

      {step > 0 && (
        <button type="button" onClick={back} className="self-start flex items-center gap-1 text-sm text-secondary">
          <ArrowRight size={14} /> مرحله‌ی قبل
        </button>
      )}
    </main>
  );
}
