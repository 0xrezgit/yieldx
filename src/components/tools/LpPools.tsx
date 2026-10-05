'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Droplets, Loader2 } from 'lucide-react';
import config from '../../config/lp-pools.json';
import type { AssetClass, LpPool, LpPoolFeed, RejectReason } from '../../lib/lp/pools';
import { rankPools, type PoolEstimate } from '../../lib/lp/estimate';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { networkByChainId } from '../../lib/registry/networks';
import { formatNumber, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { DataStatus } from '../ui/data-status';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { PairLogo } from '../ui/asset-identity';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import type { LpPrefill } from '../opportunities/LpAnalyzer';

type Scope = 'focus' | 'stock' | 'all';
const STEP = 15;
const FOCUS = config.vfat.focusChainId;
const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

const REJECT_LABEL: Record<RejectReason, string> = {
  asset: 'میم‌کوین یا توکن ناشناخته',
  price: 'قیمت ناهمخوان',
  tvl: 'نقدینگی کم',
  age: 'سابقه‌ی کمتر از یک هفته',
  fees: 'بدون کارمزد ثبت‌شده',
  outlier: 'نرخ غیرعادی',
  volatility: 'بدون داده‌ی نوسان',
  inactive: 'غیرفعال',
};

const signed = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/** The side used as the price unit (B): a dollar first, then ETH/BTC, a stock last. */
const UNIT_RANK: Record<AssetClass, number> = { usd: 0, eth: 1, btc: 1, stock: 2 };

/** The pool as A/B: the more volatile side moves (A), the steadier one is the unit (B). */
export function orient(p: LpPool) {
  const [x, y] = p.tokens;
  return UNIT_RANK[x.cls] < UNIT_RANK[y.cls] ? ([y, x] as const) : ([x, y] as const);
}

export function toPrefill(p: LpPool, capital?: number, days?: number): LpPrefill {
  const [a, b] = orient(p);
  return {
    name: `${a.symbol}/${b.symbol} · ${p.protocol}`,
    a: a.symbol,
    b: b.symbol,
    logoA: a.logo,
    logoB: b.logo,
    chain: networkByChainId(p.chainId).name,
    protocol: p.protocol,
    stable: p.stable,
    feeApr: Math.round(p.feeAprPct * 100) / 100,
    move7d: p.move7d,
    source: 'vfat',
    ...(capital ? { capital } : {}),
    ...(days ? { days } : {}),
  };
}

function useLpPools() {
  const [feed, setFeed] = useState<LpPoolFeed | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/lp-pools')
      .then((r) => (r.ok ? (r.json() as Promise<LpPoolFeed>) : Promise.reject(new Error(String(r.status)))))
      .then((f) => live && setFeed(f))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return { feed, failed, loading: !feed && !failed };
}

function Row({ p, est, rank, onPick }: { p: LpPool; est: PoolEstimate; rank: number; onPick: () => void }) {
  const net = networkByChainId(p.chainId);
  const [a, b] = orient(p);
  return (
    <li>
      <button type="button" onClick={onPick} className="tap w-full text-right py-3 flex items-center gap-3 rounded-lg hover:bg-raised/50" aria-label={`تحلیل ${a.symbol}/${b.symbol}`}>
        <span className="w-5 shrink-0 text-xs text-muted text-center">
          <Num>{formatNumber(rank, 0)}</Num>
        </span>
        <PairLogo a={{ symbol: a.symbol, logo: a.logo }} b={{ symbol: b.symbol, logo: b.logo }} chain={net.name} size={32} />
        <span className="min-w-0 flex-1 flex flex-col leading-tight gap-1">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold text-primary min-w-0">
            <bdi dir="ltr" className="truncate">
              {a.symbol}/{b.symbol}
            </bdi>
            {a.cls === 'stock' && <Pill tone="info">سهام</Pill>}
            {p.stable && <Pill tone="success">استیبل</Pill>}
          </span>
          <span className="text-xs text-secondary truncate">
            <bdi dir="ltr">{p.protocol}</bdi> · {net.nameFa}
          </span>
          <span className="text-xs text-secondary flex flex-wrap gap-x-2">
            <span className="whitespace-nowrap">
              کارمزد <Num>{signed(est.feesUsd)}</Num>
            </span>
            <span className="whitespace-nowrap">
              ضرر نوسان <Num>{signed(est.lossUsd)}</Num>
            </span>
            {p.incentives && <span className="whitespace-nowrap">پاداش جدا حساب نشده</span>}
          </span>
        </span>
        <span className="shrink-0 flex flex-col items-end leading-tight">
          <span className={`text-base font-semibold ${est.netUsd >= 0 ? 'text-success' : 'text-danger'}`}>
            <Num>{signed(est.netUsd)}</Num>
          </span>
          <span className="text-[11px] text-muted mt-0.5">
            نقدینگی <Num>{formatUSDCompact(p.tvlUsd)}</Num>
          </span>
        </span>
        <ChevronLeft size={16} className="text-muted shrink-0" aria-hidden />
      </button>
    </li>
  );
}

interface Stored {
  capital: number;
  days: Period;
  scope: Scope;
}

/**
 * «استخرهای LP»: vetted vfat pools, ordered by a cautious dollar estimate for the
 * user's amount and period. Kept apart from the market ranking; each row opens the
 * analyzer with the pool's own numbers.
 */
export function LpPools({ onPick }: { onPick: (p: LpPrefill) => void }) {
  const { feed, failed, loading } = useLpPools();
  const [st, setSt] = useState<Stored>({ capital: 1000, days: 30, scope: 'focus' });
  const [shown, setShown] = useState(STEP);
  useEffect(() => {
    const s = readLocal<Partial<Stored>>(STORAGE_KEYS.lpPools, {});
    setSt((d) => ({
      capital: typeof s.capital === 'number' && s.capital > 0 ? s.capital : d.capital,
      days: PERIODS.includes(s.days as Period) ? (s.days as Period) : d.days,
      scope: s.scope === 'stock' || s.scope === 'all' ? s.scope : d.scope,
    }));
  }, []);
  const patch = (p: Partial<Stored>) => {
    const next = { ...st, ...p };
    setSt(next);
    writeLocal(STORAGE_KEYS.lpPools, next);
    setShown(STEP);
  };

  const ranked = useMemo(() => {
    const all = feed?.pools ?? [];
    const scoped = st.scope === 'focus' ? all.filter((p) => p.chainId === FOCUS) : st.scope === 'stock' ? all.filter((p) => p.tokens.some((t) => t.cls === 'stock')) : all;
    return rankPools(scoped, st.capital, st.days);
  }, [feed, st]);
  const dropped = feed ? (Object.entries(feed.rejected) as [RejectReason, number][]).filter(([, n]) => n > 0) : [];
  const partial = feed?.sources.some((s) => !s.ok) ?? false;

  return (
    <section className="flex flex-col gap-4" aria-label="استخرهای LP">
      <div className="sx-card p-4 flex flex-col gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Droplets size={18} className="text-accent" aria-hidden /> LP به زبان ساده
        </h2>
        <ul className="text-sm text-secondary leading-7 flex flex-col gap-1">
          <li>
            <b className="text-primary">چه می‌کنید:</b> دو دارایی (مثلاً یک سهم و دلار) را با هم در یک استخر می‌گذارید تا دیگران با آن معامله کنند.
          </li>
          <li>
            <b className="text-primary">درآمد:</b> از هر معامله کارمزد می‌گیرید.
          </li>
          <li>
            <b className="text-primary">ریسک:</b> اگر قیمت زیاد بالا یا پایین برود، ترکیب دو دارایی شما خودکار عوض می‌شود و از نگه‌داشتن ساده عقب می‌مانید؛ ارزش خود دارایی‌ها هم با بازار تغییر می‌کند.
          </li>
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="سرمایه" value={st.capital} onChange={(v) => Number.isFinite(v) && v > 0 && patch({ capital: v })} suffix="دلار" />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">مدت</span>
            <Segmented<`${Period}`> value={`${st.days}`} onChange={(v) => patch({ days: Number(v) as Period })} label="مدت" size="sm" options={PERIODS.map((d) => ({ id: `${d}` as `${Period}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
          </div>
        </div>
        <Segmented<Scope>
          value={st.scope}
          onChange={(scope) => patch({ scope })}
          label="دامنه"
          size="sm"
          options={[
            { id: 'focus', label: networkByChainId(FOCUS).nameFa },
            { id: 'stock', label: 'سهام توکنیزه' },
            { id: 'all', label: 'همه‌ی شبکه‌ها' },
          ]}
        />
      </div>

      <div className="sx-card px-3 pt-3 sm:px-4 pb-1 flex flex-col">
        <div className="flex items-start justify-between gap-3 pb-2">
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-primary">
              سود برآوردی <Num>{formatNumber(st.days, 0)}</Num> روزه با <Num>{formatUSD(st.capital, 0)}</Num>
            </span>
            <span className="text-xs text-secondary leading-5">کارمزد منهای ضرر یک نوسان معمول قیمت، نسبت به نگه‌داشتن ساده. برای جزئیات و سناریوها روی هر ردیف بزنید.</span>
          </span>
          {feed && <DataStatus source="api" fetchedAt={Date.parse(feed.fetchedAt)} stale={partial} label={<bdi dir="ltr">vfat</bdi>} />}
        </div>

        {loading ? (
          <p className="text-sm text-secondary flex items-center gap-2 py-8 justify-center" aria-busy="true">
            <Loader2 size={14} className="animate-spin" aria-hidden /> در حال دریافت استخرها…
          </p>
        ) : failed ? (
          <Empty>vfat پاسخ نداد.</Empty>
        ) : !ranked.length ? (
          <Empty>هیچ استخری همه‌ی معیارها را نداشت.</Empty>
        ) : (
          <>
            <ol className="flex flex-col divide-y divide-default">
              {ranked.slice(0, shown).map(({ pool, est }, i) => (
                <Row key={pool.id} p={pool} est={est} rank={i + 1} onPick={() => onPick(toPrefill(pool, st.capital, st.days))} />
              ))}
            </ol>
            {shown < ranked.length && (
              <button type="button" onClick={() => setShown(shown + STEP)} className="tap self-center my-2 rounded-md border border-default px-4 min-h-9 text-xs text-secondary hover:text-primary">
                بیشتر (<Num>{formatNumber(ranked.length - shown, 0)}</Num>)
              </button>
            )}
          </>
        )}

        <p className="text-xs text-muted leading-6 py-3 border-t border-default mt-1">
          فقط جفت‌های استیبل، <bdi dir="ltr">ETH</bdi>، <bdi dir="ltr">BTC</bdi> و سهام توکنیزه‌ی تأییدشده. کارمزد از درآمد واقعی هفته‌ی گذشته‌ی کل استخر، برای پوزیشن تمام‌بازه.
          {dropped.length > 0 && (
            <>
              {' '}کنار گذاشته شد:{' '}
              {dropped.map(([r, n], i) => (
                <span key={r}>
                  {i > 0 && '، '}
                  {REJECT_LABEL[r]} <Num>{formatNumber(n, 0)}</Num>
                </span>
              ))}
              .
            </>
          )}
        </p>
      </div>
    </section>
  );
}
