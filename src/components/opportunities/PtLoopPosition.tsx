'use client';

import { useEffect, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import thresholds from '../../config/thresholds.json';
import { useLending } from '../../hooks/useLending';
import { maxLoopLeverage, simulateLoop } from '../../lib/calculators/trade';
import { afterAmmFee } from '../../lib/opportunity/pt-price';
import { loopLenders, type PtLoopLender } from '../../lib/risk/leaderboard';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { formatNumber, formatPercent, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import type { CalcState } from './Calculator';

const r2 = (x: number) => Math.round(x * 100) / 100;
const floor1 = (x: number) => Math.floor(x * 10) / 10;
/** The slider stops just short of liquidation on entry; past it nothing is left to show. */
const EDGE_HEALTH = 1.01;
const MAX_SLIDER = 20;
/** Cost of buying the PT, % of the collateral: Pendle's AMM fee goes into the rate (a test trade's impact was ~0), Exponent's book fee; else the assumed cost. */
const LOOP_FEE: Record<string, number> = { pendle: 0, exponent: 0.05 };

/** What a PT market fills the loop with: its rate after the AMM fee and its buying cost. */
export const loopMarketFill = (row: Pick<OpportunityListing, 'protocol' | 'impliedAPY' | 'ammFeeLn'>) => ({
  entryAPY: r2(afterAmmFee(row.impliedAPY, row.ammFeeLn, 'pt')),
  loopFee: LOOP_FEE[row.protocol] ?? thresholds.exit.costPercent,
});

/** Highest leverage the slider offers for this LLTV and borrow cap. */
const topOf = (lltvPct: number, fee: number, cap = Infinity) => {
  const top = Math.min(maxLoopLeverage(lltvPct, EDGE_HEALTH, fee), cap, MAX_SLIDER);
  return Number.isFinite(top) && top > 1 ? floor1(top) : 1;
};

/**
 * The PT loop's position, filled as PendleLoop fills it: picking the PT lists the lending
 * markets that take it (Morpho, Aave, Euler…), the best one at the chosen leverage is taken,
 * and its borrow rate and LLTV go into the fields, which stay editable. Leverage on a slider
 * up to the edge of liquidation, the app's safe limit marked on it.
 */
export function PtLoopPosition({ c, set, row }: { c: CalcState; set: (p: Partial<CalcState>) => void; row: OpportunityListing | null }) {
  const { feed, loading } = useLending();
  const lenders = useMemo(() => (row && feed ? loopLenders(row, feed.opportunities) : []), [row, feed]);
  const minHealth = thresholds.opportunities.loopMinHealth;

  /** Net APY of each lender at the chosen leverage, kept under its safe limit. */
  const ranked = useMemo(
    () =>
      lenders
        .map((l) => {
          const L = Math.max(1, Math.min(c.leverage, maxLoopLeverage(l.lltvPct, minHealth, c.loopFee), l.maxLeverage));
          return { l, net: simulateLoop({ capital: c.capital, daysToMaturity: c.days, entryAPY: c.entryAPY, leverage: L, borrowAPY: l.borrowPct, lltv: l.lltvPct, feePercent: c.loopFee }).netAPY };
        })
        .sort((a, b) => b.net - a.net),
    [lenders, c.leverage, c.capital, c.days, c.entryAPY, c.loopFee, minHealth],
  );
  const selected = lenders.find((l) => l.id === c.loopLender) ?? null;

  // A new PT market: its rate after the AMM fee and its buying cost, once (typed values stay).
  const rowKey = row ? `${row.protocol}:${row.id}` : '';
  useEffect(() => {
    if (!row || c.loopFillFor === rowKey) return;
    set({ loopFillFor: rowKey, ...loopMarketFill(row) });
  }, [row, rowKey, c.loopFillFor, set]);

  const fill = (l: PtLoopLender) => set({ loopLender: l.id, borrowAPY: r2(l.borrowPct), lltv: r2(l.lltvPct), leverage: Math.min(c.leverage, topOf(l.lltvPct, c.loopFee, l.maxLeverage)) });
  // A new PT (or the first answer of the lending feed): its best lending market fills the loop.
  useEffect(() => {
    if (!selected && ranked.length) fill(ranked[0].l);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill only when no lending market is chosen
  }, [selected, ranked]);

  const top = topOf(c.lltv, c.loopFee, selected?.maxLeverage);
  // A lower LLTV or borrow cap: the leverage (and the result beside it) comes down to what the slider allows.
  useEffect(() => {
    if (c.leverage > top) set({ leverage: top });
  }, [c.leverage, top, set]);
  const safe = Math.min(maxLoopLeverage(c.lltv, minHealth, c.loopFee), top);
  const L = Math.min(Math.max(1, c.leverage), top);
  const sim = c.lltv > 0 && c.lltv < 100 ? simulateLoop({ capital: c.capital, daysToMaturity: c.days, entryAPY: c.entryAPY, leverage: L, borrowAPY: c.borrowAPY, lltv: c.lltv, feePercent: c.loopFee }) : null;
  const short = selected && selected.availableUsd !== null && c.capital * (L - 1) > selected.availableUsd;
  const at = (x: number) => `${top > 1 ? ((x - 1) / (top - 1)) * 100 : 0}%`;
  const live = selected && (r2(selected.borrowPct) !== c.borrowAPY || r2(selected.lltvPct) !== c.lltv);

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-secondary">بازار وام</span>
        {!row ? (
          <p className="text-xs text-muted">یک بازار PT انتخاب کنید تا بازارهای وامی که همان PT را وثیقه می‌گیرند بیایند؛ بدون آن نرخ وام و LLTV را دستی وارد کنید.</p>
        ) : loading ? (
          <p className="text-xs text-muted">در حال دریافت بازارهای وام…</p>
        ) : !lenders.length ? (
          <p className="text-xs text-warning">در منابع YieldX بازار وامی که این PT را وثیقه بگیرد پیدا نشد؛ نرخ وام و LLTV را دستی وارد کنید.</p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="بازار وام">
            {ranked.map(({ l, net }) => {
              const on = l.id === c.loopLender;
              return (
                <div key={l.id} className={`rounded-xl border px-3 py-2.5 flex flex-col gap-1.5 ${on ? 'border-accent bg-elevated' : 'border-default'}`}>
                  <button type="button" role="radio" aria-checked={on} onClick={() => fill(l)} className="tap text-right flex flex-col gap-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-primary">
                        <bdi dir="ltr">{l.protocol}</bdi> · وام <bdi dir="ltr">{l.debtSymbol}</bdi>
                      </span>
                      <span className="text-xs text-muted">
                        خالص <Num className="text-st-loop font-semibold">{formatPercent(net, 2)}</Num>
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span>LLTV <Num>{formatPercent(l.lltvRawPct, 1)}</Num></span>
                      <span>بهره‌ی وام <Num>{formatPercent(l.borrowPct, 2)}</Num></span>
                      <span>نقدینگی {l.availableUsd === null ? '—' : <Num>{formatUSDCompact(l.availableUsd)}</Num>}</span>
                    </span>
                  </button>
                  {(l.url || l.pendleLoop) && (
                    <span className="flex flex-wrap gap-3 text-xs">
                      {l.url && (
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                          بازار وام <ExternalLink size={12} aria-hidden />
                        </a>
                      )}
                      {l.pendleLoop && (
                        <a href={l.pendleLoop} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                          همین لوپ در PendleLoop <ExternalLink size={12} aria-hidden />
                        </a>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="سرمایه" value={c.capital} onChange={(v) => set({ capital: v })} suffix="دلار" />
        <NumberField label="روز تا سررسید" value={c.days} onChange={(v) => set({ days: v })} />
        <NumberField
          label="نرخ PT (Implied)"
          value={c.entryAPY}
          onChange={(v) => set({ entryAPY: v })}
          suffix="%"
          note={row?.ammFeeLn ? <>بازار <Num>{formatPercent(row.impliedAPY, 2)}</Num>؛ پس از کارمزد AMM</> : undefined}
        />
        <NumberField
          label="بهره‌ی وام"
          value={c.borrowAPY}
          onChange={(v) => set({ borrowAPY: v })}
          suffix="%"
          note={selected ? <>امروز <Num>{formatPercent(selected.borrowNowPct, 2)}</Num>{selected.borrow7dPct !== null && <> · میانگین ۷ روز <Num>{formatPercent(selected.borrow7dPct, 2)}</Num></>}؛ بیشترِ این دو</> : undefined}
        />
        <NumberField
          label="LLTV"
          value={c.lltv}
          onChange={(v) => set({ lltv: v })}
          suffix="%"
          note={selected && selected.lltvPct < selected.lltvRawPct - 1e-9 ? <>LLTV بازار <Num>{formatPercent(selected.lltvRawPct, 1)}</Num>؛ روی قیمت اوراکل که پایین‌تر از بازار است</> : undefined}
        />
        <NumberField
          label="کارمزد خرید PT"
          value={c.loopFee}
          onChange={(v) => set({ loopFee: v })}
          suffix="%"
          note={row?.protocol === 'pendle' ? 'از کل وثیقه؛ کارمزد پندل در نرخ PT است و اثر قیمت در این حجم ناچیز' : 'از کل وثیقه'}
        />
      </div>
      {live && (
        <button type="button" onClick={() => fill(selected)} className="tap self-start text-xs text-accent hover:underline">
          برگرداندن نرخ و LLTV بازار وام
        </button>
      )}

      <div className="flex flex-col gap-2 border-t border-default pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-secondary">اهرم</span>
          <span className={`text-lg font-semibold ${L > safe ? 'text-warning' : 'text-primary'}`}>
            <Num>{`${formatNumber(L, 1)}×`}</Num>
          </span>
        </div>
        <div className="relative">
          <input type="range" min={1} max={top} step={0.1} value={L} onChange={(e) => set({ leverage: Number(e.target.value) })} aria-label="اهرم" className="w-full" />
          {safe > 1 && safe < top && <span className="absolute -bottom-1 h-2 w-0.5 rounded bg-warning" style={{ insetInlineStart: at(safe) }} aria-hidden />}
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span><Num>1×</Num></span>
          {safe > 1 && safe < top && <span className="text-warning">حد امن <Num>{`${formatNumber(floor1(safe), 1)}×`}</Num></span>}
          <span>بیشینه <Num>{`${formatNumber(top, 1)}×`}</Num></span>
        </div>
        {sim && (
          <p className="text-xs text-muted">
            Health Factor <Num className={sim.healthFactor < minHealth ? 'text-danger' : 'text-primary'}>{Number.isFinite(sim.healthFactor) ? formatNumber(sim.healthFactor, 2) : '∞'}</Num> · LTV <Num>{formatPercent(sim.ltv, 1)}</Num> · فاصله تا LLTV <Num>{formatPercent(c.lltv - sim.ltv, 2)}</Num>
          </p>
        )}
        {short && <p className="text-xs text-warning">این بازار فقط <Num>{formatUSDCompact(selected!.availableUsd!)}</Num> برای وام دارد؛ این اهرم <Num>{formatUSDCompact(c.capital * (L - 1))}</Num> وام می‌خواهد.</p>}
      </div>
    </>
  );
}
