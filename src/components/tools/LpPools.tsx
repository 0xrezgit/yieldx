'use client';

import { useEffect, useMemo, useState } from 'react';
import { Droplets, ExternalLink, Loader2 } from 'lucide-react';
import config from '../../config/lp-pools.json';
import type { LpPool, LpPoolFeed, RejectReason } from '../../lib/lp/pools';
import { rankPools, type PoolEstimate } from '../../lib/lp/estimate';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { networkByChainId } from '../../lib/registry/networks';
import { formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
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
  history: 'بدون تاریخچه‌ی کامل کارمزد',
  outlier: 'نرخ غیرعادی',
  volatility: 'بدون داده‌ی نوسان',
  inactive: 'غیرفعال',
};

const signed = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/** The pool as A/B (the pool list already keeps that order). */
export const orient = (p: LpPool) => p.tokens;

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
    concentrated: p.concentrated,
    url: p.url,
    revertUrl: p.revert?.url,
    feeDays: p.feeDays,
    feeTrendPct: p.feeTrendPct,
    unstakedFee: p.unstakedFee,
    realLps: p.realLps ?? null,
    source: 'vfat',
    ...(capital ? { capital } : {}),
    ...(days ? { days } : {}),
  };
}

/** Live refresh while the page is visible; quicker while the server is still preparing pools. */
const REFRESH_MS = 60_000;
const PREPARING_MS = 8_000;

function useLpPools() {
  const [feed, setFeed] = useState<LpPoolFeed | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, ms);
    };
    function load() {
      // A hidden tab does not poll; coming back refreshes at once (below).
      if (document.visibilityState !== 'visible') return schedule(REFRESH_MS);
      fetch('/api/lp-pools', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<LpPoolFeed>) : Promise.reject(new Error(String(r.status)))))
        .then((f) => {
          if (!live) return;
          setFeed(f);
          setFailed(false);
          schedule(f.pending > 0 || f.realPending > 0 ? PREPARING_MS : REFRESH_MS);
        })
        // A failed refresh keeps the last good list on screen and tries again.
        .catch(() => {
          if (!live) return;
          setFailed(true);
          schedule(REFRESH_MS);
        });
    }
    const now = () => document.visibilityState === 'visible' && load();
    load();
    document.addEventListener('visibilitychange', now);
    window.addEventListener('online', now);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', now);
      window.removeEventListener('online', now);
    };
  }, []);
  return { feed, failed: failed && !feed, stale: failed && !!feed, loading: !feed && !failed };
}

function Row({ p, est, rank, onPick }: { p: LpPool; est: PoolEstimate; rank: number; onPick: () => void }) {
  const net = networkByChainId(p.chainId);
  const [a, b] = orient(p);
  const range = est.shape.kind === 'range' ? est.shape : null;
  return (
    <li className="flex items-center gap-1">
      <button type="button" onClick={onPick} className="tap flex-1 min-w-0 text-right py-3 flex items-center gap-3 rounded-lg hover:bg-raised/50" aria-label={`تحلیل ${a.symbol}/${b.symbol}`}>
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
              {range ? (
                <>
                  بازه <Num>{formatPercent((range.low - 1) * 100, 0, true)}</Num> تا <Num>{formatPercent((range.high - 1) * 100, 0, true)}</Num>
                </>
              ) : (
                'تمام‌بازه'
              )}
            </span>
            <span className="whitespace-nowrap">
              کارمزد <Num>{signed(est.feesUsd)}</Num>
            </span>
            <span className="whitespace-nowrap">
              هزینه‌ی نوسان <Num>{signed(est.lossUsd)}</Num>
            </span>
            {p.incentives && <span className="whitespace-nowrap">پاداش جدا حساب نشده</span>}
          </span>
          {p.realLps && (
            <span className="text-xs text-secondary flex flex-wrap gap-x-2" title="پوزیشن‌های واقعی همین استخر در Revert">
              <span className="whitespace-nowrap">
                LPهای واقعی: کارمزد <Num>{formatPercent(p.realLps.feeApr.median, 0)}</Num>
              </span>
              <span className="whitespace-nowrap">
                <Num>{formatPercent(p.realLps.inRangePct, 0)}</Num> در بازه
              </span>
              <span className="whitespace-nowrap">
                <Num>{formatNumber(p.realLps.count, 0)}</Num> پوزیشن
              </span>
            </span>
          )}
        </span>
        <span className="shrink-0 flex flex-col items-end leading-tight">
          <span className={`text-base font-semibold ${est.netUsd >= 0 ? 'text-success' : 'text-danger'}`}>
            <Num>{signed(est.netUsd)}</Num>
          </span>
          <span className="text-[11px] text-muted mt-0.5">
            نقدینگی <Num>{formatUSDCompact(p.tvlUsd)}</Num>
          </span>
        </span>
      </button>
      <a href={p.url} target="_blank" rel="noopener noreferrer" className="tap shrink-0 grid place-items-center size-10 rounded-md text-muted hover:text-primary hover:bg-raised" aria-label={`ورود به بازار ${a.symbol}/${b.symbol} در vfat`} title="ورود به همین بازار (vfat)">
        <ExternalLink size={16} aria-hidden />
      </a>
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
  const { feed, failed, stale, loading } = useLpPools();
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
  const partial = stale || (feed?.sources.some((s) => !s.ok) ?? false);

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
              سود مورد انتظار <Num>{formatNumber(st.days, 0)}</Num> روزه با <Num>{formatUSD(st.capital, 0)}</Num>
            </span>
            <span className="text-xs text-secondary leading-5">با بازه‌ای به اندازه‌ی نوسان معمول هر استخر: کارمزد منهای هزینه‌ی مورد انتظار نوسان قیمت، نسبت به نگه‌داشتن ساده. برای دیدن حالت‌های مختلف روی ردیف بزنید؛ برای ورود، آیکون کنار آن.</span>
          </span>
          {feed && <DataStatus source="api" fetchedAt={Date.parse(feed.fetchedAt)} stale={partial} label={<bdi dir="ltr">vfat</bdi>} />}
        </div>
        {feed && feed.pending > 0 && (
          <p className="text-xs text-secondary flex items-center gap-1.5 pb-2" aria-live="polite">
            <Loader2 size={12} className="animate-spin" aria-hidden /> <Num>{formatNumber(feed.pending, 0)}</Num> استخر دیگر در حال آماده‌سازی؛ خودکار اضافه می‌شوند.
          </p>
        )}

        {loading ? (
          <p className="text-sm text-secondary flex items-center gap-2 py-8 justify-center" aria-busy="true">
            <Loader2 size={14} className="animate-spin" aria-hidden /> در حال دریافت استخرها…
          </p>
        ) : failed ? (
          <Empty>vfat پاسخ نداد.</Empty>
        ) : !ranked.length && feed?.pending ? (
          <p className="text-sm text-secondary py-8 text-center">در حال محاسبه‌ی کارمزد استخرها…</p>
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
          فقط جفت‌های استیبل، <bdi dir="ltr">ETH</bdi>، <bdi dir="ltr">BTC</bdi> و سهام توکنیزه‌ی تأییدشده. نرخ کارمزد از درآمد واقعی ۳۰ روز گذشته به ازای نقدینگی فعال استخر (در Aerodrome پس از کسر سهم استخر از کارمزد LPهای بدون استیک)؛ هزینه‌ی نوسان از نوسان واقعی ۳۰ روز اخیر همان جفت (σ²/۸ در سال). خروج قیمت از بازه، پاداش‌های جدا و گس حساب نشده‌اند.
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
