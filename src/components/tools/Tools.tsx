'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calculator, Droplets, Gift, HandCoins, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import protocols from '../../config/protocols.json';
import type { ProtocolId } from '../../types/protocol';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { fetchMarket } from '../../lib/data/market-data';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { defaultScreenSettings, type OpportunityListing, type ScreenSettings } from '../../lib/risk/opportunities';
import { Collapsible } from '../ui/card';
import { NumberField } from '../ui/field';
import { DataStatus } from '../ui/data-status';
import { Segmented } from '../opportunities/parts';
import { YtBoard } from '../opportunities/YtBoard';
import { CalculatorPanel, defaultCalc, type CalcMode, type CalcState } from '../opportunities/Calculator';
import { applyFilters, defaultFilters, FilterBar, type Filters } from '../opportunities/filters';
import { LpAnalyzer, readLpPrefill, type LpPrefill } from '../opportunities/LpAnalyzer';
import { BorrowTool } from './BorrowTool';

type Tab = 'yt' | 'calc' | 'lp' | 'borrow';
const TABS: Tab[] = ['yt', 'calc', 'lp', 'borrow'];

interface Stored {
  tab: Tab;
  screen: ScreenSettings;
  calc: CalcState;
  filters: Filters;
  ytPointsOnly: boolean;
}

const initial: Stored = { tab: 'yt', screen: defaultScreenSettings, calc: defaultCalc, filters: defaultFilters, ytPointsOnly: true };

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

/**
 * «ابزارهای تخصصی» of the market analysis: what has no dollar estimate in the ranking
 * (YT, LP) or answers another question (a trade calculator, the cost of a loan).
 */
export default function Tools() {
  const { markets, loading, failed, stale, feeds, updatedAt, refresh } = useAllMarkets();
  const [st, setSt] = useState<Stored | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [lpPrefill, setLpPrefill] = useState<LpPrefill>({});

  // Client-only restore (localStorage), merged over defaults so new fields are always present.
  useEffect(() => {
    const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.opportunities, {});
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('tab');
    if (linked === 'lp') setLpPrefill(readLpPrefill(params));
    setSt({
      tab: TABS.includes(linked as Tab) ? (linked as Tab) : TABS.includes(saved.tab as Tab) ? (saved.tab as Tab) : initial.tab,
      screen: sane(saved.screen, initial.screen),
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/" className="tap inline-flex items-center gap-1 text-sm text-secondary hover:text-primary self-start">
            <ArrowRight size={14} aria-hidden /> تحلیل بازار
          </Link>
          <h1 className="page-title">ابزارهای تخصصی</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {loading ? (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden /> در حال دریافت بازارها…
              </p>
            ) : (
              ids.map((id) =>
                failed.includes(id) ? (
                  <p key={id} className="text-xs text-danger flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-danger" aria-hidden /> <bdi dir="ltr">{protocols[id].name}</bdi>: دریافت نشد
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

      <div className="sticky below-header z-20 -mx-[var(--space-page-x)] px-[var(--space-page-x)] py-2 bg-canvas/95 backdrop-blur">
        <Segmented
          value={tab}
          onChange={(t) => patch({ tab: t })}
          label="ابزار"
          options={[
            { id: 'yt', label: <><Gift size={15} aria-hidden /> YT</> },
            { id: 'calc', label: <><Calculator size={15} aria-hidden /> ماشین‌حساب</> },
            { id: 'lp', label: <><Droplets size={15} aria-hidden /> LP</> },
            { id: 'borrow', label: <><HandCoins size={15} aria-hidden /> هزینه‌ی وام</> },
          ]}
        />
      </div>

      {tab === 'lp' && <LpAnalyzer key={JSON.stringify(lpPrefill)} prefill={lpPrefill} />}
      {tab === 'borrow' && <BorrowTool />}

      {tab === 'yt' && (
        <>
          <FilterBar markets={markets.filter((m) => !m.expired)} f={st.filters} setF={(filters) => patch({ filters })} minLiquidity={s.minLiquidity} setMinLiquidity={(minLiquidity) => setS({ minLiquidity })} shown={filtered.filter((m) => !m.expired).length} total={active} />
          <Collapsible title="فرض‌های محاسبه" icon={<SlidersHorizontal size={18} aria-hidden />}>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {s.ytMode === 'roundtrip' && <NumberField label="روز نگه‌داری" value={s.holdDays} onChange={(v) => Number.isFinite(v) && setS({ holdDays: Math.max(1, v) })} />}
              <NumberField label="سقف ضرر" value={s.lossBudget} onChange={(v) => setS({ lossBudget: v })} suffix="%" />
              <NumberField label="کارمزد هر معامله" value={s.feePercent} onChange={(v) => setS({ feePercent: v })} suffix="%" help="کارمزد و لغزش قیمت هر خرید یا فروش، به درصد." />
              <NumberField label="حداقل روز تا سررسید" value={s.minDays} onChange={(v) => setS({ minDays: v })} />
            </div>
          </Collapsible>
          {loading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-16 rounded-lg bg-surface border border-default animate-pulse" />
              ))}
            </div>
          ) : (
            <YtBoard markets={filtered} s={s} feeds={feeds} pointsOnly={st.ytPointsOnly} onCalc={(m) => pick(m, 'yt')} />
          )}
        </>
      )}
      {tab === 'calc' && <CalculatorPanel screen={st.screen} c={st.calc} set={setCalc} markets={markets} onPick={(m) => pick(m)} loadingMarket={loadingMarket} />}
      {updatedAt === null && !loading && tab !== 'lp' && tab !== 'borrow' && <p className="text-xs text-warning">داده‌ی زنده‌ای دریافت نشد.</p>}
    </main>
  );
}

const round = (x: number) => Math.round(x * 100) / 100;
