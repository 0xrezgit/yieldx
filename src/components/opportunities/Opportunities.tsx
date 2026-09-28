'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calculator, Coins, Gift, Loader2, RefreshCw, Repeat, SlidersHorizontal, Trophy } from 'lucide-react';
import protocols from '../../config/protocols.json';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { fetchMarket } from '../../lib/data/market-data';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { defaultLoopSettings, defaultScreenSettings, type LoopSettings, type OpportunityListing, type ScreenSettings } from '../../lib/risk/opportunities';
import { formatNumber } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Segmented } from './parts';
import { YtBoard } from './YtBoard';
import { PtBoard } from './PtBoard';
import { LoopBoard } from './LoopBoard';
import { LeaderBoard, defaultRankSettings, type RankSettings } from './LeaderBoard';
import { CalculatorPanel, defaultCalc, type CalcMode, type CalcState } from './Calculator';

type Tab = 'rank' | 'yt' | 'pt' | 'loop' | 'calc';
const TABS: Tab[] = ['rank', 'yt', 'pt', 'loop', 'calc'];

interface Stored {
  tab: Tab;
  screen: ScreenSettings;
  loop: LoopSettings;
  rank: RankSettings;
  calc: CalcState;
}

const initial: Stored = { tab: 'rank', screen: defaultScreenSettings, loop: defaultLoopSettings, rank: defaultRankSettings, calc: defaultCalc };

/** Best markets for YT (points), fixed-rate PT and PT loops, plus a trade calculator. */
export default function Opportunities() {
  const { markets, loading, failed, updatedAt } = useAllMarkets();
  const [st, setSt] = useState<Stored | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);

  // Client-only restore (localStorage), merged over defaults so new fields are always present.
  useEffect(() => {
    const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.opportunities, {});
    const linked = new URLSearchParams(window.location.search).get('tab');
    setSt({
      tab: TABS.includes(linked as Tab) ? (linked as Tab) : (saved.tab ?? initial.tab),
      screen: { ...initial.screen, ...saved.screen },
      loop: { ...initial.loop, ...saved.loop },
      rank: { ...initial.rank, ...saved.rank },
      calc: { ...initial.calc, ...saved.calc },
    });
  }, []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.opportunities, st);
  }, [st]);

  const patch = useCallback((p: Partial<Stored>) => setSt((s) => (s ? { ...s, ...p } : s)), []);
  const setCalc = useCallback((p: Partial<CalcState>) => setSt((s) => (s ? { ...s, calc: { ...s.calc, ...p } } : s)), []);

  /** Fill the calculator from a list row, then refine with the market's full data (USD price, points program). */
  const pick = useCallback(
    async (m: OpportunityListing, mode?: CalcMode, extra: Partial<CalcState> = {}) => {
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
                baseAPY: m.baseAPY === null ? s.calc.baseAPY : round(m.baseAPY),
                holdDays: Math.min(s.calc.holdDays, m.daysToMaturity),
                ...(m.points
                  ? { pointsPerDay: m.points.pointsPerDay, pointsBasis: m.points.basis, ytMultiplier: m.points.ytMultiplier }
                  : {}),
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
          s && s.calc.marketId === m.id
            ? {
                ...s,
                calc: {
                  ...s.calc,
                  underlyingPrice: market.underlyingPrice ?? s.calc.underlyingPrice,
                  ...(market.points
                    ? { pointsPerDay: market.points.pointsPerDay, pointsBasis: market.points.basis, ytMultiplier: market.points.ytMultiplier }
                    : {}),
                },
              }
            : s,
        );
      } catch {
        /* list values are enough to calculate */
      } finally {
        setLoadingMarket(false);
      }
    },
    [],
  );

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary">
        <Loader2 className="animate-spin" />
      </main>
    );
  }

  const { tab, screen: s } = st;
  const setS = (p: Partial<ScreenSettings>) => patch({ screen: { ...s, ...p } });
  const active = markets.filter((m) => !m.expired).length;

  return (
    <main className="max-w-matrix mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-primary">فرصت‌ها</h1>
        <p className="text-sm text-secondary">بهترین بازارها برای YT و پوینت، PT با نرخ ثابت و لوپ PT — از همه‌ی پروتکل‌ها، زنده.</p>
        <p className="text-xs text-muted flex items-center gap-1.5">
          {loading ? (
            <>
              <Loader2 size={12} className="animate-spin" /> در حال دریافت بازارها…
            </>
          ) : (
            <>
              <RefreshCw size={12} /> <Num>{formatNumber(active, 0)}</Num> بازار فعال
              {updatedAt && (
                <>
                  {' '}
                  · <Num>{new Date(updatedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</Num>
                </>
              )}
              {failed.length > 0 && <span className="text-warning"> · {failed.map((f) => protocols[f].name).join('، ')} در دسترس نیست</span>}
            </>
          )}
        </p>
      </header>

      <div className="sticky top-14 lg:top-16 z-10 -mx-4 px-4 lg:mx-0 lg:px-0 py-2 bg-base/85 backdrop-blur-lg">
        <Segmented
          value={tab}
          onChange={(t) => patch({ tab: t })}
          label="بخش"
          options={[
            { id: 'rank', label: <><Trophy size={15} /> رتبه‌بندی</> },
            { id: 'yt', label: <><Gift size={15} /> YT</> },
            { id: 'pt', label: <><Coins size={15} /> PT</> },
            { id: 'loop', label: <><Repeat size={15} /> لوپ</> },
            { id: 'calc', label: <><Calculator size={15} /> ماشین‌حساب</> },
          ]}
        />
      </div>

      {tab !== 'calc' && (
        <Collapsible title="فرض‌ها" icon={<SlidersHorizontal size={18} />}>
          {tab === 'yt' && (
            <Segmented
              value={s.ytMode}
              onChange={(ytMode) => setS({ ytMode })}
              label="استراتژی YT"
              size="sm"
              options={[
                { id: 'roundtrip', label: 'خرید و فروش بعد از چند روز' },
                { id: 'maturity', label: 'نگه‌داری تا سررسید' },
              ]}
            />
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {tab === 'yt' && s.ytMode === 'roundtrip' && (
              <NumberField label="روز نگه‌داری" value={s.holdDays} onChange={(v) => setS({ holdDays: Math.max(1, v) })} />
            )}
            {(tab === 'yt' || (tab === 'rank' && st.rank.strategy === 'yt')) && <NumberField label="سقف ضرر" value={s.lossBudget} onChange={(v) => setS({ lossBudget: v })} suffix="%" />}
            <NumberField label="کارمزد هر معامله" value={s.feePercent} onChange={(v) => setS({ feePercent: v })} suffix="%" />
            <NumberField label="حداقل نقدینگی" value={s.minLiquidity} onChange={(v) => setS({ minLiquidity: v })} suffix="$" />
            <NumberField label="حداقل روز تا سررسید" value={s.minDays} onChange={(v) => setS({ minDays: v })} />
          </div>
        </Collapsible>
      )}

      {loading && !markets.length && tab !== 'calc' ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-surface/60 border border-default animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {tab === 'rank' && (
            <LeaderBoard
              markets={markets}
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
          {tab === 'yt' && <YtBoard markets={markets} s={s} onCalc={(m) => pick(m, 'yt')} />}
          {tab === 'pt' && <PtBoard markets={markets} s={s} onCalc={(m) => pick(m, 'pt')} />}
          {tab === 'loop' && <LoopBoard markets={markets} s={s} l={st.loop} setL={(loop) => patch({ loop })} onCalc={(m) => {
            setCalc({ leverage: st.loop.leverage, borrowAPY: st.loop.borrowAPY, lltv: st.loop.lltv });
            pick(m, 'loop');
          }} />}
          {tab === 'calc' && <CalculatorPanel c={st.calc} set={setCalc} markets={markets} onPick={(m) => pick(m)} loadingMarket={loadingMarket} />}
        </>
      )}
    </main>
  );
}

const round = (x: number) => Math.round(x * 100) / 100;
