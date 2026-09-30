'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ListChecks, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import { useMerkl } from '../../hooks/useMerkl';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { applyMerklFilters, defaultMerklFilters, hasRobinhoodMeme, liveAt, type MerklFilters } from '../../lib/merkl/filters';
import { defaultEstimateSettings, GAS_UNITS, HORIZONS, rankTop, TOP_N, type EstimateSettings, type Horizon } from '../../lib/merkl/profit';
import { rankRewards } from '../../lib/merkl/rewards';
import { buildContext, gate, RULES } from '../../lib/merkl/vetting';
import { formatNumber, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { DataStatus } from '../ui/data-status';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Segmented } from '../opportunities/parts';
import { SectionSwitch } from '../opportunities/SectionSwitch';
import { MerklFilterBar } from './MerklFilters';
import { RewardsBoard } from './RewardsBoard';
import { TopMarkets } from './TopMarkets';

type Tab = 'top' | 'rewards';

interface Stored {
  tab: Tab;
  settings: EstimateSettings;
  filters: MerklFilters;
  watch: string[];
}

const initial: Stored = { tab: 'top', settings: defaultEstimateSettings, filters: defaultMerklFilters, watch: [] };

/** Stored values may be missing, NaN or from an older shape: fall back field by field. */
function sane<T extends object>(value: Partial<T> | undefined, fallback: T): T {
  const out = { ...fallback } as Record<string, unknown>;
  for (const [k, v] of Object.entries(value ?? {})) {
    if (!(k in fallback)) continue;
    const d = (fallback as Record<string, unknown>)[k];
    if (typeof d === 'number') out[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d;
    else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else if (typeof d === 'string') out[k] = typeof v === 'string' ? v : d;
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

function restore(): Stored {
  const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.merkl, {});
  const settings = sane(saved.settings, initial.settings);
  if (!HORIZONS.includes(settings.horizon)) settings.horizon = initial.settings.horizon;
  const linked = new URLSearchParams(window.location.search).get('tab');
  return {
    tab: linked === 'rewards' || linked === 'top' ? linked : saved.tab === 'rewards' ? 'rewards' : 'top',
    settings,
    filters: sane(saved.filters, initial.filters),
    watch: Array.isArray(saved.watch) ? saved.watch.filter((x): x is string => typeof x === 'string') : [],
  };
}

/** Merkl incentives: the thirty best markets for the user's capital, and a separate token / point ranking. */
export default function MerklOpportunities() {
  const { feed, loading, refreshing, stale, failed, now, refresh } = useMerkl();
  const [st, setSt] = useState<Stored | null>(null);

  useEffect(() => setSt(restore()), []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.merkl, st);
  }, [st]);

  const patch = useCallback((p: Partial<Stored>) => setSt((s) => (s ? { ...s, ...p } : s)), []);
  const toggleWatch = useCallback((id: string) => setSt((s) => (s ? { ...s, watch: s.watch.includes(id) ? s.watch.filter((x) => x !== id) : [...s.watch, id] } : s)), []);

  // Recompute on the minute: campaigns that end between refreshes drop out on time.
  const minute = Math.floor(now / 60) * 60;
  const live = useMemo(() => (feed ? feed.opportunities.map((o) => liveAt(o, minute)).filter((o) => o.campaigns.length > 0) : []), [feed, minute]);
  const ctx = useMemo(() => buildContext(live, feed?.markets ?? {}, feed?.marketChains ?? [], minute), [live, feed, minute]);
  const watch = useMemo(() => new Set(st?.watch ?? []), [st?.watch]);
  const filtered = useMemo(() => (st ? applyMerklFilters(live, st.filters, watch) : []), [live, st, watch]);
  const settings = st?.settings ?? initial.settings;
  const ranking = useMemo(() => rankTop(filtered, settings, ctx, feed?.gas ?? []), [filtered, settings, ctx, feed?.gas]);
  const board = useMemo(() => rankRewards(filtered, settings, ctx), [filtered, settings, ctx]);
  const memes = useMemo(() => live.filter((o) => hasRobinhoodMeme(o) && !gate(o, ctx)).length, [live, ctx]);
  const dataAt = ranking.rows.length ? Math.min(...ranking.rows.map((r) => r.dataAt)) : null;
  const gas = feed?.gas.find((g) => g.chainId === 1);

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }
  const setS = (p: Partial<EstimateSettings>) => patch({ settings: sane({ ...st.settings, ...p }, st.settings) });

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">فرصت‌ها</h1>
          <p className="text-sm text-secondary">پاداش‌های تشویقی Merkl برای سرمایه‌ی شما؛ جدا از محاسبات PT، YT و لوپ.</p>
          <div className="mt-1">
            {loading ? (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> در حال دریافت فرصت‌های زنده‌ی Merkl…
              </p>
            ) : failed ? (
              <p className="text-xs text-danger flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-danger" aria-hidden /> داده‌ی Merkl دریافت نشد
              </p>
            ) : (
              <DataStatus source="api" fetchedAt={feed?.fetchedAt} stale={stale} label={<><Num>{formatNumber(live.length, 0)}</Num> فرصت زنده · به‌روزرسانی خودکار هر دقیقه</>} sourceName="API مرکل" />
            )}
          </div>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} className="tap inline-flex items-center gap-1.5 rounded-lg px-3 min-h-10 text-sm text-secondary hover:text-primary hover:bg-elevated disabled:opacity-60">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden /> به‌روزرسانی
        </button>
      </header>

      <SectionSwitch current="merkl" />

      <section className="sx-card p-4 flex flex-col gap-3" aria-label="مبلغ و افق">
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
          <NumberField label="مبلغ سرمایه" value={st.settings.capital} onChange={(v) => setS({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">افق مقایسه</span>
            <Segmented
              value={String(st.settings.horizon) as `${Horizon}`}
              onChange={(v) => setS({ horizon: Number(v) as Horizon })}
              label="افق مقایسه"
              options={HORIZONS.map((h) => ({ id: String(h) as `${Horizon}`, label: <><Num>{formatNumber(h, 0)}</Num> روز</> }))}
            />
          </div>
        </div>
      </section>

      <div className="sticky top-14 z-20 -mx-[var(--space-page-x)] px-[var(--space-page-x)] py-2 bg-canvas/95 backdrop-blur">
        <Segmented
          value={st.tab}
          onChange={(tab) => patch({ tab })}
          label="نما"
          options={[
            { id: 'top', label: <><Trophy size={15} aria-hidden /> ۳۰ بازار برتر Merkl</> },
            { id: 'rewards', label: <><Sparkles size={15} aria-hidden /> رتبه‌بندی توکن و پوینت</> },
          ]}
        />
      </div>

      <MerklFilterBar list={live} f={st.filters} setF={(filters) => patch({ filters })} shown={filtered.length} total={live.length} memes={memes} />

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : failed ? (
        <p className="text-sm text-secondary">دریافت از Merkl ممکن نشد. چند لحظه‌ی دیگر «به‌روزرسانی» را بزنید.</p>
      ) : !(st.settings.capital > 0) ? (
        <p className="text-sm text-secondary">مبلغ سرمایه را وارد کنید.</p>
      ) : st.tab === 'top' ? (
        <TopMarkets ranking={ranking} watch={watch} toggleWatch={toggleWatch} horizon={st.settings.horizon} dataAt={dataAt} />
      ) : (
        <RewardsBoard board={board} horizon={st.settings.horizon} watch={watch} toggleWatch={toggleWatch} />
      )}

      <Collapsible title="فرض‌ها، هزینه‌ها و معیارهای گزینش" icon={<ListChecks size={18} aria-hidden />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField
            label="هزینه‌ی هر تراکنش در اتریوم"
            value={st.settings.txEthereum}
            onChange={(v) => setS({ txEthereum: Number.isFinite(v) ? Math.max(0, v) : 0 })}
            suffix="دلار"
            help="فقط وقتی قیمت گس زنده دریافت نشود به کار می‌رود."
            note={gas ? <>گس زنده‌ی اتریوم: <Num>{formatNumber(gas.gwei, 3)}</Num> gwei — حدود <Num>{formatUSD(GAS_UNITS.deposit * gas.gwei * 1e-9 * gas.nativeUsd, 3)}</Num> برای یک سپرده</> : undefined}
          />
          <NumberField label="هزینه‌ی هر تراکنش در سایر شبکه‌ها" value={st.settings.txOther} onChange={(v) => setS({ txOther: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" help="فرض شما؛ در جزئیات هر بازار با برچسب «فرض شما» نشان داده می‌شود." />
        </div>
        <div className="text-sm text-secondary leading-7 flex flex-col gap-2">
          <p>
            <b className="text-primary">سود خالص برآوردی</b> = پاداش Merkl برای سهم شما (هر کمپین جدا، تا پایان خودش یا پایان افق، با قیمت فعلی توکن پاداش) + بازده بومی گزارش‌شده (اگر درون APR کمپین نباشد) − هزینه‌های لحاظ‌شده (گس ورود و خروج و claim، کارمزد استخر، اثر قیمت فروش پاداش). هزینه‌ی اندازه‌گیری‌ناپذیر فهرست می‌شود، حدس زده نمی‌شود.
          </p>
          <p>
            <b className="text-primary">گزینش:</b> کمپین فعال؛ شبکه، شناسه و دارایی قابل شناسایی؛ لینک ورود رسمی؛ داده‌ی Merkl تازه‌تر از <Num>{formatNumber(RULES.recordMaxAgeH, 0)}</Num> ساعت؛ TVL دست‌کم <Num>{formatUSDCompact(RULES.minTvl)}</Num>؛ APR کمتر از <Num>{formatNumber(RULES.absurdApr, 0)}</Num>٪؛ بدون شرط دسترسی؛ بدون توکن جعلی یا هم‌نام مشکوک؛ بدون میم‌کوین (جز Robinhood Chain با تأیید Merkl، قیمت تازه، نقدشوندگی DEX دست‌کم <Num>{formatUSDCompact(RULES.memeMinLiquidity)}</Num> و اختلاف قیمت کمتر از <Num>{formatNumber(RULES.memeMaxPriceGap * 100, 0)}</Num>٪). توکن پاداش برای ارزش دلاری باید قیمت تازه، منبع معتبر و نقدشوندگی دست‌کم <Num>{formatUSDCompact(RULES.minRewardLiquidity)}</Num> داشته باشد.
          </p>
          <p>
            حداکثر <Num>{formatNumber(TOP_N, 0)}</Num> بازار نمایش داده می‌شود؛ اگر کمتر واجد شرایط باشد، همان تعداد. پوینت و توکن عرضه‌نشده هرگز به دلار تبدیل نمی‌شوند. نقدشوندگی از DexScreener، قیمت و کمپین‌ها از API رسمی Merkl.
          </p>
        </div>
      </Collapsible>

      <p className="text-xs text-muted leading-6">
        داده‌ها از{' '}
        <a href="https://app.merkl.xyz" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          Merkl
        </a>{' '}
        و DexScreener. APR و پاداش‌ها با TVL، قیمت توکن و تمدید یا توقف کمپین‌ها تغییر می‌کنند. اعداد برآوردی‌اند و توصیه‌ی مالی نیستند.
      </p>
    </main>
  );
}
