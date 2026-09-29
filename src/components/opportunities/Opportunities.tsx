'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Coins, Gift, Loader2, RefreshCw, Repeat, SlidersHorizontal, Trophy } from 'lucide-react';
import protocols from '../../config/protocols.json';
import type { ProtocolId } from '../../types/protocol';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { fetchMarket } from '../../lib/data/market-data';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { defaultLoopSettings, defaultScreenSettings, type LoopSettings, type OpportunityListing, type ScreenSettings } from '../../lib/risk/opportunities';
import { formatNumber } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { NumberField } from '../ui/field';
import { DataStatus } from '../ui/data-status';
import { Num } from '../ui/num';
import { Segmented } from './parts';
import { YtBoard } from './YtBoard';
import { PtBoard } from './PtBoard';
import { LoopBoard } from './LoopBoard';
import { LeaderBoard, defaultRankSettings, type RankSettings } from './LeaderBoard';
import { CalculatorPanel, defaultCalc, type CalcMode, type CalcState } from './Calculator';
import { applyFilters, defaultFilters, FilterBar, type Filters } from './filters';

type Tab = 'rank' | 'yt' | 'pt' | 'loop' | 'calc';
const TABS: Tab[] = ['rank', 'yt', 'pt', 'loop', 'calc'];

interface Stored {
  tab: Tab;
  screen: ScreenSettings;
  loop: LoopSettings;
  rank: RankSettings;
  calc: CalcState;
  filters: Filters;
  ytPointsOnly: boolean;
}

const initial: Stored = { tab: 'rank', screen: defaultScreenSettings, loop: defaultLoopSettings, rank: defaultRankSettings, calc: defaultCalc, filters: defaultFilters, ytPointsOnly: true };

/** Settings from storage or typing may hold NaN/null — fall back per field so the boards never silently empty. */
function sane<T extends object>(value: Partial<T> | undefined, fallback: T): T {
  const out = { ...fallback } as Record<string, unknown>;
  for (const [k, v] of Object.entries(value ?? {})) {
    const d = (fallback as Record<string, unknown>)[k];
    if (typeof d === 'number') out[k] = typeof v === 'number' && Number.isFinite(v) ? v : d;
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

/** Where to look: YT (points), fixed-rate PT and PT loops across protocols, plus a trade calculator. */
export default function Opportunities() {
  const { markets, loading, failed, stale, feeds, updatedAt, refresh } = useAllMarkets();
  const [st, setSt] = useState<Stored | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);

  // Client-only restore (localStorage), merged over defaults so new fields are always present.
  useEffect(() => {
    const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.opportunities, {});
    const linked = new URLSearchParams(window.location.search).get('tab');
    setSt({
      tab: TABS.includes(linked as Tab) ? (linked as Tab) : (saved.tab ?? initial.tab),
      screen: sane(saved.screen, initial.screen),
      loop: sane(saved.loop, initial.loop),
      rank: sane(saved.rank, initial.rank),
      calc: sane(saved.calc, initial.calc),
      filters: { ...defaultFilters, ...saved.filters },
      ytPointsOnly: saved.ytPointsOnly ?? true,
    });
  }, []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.opportunities, st);
  }, [st]);

  const patch = useCallback((p: Partial<Stored>) => setSt((s) => (s ? { ...s, ...p } : s)), []);
  const setCalc = useCallback((p: Partial<CalcState>) => setSt((s) => (s ? { ...s, calc: { ...s.calc, ...p } } : s)), []);

  /** Fill the calculator from a list row, then refine with the market's full data (USD price, points program). */
  const pick = useCallback(async (m: OpportunityListing, mode?: CalcMode, extra: Partial<CalcState> = {}) => {
    setSt((s) =>
      s
        ? {
            ...s,
            tab: 'calc',
            calc: {
              ...s.calc,
              ...(mode ? { mode } : {}),
              protocol: m.protocol,
              marketId: m.id,
              marketName: m.name,
              icon: m.icon,
              days: m.daysToMaturity,
              entryAPY: round(m.impliedAPY),
              exitAPY: round(m.impliedAPY),
              // Unknown base APY → 0 (the calculator warns), never the previous market's value.
              baseAPY: m.baseAPY === null || !Number.isFinite(m.baseAPY) ? 0 : round(m.baseAPY),
              holdDays: Math.min(s.calc.holdDays, m.daysToMaturity),
              // Points program: this market's, or none — never carried from the previous market.
              ...(m.points ? { pointsPerDay: m.points.pointsPerDay, pointsBasis: m.points.basis, ytMultiplier: m.points.ytMultiplier } : { pointsPerDay: 0, ytMultiplier: 1 }),
              ...extra,
            },
          }
        : s,
    );
    window.scrollTo({ top: 0 });
    setLoadingMarket(true);
    try {
      const { market } = await fetchMarket(m.protocol, m.id);
      setSt((s) =>
        s && s.calc.marketId === m.id && s.calc.protocol === m.protocol
          ? {
              ...s,
              calc: {
                ...s.calc,
                underlyingPrice: market.underlyingPrice ?? s.calc.underlyingPrice,
                ...(market.points ? { pointsPerDay: market.points.pointsPerDay, pointsBasis: market.points.basis, ytMultiplier: market.points.ytMultiplier } : {}),
              },
            }
          : s,
      );
    } catch {
      /* list values are enough to calculate */
    } finally {
      setLoadingMarket(false);
    }
  }, []);

  const filtered = useMemo(() => (st ? applyFilters(markets, st.filters) : []), [markets, st]);

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }

  const { tab, screen: s } = st;
  const setS = (p: Partial<ScreenSettings>) => patch({ screen: sane({ ...s, ...p }, s) });
  const active = markets.filter((m) => !m.expired).length;
  const ids = (Object.keys(protocols) as ProtocolId[]).filter((id) => protocols[id].liveData);

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">فرصت‌ها</h1>
          <p className="text-sm text-secondary">کجا را بررسی کنم؟ بازارهای PT، YT و لوپ همه‌ی پروتکل‌ها، زنده و قابل مقایسه.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {loading ? (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> در حال دریافت بازارها…
              </p>
            ) : (
              ids.map((id) =>
                failed.includes(id) ? (
                  <p key={id} className="text-xs text-danger flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-danger" aria-hidden /> <bdi dir="ltr">{protocols[id].name}</bdi>: دریافت نشد — بقیه‌ی پروتکل‌ها نمایش داده می‌شوند
                  </p>
                ) : (
                  <DataStatus key={id} source="api" fetchedAt={feeds[id]?.at ?? null} stale={stale.includes(id)} label={<bdi dir="ltr">{protocols[id].name}</bdi>} />
                ),
              )
            )}
          </div>
        </div>
        <button type="button" onClick={refresh} className="tap inline-flex items-center gap-1.5 rounded-lg px-3 min-h-10 text-sm text-secondary hover:text-primary hover:bg-elevated">
          <RefreshCw size={14} aria-hidden /> به‌روزرسانی
        </button>
      </header>

      <div className="sticky top-14 z-20 -mx-[var(--space-page-x)] px-[var(--space-page-x)] py-2 bg-canvas/95 backdrop-blur">
        <Segmented
          value={tab}
          onChange={(t) => patch({ tab: t })}
          label="بخش"
          options={[
            { id: 'rank', label: <><Trophy size={15} aria-hidden /> رتبه‌بندی</> },
            { id: 'yt', label: <><Gift size={15} aria-hidden /> YT</> },
            { id: 'pt', label: <><Coins size={15} aria-hidden /> PT</> },
            { id: 'loop', label: <><Repeat size={15} aria-hidden /> Loop</> },
            { id: 'calc', label: <><Calculator size={15} aria-hidden /> ماشین‌حساب</> },
          ]}
        />
      </div>

      {tab !== 'calc' && (
        <>
          <FilterBar markets={markets.filter((m) => !m.expired)} f={st.filters} setF={(filters) => patch({ filters })} minLiquidity={s.minLiquidity} setMinLiquidity={(minLiquidity) => setS({ minLiquidity })} shown={filtered.filter((m) => !m.expired).length} total={active} />
          <Collapsible title="فرض‌های محاسبه" icon={<SlidersHorizontal size={18} aria-hidden />}>
            {tab === 'yt' && (
              <>
                <Segmented
                  value={s.ytMode}
                  onChange={(ytMode) => setS({ ytMode })}
                  label="افق YT"
                  size="sm"
                  options={[
                    { id: 'roundtrip', label: 'خرید و فروش بعد از چند روز' },
                    { id: 'maturity', label: 'نگه‌داری تا سررسید' },
                  ]}
                />
                <label className="flex items-center gap-2 text-sm text-secondary min-h-11">
                  <input type="checkbox" checked={st.ytPointsOnly} onChange={(e) => patch({ ytPointsOnly: e.target.checked })} />
                  فقط بازارهای پوینت‌دار
                </label>
              </>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {tab === 'yt' && s.ytMode === 'roundtrip' && <NumberField label="روز نگه‌داری" value={s.holdDays} onChange={(v) => Number.isFinite(v) && setS({ holdDays: Math.max(1, v) })} />}
              {(tab === 'yt' || (tab === 'rank' && st.rank.strategy === 'yt')) && <NumberField label="سقف ضرر" value={s.lossBudget} onChange={(v) => setS({ lossBudget: v })} suffix="%" />}
              <NumberField label="کارمزد هر معامله" value={s.feePercent} onChange={(v) => setS({ feePercent: v })} suffix="%" help="کارمزد و لغزش قیمت هر خرید یا فروش، به درصد." />
              <NumberField label="حداقل روز تا سررسید" value={s.minDays} onChange={(v) => setS({ minDays: v })} />
            </div>
          </Collapsible>
        </>
      )}

      {loading && tab !== 'calc' ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {tab === 'rank' && (
            <LeaderBoard
              markets={filtered}
              s={s}
              r={st.rank}
              setR={(p) => patch({ rank: { ...st.rank, ...p } })}
              loop={st.loop}
              setLoop={(loop) => patch({ loop })}
              onCalc={(row, strategy) =>
                pick(row.m, strategy, {
                  capital: st.rank.capital,
                  ...(strategy === 'yt' ? { holdDays: row.days } : { holdDays: row.m.daysToMaturity }),
                  ...(strategy === 'loop' ? { leverage: st.loop.leverage, borrowAPY: st.loop.borrowAPY, lltv: st.loop.lltv } : {}),
                })
              }
            />
          )}
          {tab === 'yt' && <YtBoard markets={filtered} s={s} feeds={feeds} pointsOnly={st.ytPointsOnly} onCalc={(m) => pick(m, 'yt')} />}
          {tab === 'pt' && <PtBoard markets={filtered} s={s} feeds={feeds} onCalc={(m) => pick(m, 'pt')} />}
          {tab === 'loop' && (
            <LoopBoard
              markets={filtered}
              s={s}
              l={st.loop}
              setL={(loop) => patch({ loop })}
              feeds={feeds}
              onCalc={(m) => {
                setCalc({ leverage: st.loop.leverage, borrowAPY: st.loop.borrowAPY, lltv: st.loop.lltv });
                pick(m, 'loop');
              }}
            />
          )}
          {tab === 'calc' && <CalculatorPanel screen={st.screen} c={st.calc} set={setCalc} markets={markets} onPick={(m) => pick(m)} loadingMarket={loadingMarket} />}
        </>
      )}
      {!loading && tab !== 'calc' && failed.length === 0 && markets.length === 0 && <p className="text-sm text-secondary">هیچ بازاری دریافت نشد.</p>}
      <p className="text-xs text-muted">
        <Num>{formatNumber(active, 0)}</Num> بازار فعال. اعداد تخمینی‌اند و توصیه‌ی مالی نیستند؛ نرخ بالا به‌تنهایی نشانه‌ی فرصت خوب نیست.
      </p>
      {updatedAt === null && !loading && <p className="text-xs text-warning">داده‌ی زنده‌ای دریافت نشد.</p>}
    </main>
  );
}

const round = (x: number) => Math.round(x * 100) / 100;
