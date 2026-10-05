'use client';

import { useEffect, useMemo, useState } from 'react';
import { Droplets, Loader2 } from 'lucide-react';
import config from '../../config/lp-pools.json';
import type { AssetClass, LpPool, LpPoolFeed, RejectReason } from '../../lib/lp/pools';
import { networkByChainId } from '../../lib/registry/networks';
import { formatNumber, formatPercent, formatUSDCompact } from '../../lib/utils/formatting';
import { DataStatus } from '../ui/data-status';
import { Num } from '../ui/num';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import type { LpPrefill } from '../opportunities/LpAnalyzer';

type Scope = 'focus' | 'stock' | 'all';
const STEP = 15;
const FOCUS = config.vfat.focusChainId;

const REJECT_LABEL: Record<RejectReason, string> = {
  asset: 'میم‌کوین یا توکن ناشناخته',
  price: 'قیمت ناهمخوان',
  tvl: 'نقدینگی کم',
  age: 'سابقه‌ی کمتر از یک هفته',
  fees: 'بدون کارمزد ثبت‌شده',
  outlier: 'نرخ غیرعادی',
  inactive: 'غیرفعال',
};

/** The side used as the price unit (B): a dollar first, then ETH/BTC, a stock last. */
const UNIT_RANK: Record<AssetClass, number> = { usd: 0, eth: 1, btc: 1, stock: 2 };

/** The pool as the analyzer's A/B: the more volatile side moves (A), the steadier one is the unit (B). */
export function toPrefill(p: LpPool): LpPrefill {
  const [x, y] = p.tokens;
  const [a, b] = UNIT_RANK[x.cls] < UNIT_RANK[y.cls] ? [y, x] : [x, y];
  return { name: `${a.symbol}/${b.symbol} · ${p.protocol}`, a: a.symbol, b: b.symbol, stable: p.stable, feeApr: Math.round(p.feeAprPct * 100) / 100, source: 'vfat' };
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

function Row({ p, onPick }: { p: LpPool; onPick: (p: LpPool) => void }) {
  const net = networkByChainId(p.chainId);
  const pair = toPrefill(p);
  return (
    <li className="py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold text-primary min-w-0">
            <bdi dir="ltr" className="truncate">
              {pair.a}/{pair.b}
            </bdi>
            <span className="text-secondary font-normal">·</span>
            <bdi dir="ltr" className="text-secondary font-normal shrink-0">
              {p.protocol}
            </bdi>
          </span>
          <span className="text-xs text-secondary mt-0.5">
            {net.nameFa}
            {p.feeTierPct !== null && (
              <>
                {' '}· کارمزد استخر <Num>{formatPercent(p.feeTierPct, 2)}</Num>
              </>
            )}
            {p.concentrated && ' · متمرکز'}
          </span>
        </span>
        <button type="button" onClick={() => onPick(p)} className="tap shrink-0 inline-flex items-center gap-1.5 rounded-md border border-default px-3 min-h-9 text-xs font-medium text-primary hover:bg-raised">
          <Droplets size={14} aria-hidden /> تحلیل
        </button>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
        <div className="flex flex-col">
          <dt className="text-secondary">کارمزد ۷ روز، سالانه</dt>
          <dd className="font-semibold text-primary"><Num>{formatPercent(p.feeAprPct, 1)}</Num></dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-secondary">نقدینگی</dt>
          <dd><Num>{formatUSDCompact(p.tvlUsd)}</Num></dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-secondary">حجم ۷ روز</dt>
          <dd><Num>{formatUSDCompact(p.volume7dUsd)}</Num></dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-secondary">نوسان ۷ روزه (۹۵٪)</dt>
          <dd>{p.move7d ? <Num>{`${formatPercent(-p.move7d.down, 1, true)} / ${formatPercent(p.move7d.up, 1, true)}`}</Num> : '—'}</dd>
        </div>
      </dl>
      {(p.tokens.some((t) => t.cls === 'stock') || p.stable || p.incentives) && (
        <div className="flex flex-wrap gap-1.5">
          {p.tokens.some((t) => t.cls === 'stock') && <Pill tone="info">سهام توکنیزه</Pill>}
          {p.stable && <Pill tone="success">دو استیبل</Pill>}
          {p.incentives && <Pill>پاداش جدا؛ حساب نشده</Pill>}
        </div>
      )}
    </li>
  );
}

/**
 * «استخرهای LP»: vetted pools from vfat. A list to start the analyzer from, not a
 * ranking — LP has no dollar estimate without a price path.
 */
export function LpPools({ onPick }: { onPick: (p: LpPrefill) => void }) {
  const { feed, failed, loading } = useLpPools();
  const [scope, setScope] = useState<Scope>('focus');
  const [shown, setShown] = useState(STEP);
  const pools = useMemo(() => {
    const all = feed?.pools ?? [];
    if (scope === 'focus') return all.filter((p) => p.chainId === FOCUS);
    if (scope === 'stock') return all.filter((p) => p.tokens.some((t) => t.cls === 'stock'));
    return all;
  }, [feed, scope]);
  const dropped = feed ? (Object.entries(feed.rejected) as [RejectReason, number][]).filter(([, n]) => n > 0) : [];
  const partial = feed?.sources.some((s) => !s.ok) ?? false;

  return (
    <section className="sx-card p-4 flex flex-col gap-3" aria-label="استخرهای LP">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold flex items-center gap-2">
          <Droplets size={18} aria-hidden /> استخرهای LP
        </h2>
        <p className="text-sm text-secondary leading-7">
          فقط جفت‌های استیبل، <bdi dir="ltr">ETH</bdi>، <bdi dir="ltr">BTC</bdi> و سهام توکنیزه‌ی تأییدشده. رتبه‌بندی سود نیست؛ برای دیدن سود و ضرر، «تحلیل» را بزنید.
        </p>
        {feed && <DataStatus source="api" fetchedAt={Date.parse(feed.fetchedAt)} stale={partial} label={<bdi dir="ltr">vfat</bdi>} />}
      </div>

      <Segmented<Scope>
        value={scope}
        onChange={(s) => {
          setScope(s);
          setShown(STEP);
        }}
        label="دامنه"
        size="sm"
        options={[
          { id: 'focus', label: networkByChainId(FOCUS).nameFa },
          { id: 'stock', label: 'سهام توکنیزه' },
          { id: 'all', label: 'همه‌ی شبکه‌ها' },
        ]}
      />

      {loading ? (
        <p className="text-sm text-secondary flex items-center gap-2 py-6 justify-center" aria-busy="true">
          <Loader2 size={14} className="animate-spin" aria-hidden /> در حال دریافت استخرها…
        </p>
      ) : failed ? (
        <Empty>vfat پاسخ نداد.</Empty>
      ) : !pools.length ? (
        <Empty>هیچ استخری همه‌ی معیارها را نداشت.</Empty>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-default">
            {pools.slice(0, shown).map((p) => (
              <Row key={p.id} p={p} onPick={(x) => onPick(toPrefill(x))} />
            ))}
          </ol>
          {shown < pools.length && (
            <button type="button" onClick={() => setShown(shown + STEP)} className="tap self-center rounded-md border border-default px-4 min-h-9 text-xs text-secondary hover:text-primary">
              بیشتر (<Num>{formatNumber(pools.length - shown, 0)}</Num>)
            </button>
          )}
        </>
      )}

      {dropped.length > 0 && (
        <p className="text-xs text-muted leading-6">
          کنار گذاشته شد: {dropped.map(([r, n], i) => (
            <span key={r}>
              {i > 0 && '، '}
              {REJECT_LABEL[r]} <Num>{formatNumber(n, 0)}</Num>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
