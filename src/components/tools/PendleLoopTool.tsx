'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Landmark, Loader2, Repeat, Search, ShieldAlert } from 'lucide-react';
import thresholds from '../../config/thresholds.json';
import { useLoopHistory } from '../../hooks/useLoopHistory';
import type { LoopBox, LoopBoxesFeed } from '../../lib/pendleloop/types';
import { leverageForHealth, loopPosition, midEntry, pendleMaxLeverage, type LoopEntry } from '../../lib/pendleloop/position';
import { rateAfterBorrow } from '../../lib/opportunity/curve';
import { quoteAmount } from '../../lib/opportunity/policy';
import type { ExecQuote } from '../../types/opportunity';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { networkByChainId, networkByName } from '../../lib/registry/networks';
import { formatDate, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { LoopChart, type LoopChartPoint } from '../charts/LoopChart';
import { LoopHistory } from '../market/LoopHistory';
import { Pill, Segmented } from '../opportunities/parts';
import { LogoWithNetwork } from '../ui/asset-identity';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';

const REFRESH_MS = 60_000;
const DAY_S = 86_400;
const floor1 = (x: number) => Math.floor(x * 10) / 10;
const pct = (fraction: number | null, d = 2) => (fraction === null ? '—' : formatPercent(fraction * 100, d));
const daysLeft = (b: LoopBox, now: number) => (b.expiry ? (Date.parse(b.expiry) - now) / 86_400_000 : null);
const RISK_TONE: Record<string, 'success' | 'warning' | 'danger'> = { none: 'success', low: 'success', medium: 'warning', high: 'danger' };
const TEXT_TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const riskText = (level: string) => TEXT_TONE[RISK_TONE[level] ?? 'warning'];
const RISK_FA: Record<string, string> = { none: 'بدون ریسک', low: 'ریسک کم', medium: 'ریسک متوسط', high: 'ریسک زیاد' };

/** PendleLoop's boxes, re-read every minute and when the tab comes back; a PT past maturity leaves on its own. */
function useLoopBoxes() {
  const [feed, setFeed] = useState<LoopBoxesFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetch('/api/pendleloop', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<LoopBoxesFeed>) : Promise.reject(new Error(String(r.status)))))
      .then((f) => {
        setFeed(f);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
  return { feed, failed, loading: !feed && !failed };
}

type Kind = 'all' | 'pt' | 'vanilla';
type Sort = 'apy' | 'liquidity' | 'maturity';

/** The money market's logo and name, as PendleLoop shows it. */
function ProtocolMark({ b, size = 16 }: { b: LoopBox; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <TokenLogo src={b.protocol.icon} name={b.protocol.name} size={size} />
      <bdi dir="ltr" className="truncate">{b.protocol.name}</bdi>
    </span>
  );
}

function BoxIdentity({ b, icon, size = 32 }: { b: LoopBox; icon: string | null; size?: 24 | 32 | 48 }) {
  const net = networkByChainId(b.chainId);
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <LogoWithNetwork icon={icon} name={b.collateral.symbol} chain={net.name} size={size} />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="flex items-center gap-1 font-semibold text-primary text-[15px] min-w-0">
          <bdi dir="ltr" className="truncate">{b.collateral.symbol.replace(/-\d{1,2}[A-Z]{3}\d{4}$/, '')}</bdi>
          <span className="text-muted font-normal">·</span>
          <LogoWithNetwork name={b.debt.symbol} chain="" size={24} />
          <bdi dir="ltr" className="font-normal text-secondary">{b.debt.symbol}</bdi>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-secondary mt-0.5 min-w-0">
          <ProtocolMark b={b} size={14} />
          <span className="text-muted">·</span>
          <span>{net.nameFa}</span>
        </span>
      </span>
    </span>
  );
}

/**
 * «PendleLoop»: Pendle's Loop to Earn the way its own page lays it out — every box Pendle lists
 * right now, whatever the network or money market, a PT gone past maturity dropped — and what
 * PendleLoop does not show: leverage in dollars, Health Factor beside the distance to liquidation,
 * the oracle's own description and how each leverage would have fared on this box's past.
 */
export function PendleLoopTool({ markets }: { markets: OpportunityListing[] }) {
  const { feed, failed, loading } = useLoopBoxes();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [feed]);
  const [chain, setChain] = useState<number | 'all'>('all');
  const [protocol, setProtocol] = useState<string>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('apy');
  const [q, setQ] = useState('');
  const [boxId, setBoxId] = useState<string | null>(null);

  const live = useMemo(() => (feed?.boxes ?? []).filter((b) => !b.expiry || Date.parse(b.expiry) > now), [feed, now]);
  /** PT logos from the PT market lists (by network and PT address). */
  const icons = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of markets) {
      const id = networkByName(x.chain).chainId;
      if (x.icon && id && x.ptToken?.address) m.set(`${id}:${x.ptToken.address.toLowerCase()}`, x.icon);
    }
    return m;
  }, [markets]);
  const iconOf = (b: LoopBox) => icons.get(`${b.chainId}:${b.collateral.address}`) ?? null;

  const chains = useMemo(() => [...new Set(live.map((b) => b.chainId))].sort((a, b) => live.filter((x) => x.chainId === b).length - live.filter((x) => x.chainId === a).length), [live]);
  const protocols = useMemo(() => [...new Map(live.map((b) => [b.protocol.name, b])).values()], [live]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = live.filter((b) => (chain === 'all' || b.chainId === chain) && (protocol === 'all' || b.protocol.name === protocol) && (kind === 'all' || b.kind === kind) && (!s || `${b.collateral.symbol} ${b.debt.symbol}`.toLowerCase().includes(s)));
    const key: Record<Sort, (b: LoopBox) => number> = { apy: (b) => -(b.maxApy ?? -1), liquidity: (b) => -(b.liquidityUsd ?? -1), maturity: (b) => daysLeft(b, now) ?? Infinity };
    return out.sort((a, b) => key[sort](a) - key[sort](b));
  }, [live, chain, protocol, kind, sort, q, now]);
  const box = list.find((b) => b.boxId === boxId) ?? list[0] ?? null;

  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-10 justify-center">
        <Loader2 size={16} className="animate-spin" aria-hidden /> در حال دریافت جعبه‌های PendleLoop…
      </div>
    );
  if (failed && !feed) return <p className="sx-card p-4 text-sm text-danger">فهرست PendleLoop دریافت نشد؛ کمی بعد دوباره امتحان کنید.</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">PendleLoop · Loop to Earn</h2>
          <span className="text-xs text-muted">
            <Num>{formatNumber(live.length, 0)}</Num> جعبه · به‌روز هر دقیقه{feed?.error && <span className="text-warning"> · آخرین نسخه‌ی سالم</span>}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="شبکه">
          <Chip on={chain === 'all'} onClick={() => setChain('all')}>همه‌ی شبکه‌ها</Chip>
          {chains.map((id) => {
            const net = networkByChainId(id);
            return (
              <Chip key={id} on={chain === id} onClick={() => setChain(id)}>
                <TokenLogo src={net.logo} name={net.name} size={16} /> {net.nameFa} <Num className="text-muted">{formatNumber(live.filter((b) => b.chainId === id).length, 0)}</Num>
              </Chip>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="بازار وام">
          <Chip on={protocol === 'all'} onClick={() => setProtocol('all')}>همه‌ی بازارهای وام</Chip>
          {protocols.map((b) => (
            <Chip key={b.protocol.name} on={protocol === b.protocol.name} onClick={() => setProtocol(b.protocol.name)}>
              <ProtocolMark b={b} />
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
          <label className="flex items-center gap-2 rounded-md border border-control bg-elevated px-3 min-h-11">
            <Search size={15} className="text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نماد، مثلاً reUSD یا USDC" className="bg-transparent outline-none text-base w-full" aria-label="جست‌وجوی نماد" />
          </label>
          <Segmented<Kind> value={kind} onChange={setKind} label="نوع" size="sm" options={[{ id: 'all', label: 'همه' }, { id: 'pt', label: 'PT' }, { id: 'vanilla', label: 'بدون سررسید' }]} />
          <Segmented<Sort> value={sort} onChange={setSort} label="مرتب‌سازی" size="sm" options={[{ id: 'apy', label: 'بیشترین APY' }, { id: 'liquidity', label: 'نقدینگی' }, { id: 'maturity', label: 'سررسید' }]} />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-4 items-start">
        <ol className="sx-card divide-y divide-default overflow-hidden lg:max-h-[80vh] lg:overflow-y-auto" aria-label="جعبه‌های PendleLoop">
          {list.length === 0 && <li className="p-6 text-center text-sm text-muted">جعبه‌ای با این فیلترها نیست.</li>}
          {list.map((b) => {
            const d = daysLeft(b, now);
            return (
              <li key={b.boxId}>
                <button type="button" onClick={() => setBoxId(b.boxId)} aria-pressed={box?.boxId === b.boxId} className={`tap w-full text-right px-3 py-3 flex flex-col gap-2 ${box?.boxId === b.boxId ? 'bg-elevated' : 'hover:bg-hover'}`}>
                  <span className="flex items-center justify-between gap-2">
                    <BoxIdentity b={b} icon={iconOf(b)} />
                    <span className="flex flex-col items-end shrink-0">
                      <span className="text-xs text-muted">بیشینه APY</span>
                      <Num className="text-success font-semibold">{pct(b.maxApy)}</Num>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span>{b.kind === 'pt' ? 'ثابت' : 'بازده'} <Num className="text-primary">{pct(b.yieldApy)}</Num></span>
                    <span>وام <Num className="text-primary">{pct(b.borrowApy)}</Num></span>
                    <span>LLTV <Num>{pct(b.lltv, 1)}</Num></span>
                    <span>نقدینگی {b.liquidityUsd === null ? '—' : <Num>{formatUSDCompact(b.liquidityUsd)}</Num>}</span>
                    <span>{d === null ? 'بدون سررسید' : <><Num>{formatNumber(Math.ceil(d), 0)}</Num> روز</>}</span>
                    {b.risk && <span className={riskText(b.risk.level)}>اوراکل: {RISK_FA[b.risk.level] ?? b.risk.level}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {box && <BoxDetail key={box.boxId} b={box} icon={iconOf(box)} now={now} />}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={`tap inline-flex items-center gap-1.5 rounded-full border px-3 min-h-9 text-sm ${on ? 'border-accent bg-accent/15 text-primary' : 'border-default text-secondary hover:bg-hover'}`}>
      {children}
    </button>
  );
}

type Range = '7' | '30' | 'all';

/**
 * What Pendle's router pays for this box's PT at the position's size, sold from the borrowed
 * token (what PendleLoop swaps). Asked once the amount settles; none for a box without a PT market.
 */
function useLoopQuote(b: LoopBox, positionUsd: number): { quote: ExecQuote | null; waiting: boolean } {
  const usd = quoteAmount(positionUsd);
  const key = b.kind === 'pt' && b.ptMarketAddress && usd >= 100 && usd <= 10_000_000 ? `chain=${b.chainId}&market=${b.ptMarketAddress}&side=pt&usd=${usd}&token=${b.debt.address}` : null;
  const [got, setGot] = useState<{ key: string; q: ExecQuote | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/quote?${key}`)
        .then((r) => (r.ok ? (r.json() as Promise<ExecQuote>) : null))
        .then((q) => live && setGot({ key, q }))
        .catch(() => live && setGot({ key, q: null }));
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);
  return { quote: got && got.key === key ? got.q : null, waiting: key !== null && got?.key !== key };
}

function BoxDetail({ b, icon, now }: { b: LoopBox; icon: string | null; now: number }) {
  const net = networkByChainId(b.chainId);
  const { feed, loading } = useLoopHistory(b.chainId, b.collateral.address);
  const series = feed?.series.find((s) => s.boxId.toLowerCase() === b.boxId.toLowerCase()) ?? null;
  const [range, setRange] = useState<Range>('7');
  const [capital, setCapital] = useState(5000);
  const [lev, setLev] = useState(2);
  const [horizon, setHorizon] = useState(30);

  const last = series?.rows[series.rows.length - 1] ?? null;
  // The oracle can read the PT under its market price (Morpho's fixed curves): PendleLoop's LTV is on the oracle's value.
  const oracleFactor = last && last[3] > 0 ? Math.min(1, last[2] / last[3]) : 1;
  // PendleLoop's leverage (1 ÷ (1 − LTV)), its cap and the app's safe line.
  const top = floor1(Math.min(pendleMaxLeverage(b.lltv), b.maxLeverage ?? Infinity, 20));
  const safe = Math.min(leverageForHealth(b.lltv, thresholds.opportunities.loopMinHealth), top);
  const L = Math.min(Math.max(1.1, lev), top);
  const days = b.kind === 'pt' ? Math.max(1, daysLeft(b, now) ?? 1) : horizon;
  const yieldPct = (b.yieldApy ?? 0) * 100;
  const { quote, waiting } = useLoopQuote(b, capital * L);
  const entry: LoopEntry = useMemo(() => {
    const mid = midEntry(b.kind, yieldPct, days);
    // A quote is used only when it reads close to the market (a routing failure is not a price).
    if (!quote || !(quote.midUsd && quote.midUsd > 0) || !(quote.units > 0)) return mid;
    const e = (quote.units * quote.midUsd) / quote.usd;
    return e > 0.8 && e < 1.01 ? { unitsPerUsd: quote.units / quote.usd, midUsd: quote.midUsd, quoted: true } : mid;
  }, [quote, b.kind, yieldPct, days]);
  const feeRate = b.serviceFeeRate ?? 0;
  // The borrow rate after this position's own borrow, on the market's curve.
  const first = loopPosition({ kind: b.kind, capital, leverage: L, days, yieldPct, borrowPct: b.borrowApy * 100, lltv: b.lltv, oracleFactor, feeRate, entry });
  const borrowPct = (b.borrowCurve && rateAfterBorrow(b.borrowCurve, first.debtUsd, b.borrowApy * 100)) ?? b.borrowApy * 100;
  const r = useMemo(
    () => loopPosition({ kind: b.kind, capital, leverage: L, days, yieldPct, borrowPct, lltv: b.lltv, oracleFactor, feeRate, entry }),
    [b.kind, b.lltv, capital, L, days, yieldPct, borrowPct, oracleFactor, feeRate, entry],
  );

  const points: LoopChartPoint[] = useMemo(() => {
    if (!series) return [];
    const from = range === 'all' ? 0 : series.rows[series.rows.length - 1][0] - Number(range) * DAY_S;
    return series.rows.filter((x) => x[0] >= from).map(([t, borrow, , , fixed]) => ({ t, borrowPct: borrow, fixedPct: fixed }));
  }, [series, range]);

  const buffer = r.healthPct * 100;
  const short = b.liquidityUsd !== null && r.debtUsd > b.liquidityUsd;
  const at = (x: number) => `${top > 1.1 ? ((x - 1.1) / (top - 1.1)) * 100 : 0}%`;

  return (
    <section className="sx-card p-4 sm:p-5 flex flex-col gap-4" aria-label="جزئیات جعبه">
      <header className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
        <BoxIdentity b={b} icon={icon} size={48} />
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          <Pill>LLTV <Num>{pct(b.lltv, 1)}</Num></Pill>
          {b.maxLeverage && <Pill>بیشینه <Num>{`${formatNumber(b.maxLeverage, 1)}×`}</Num></Pill>}
          <Pill tone="success">بیشینه APY <Num>{pct(b.maxApy)}</Num></Pill>
          {b.expiry ? (
            <Pill tone="info">
              سررسید {formatDate(b.expiry)} · <Num>{formatNumber(Math.ceil(days), 0)}</Num> روز
            </Pill>
          ) : (
            <Pill>بدون سررسید</Pill>
          )}
          {b.isDepegged && <Pill tone="danger">از برابری خارج شده</Pill>}
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-secondary">
            {b.kind === 'pt' ? 'نرخ ثابت PT' : 'بازده دارایی'} <Num className="text-success font-semibold">{formatPercent(yieldPct, 2)}</Num> · بهره‌ی وام <Num className="text-warning font-semibold">{formatPercent(borrowPct, 2)}</Num>
            {b.borrowApy7dAvg !== null && <> (میانگین ۷ روز <Num>{pct(b.borrowApy7dAvg)}</Num>)</>}
          </span>
          <Segmented<Range> value={range} onChange={setRange} label="بازه‌ی نمودار" size="sm" options={[{ id: '7', label: '۷ روز' }, { id: '30', label: '۳۰ روز' }, { id: 'all', label: 'همه' }]} />
        </div>
        {loading ? <div className="h-44 rounded-lg bg-elevated animate-pulse" aria-busy="true" /> : <LoopChart points={points} yieldLabel={b.kind === 'pt' ? 'نرخ ثابت PT' : 'بازده دارایی'} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-default pt-4">
        <div className="flex flex-col gap-3">
          <NumberField label="سرمایه" value={capital} onChange={(v) => setCapital(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" warning={b.minOpenUsd && capital < b.minOpenUsd ? `PendleLoop دست‌کم ${formatUSD(b.minOpenUsd, 0)} می‌خواهد.` : undefined} />
          {b.kind === 'vanilla' && <NumberField label="مدت نگه‌داری" value={horizon} onChange={(v) => setHorizon(Number.isFinite(v) && v > 0 ? v : 1)} suffix="روز" />}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-secondary">اهرم (همان عدد PendleLoop)</span>
              <span className={`text-lg font-semibold ${L > safe ? 'text-warning' : 'text-primary'}`}>
                <Num>{`${formatNumber(L, 1)}×`}</Num>
              </span>
            </div>
            <div className="relative">
              <input type="range" min={1.1} max={top} step={0.1} value={L} onChange={(e) => setLev(Number(e.target.value))} aria-label="اهرم" className="w-full" />
              {safe > 1.1 && safe < top && <span className="absolute -bottom-1 h-2 w-0.5 rounded bg-warning" style={{ insetInlineStart: at(safe) }} aria-hidden />}
            </div>
            <div className="flex justify-between text-xs text-muted">
              <Num>1.1×</Num>
              {safe > 1.1 && safe < top && <span className="text-warning">حد امن <Num>{`${formatNumber(floor1(safe), 1)}×`}</Num></span>}
              <span>بیشینه <Num>{`${formatNumber(top, 1)}×`}</Num></span>
            </div>
          </div>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-elevated border border-default px-3 py-2">
              <dt className="text-xs text-muted">APY لوپ</dt>
              <dd className={`text-xl font-semibold ${r.apy >= yieldPct ? 'text-success' : 'text-danger'}`}><Num>{formatPercent(r.apy, 2)}</Num></dd>
            </div>
            <div className="rounded-xl bg-elevated border border-default px-3 py-2">
              <dt className="text-xs text-muted">{b.kind === 'pt' ? 'سود تا سررسید' : `سود در ${formatNumber(days, 0)} روز`}</dt>
              <dd className={`text-xl font-semibold ${r.profit >= 0 ? 'text-success' : 'text-danger'}`}><Num>{formatUSD(r.profit, 2, true)}</Num></dd>
            </div>
          </div>
          <Line label="وام" value={<Num>{formatUSD(r.debtUsd, 0)}</Num>} />
          <Line label={b.kind === 'pt' ? 'وثیقه (PT)' : 'وثیقه'} value={b.kind === 'pt' ? <span className="inline-flex gap-1.5"><Num>{formatNumber(r.units, 0)}</Num><span className="text-muted">·</span><Num>{formatUSD(r.collateralUsd, 0)}</Num></span> : <Num>{formatUSD(r.collateralUsd, 0)}</Num>} />
          <Line
            label={entry.quoted ? `هزینه‌ی ورود (کارمزد ${formatPercent(feeRate * 100, 2)} + اثر قیمت و تبدیل ${quote?.tokenIn ?? ''})` : `هزینه‌ی ورود (کارمزد ${formatPercent(feeRate * 100, 2)})`}
            value={<Num className="text-warning">{formatUSD(-r.entryCostUsd, 2, true)}</Num>}
          />
          <Line label="بهره‌ی وام پس از وام شما" value={<Num>{formatPercent(borrowPct, 2)}</Num>} />
          <Line label="بهره‌ی وامی که سود را صفر می‌کند (با هزینه‌ی ورود؛ عدد PendleLoop بدون آن و بالاتر است)" value={r.breakEvenBorrowPct !== null && Number.isFinite(r.breakEvenBorrowPct) ? <Num>{formatPercent(r.breakEvenBorrowPct, 2)}</Num> : '—'} />
          <Line label="Health Factor" value={<Num className={r.health < thresholds.opportunities.loopMinHealth ? 'text-danger' : ''}>{formatNumber(r.health, 2)}</Num>} />
          <Line label="Health Factor به سبک PendleLoop" value={<Num className={buffer < 5 ? 'text-danger' : buffer < 7 ? 'text-warning' : 'text-success'}>{formatPercent(buffer, 2)}</Num>} />
          {b.kind === 'pt' &&
            (entry.quoted ? (
              <p className="text-xs text-muted leading-5">
                قیمت اجرایی روتر پندل برای خرید <Num>{formatUSD(quote!.usd, 0)}</Num> PT با <bdi dir="ltr">{quote!.tokenIn ?? 'USDC'}</bdi>{quote!.priceImpactPct !== null && <> (اثر قیمت <Num>{formatPercent(quote!.priceImpactPct, 2)}</Num>)</>}.
              </p>
            ) : waiting ? (
              <p className="text-xs text-muted leading-5 inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> گرفتن قیمت اجرایی پندل برای این مبلغ…
              </p>
            ) : (
              <p className="text-xs text-warning leading-5">قیمت اجرایی پندل دریافت نشد: اثر قیمت و تبدیل توکن وام حساب نشده و سود واقعی کمتر از این است.</p>
            ))}
          {oracleFactor < 0.9999 && <p className="text-xs text-muted">اوراکل این بازار PT را <Num>{formatPercent((1 - oracleFactor) * 100, 2)}</Num> زیر قیمت بازار می‌خواند؛ LTV روی همان حساب شد.</p>}
          {short && <p className="text-xs text-warning">نقدینگی قابل وام <Num>{formatUSDCompact(b.liquidityUsd!)}</Num> است؛ این اهرم بیشتر می‌خواهد.</p>}
        </dl>
      </div>

      <div className="border-t border-default pt-4">
        <LoopHistory chainId={b.chainId} collateral={b.collateral.address} boxId={b.boxId.toLowerCase()} lltv={b.lltv} leverage={L} top={top} />
      </div>

      {b.risk && (
        <details className="group rounded-xl border border-default">
          <summary className="tap flex items-center justify-between gap-2 px-3 min-h-11 text-sm">
            <span className="flex items-center gap-1.5">
              <ShieldAlert size={15} aria-hidden /> اوراکل این بازار: <Pill tone={RISK_TONE[b.risk.level] ?? 'warning'}>{RISK_FA[b.risk.level] ?? b.risk.label}</Pill>
            </span>
            <ChevronDown size={15} className="transition-transform group-open:rotate-180 text-muted" aria-hidden />
          </summary>
          <div className="px-3 pb-3 flex flex-col gap-2 text-xs leading-5 text-secondary" dir="ltr">
            {b.risk.summary && <p>{b.risk.summary}</p>}
            {b.risk.items.map((it) => (
              <p key={it.name}>
                <b className="text-primary">{it.name}</b> — <span className={riskText(it.level)}>{it.label}</span>. {it.text}
              </p>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <a href={b.pendleUrl} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1.5 rounded-md bg-brand text-on-brand px-4 min-h-11 text-sm font-medium">
          <Repeat size={15} aria-hidden /> باز کردن در PendleLoop
        </a>
        {b.marketUrl && (
          <a href={b.marketUrl} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1.5 rounded-md border border-default px-4 min-h-11 text-sm">
            <Landmark size={15} aria-hidden /> بازار وام در <bdi dir="ltr">{b.protocol.name}</bdi> <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </div>
      <p className="text-xs text-muted leading-5">
        شبکه: {net.nameFa}. اهرم و Health Factor به تعریف خود PendleLoop است (۱ ÷ (۱ − LTV) با قیمت اوراکل)، پس همان عدد صفحه‌ی PendleLoop را وارد کنید. APY با نرخ‌های همین لحظه تا {b.kind === 'pt' ? 'سررسید' : 'پایان مدت'} حساب شده، با کارمزد PendleLoop، اثر قیمت خرید (روتر پندل) و بهره‌ی وام پس از وام شما. فرض این است که با همان توکن وام
        (<bdi dir="ltr">{b.debt.symbol}</bdi>) واریز می‌کنید؛ واریز با توکن دیگر (مثلاً ETH) یک سواپ و ریسک قیمت اضافه دارد که اینجا نیست.
      </p>
    </section>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-default last:border-0 py-1">
      <dt className="text-secondary">{label}</dt>
      <dd className="font-medium text-primary">{value}</dd>
    </div>
  );
}
