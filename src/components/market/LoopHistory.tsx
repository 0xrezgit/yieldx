'use client';

import { useMemo } from 'react';
import { History } from 'lucide-react';
import { useLoopHistory } from '../../hooks/useLoopHistory';
import { evmChainId } from '../../lib/opportunity/costs';
import type { Opportunity } from '../../types/opportunity';
import { backtestLoop, historyLevels, MIN_ENTRIES, summarize, type LoopBacktest, type LoopPoint } from '../../lib/pendleloop/backtest';
import { formatDate, formatNumber, formatPercent } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

/** The box id inside a PendleLoop link (…/trade/loop/<box>/deposit?chain=…). */
export const boxIdOf = (url: string | null | undefined) => url?.match(/\/trade\/loop\/(0x[0-9a-fA-F]{64})/)?.[1]?.toLowerCase() ?? null;

const dateOf = (t: number) => formatDate(new Date(t * 1000).toISOString());
const x = (L: number) => `${formatNumber(L, 1)}×`;
const toneOf = (r: LoopBacktest) => (r.liquidated > 0 ? 'text-danger' : r.entries === 0 || r.minBufferPct < 5 ? 'text-warning' : 'text-success');

export interface LoopHistoryProps {
  chainId: number;
  /** The collateral (PT) address. */
  collateral: string;
  boxId: string;
  /** The money market's LLTV as a fraction (the oracle price is in the history). */
  lltv: number;
  /** The leverage in use (dollar leverage). */
  leverage: number;
  /** Highest leverage worth showing (the calculator's slider end); default near the LLTV's edge. */
  top?: number;
  variant?: 'table' | 'line';
}

function useBacktests(p: LoopHistoryProps) {
  const { feed, loading, failed } = useLoopHistory(p.chainId, p.collateral);
  const series = feed?.series.find((s) => s.boxId.toLowerCase() === p.boxId);
  return useMemo(() => {
    if (!series) return { loading, failed, found: !!feed, summary: null, rows: [] as LoopBacktest[], chosen: null as LoopBacktest | null };
    const points: LoopPoint[] = series.rows.map(([t, borrowPct, oracle, market, fixedPct, liquidityUsd]) => ({ t, borrowPct, oracle, market, fixedPct, liquidityUsd }));
    const summary = summarize(points);
    const top = p.top ?? Math.floor((1 / (1 - p.lltv * 0.99)) * 10) / 10;
    const rows = historyLevels(top, p.leverage)
      .map((L) => backtestLoop(points, L, p.lltv))
      .filter((r): r is LoopBacktest => r !== null);
    const chosen = rows.find((r) => Math.abs(r.leverage - Math.round(p.leverage * 10) / 10) < 1e-9) ?? null;
    return { loading, failed, found: true, summary, rows, chosen };
  }, [series, feed, loading, failed, p.top, p.lltv, p.leverage]);
}

/** One leverage's result in words: «در ۳ از ۱۲۰ ورود (۲.۵٪) لیکوئید می‌شد», «هیچ‌کدام…؛ کمترین فاصله ۸٪» or «باز نمی‌شد». */
function Verdict({ r }: { r: LoopBacktest }) {
  if (r.entries === 0)
    return (
      <>
        با <Num>{x(r.leverage)}</Num> این لوپ اصلاً باز نمی‌شد: با قیمتی که اوراکل این بازار می‌خواند، فاصله تا لیکوئید از همان ابتدا زیر حداقل <Num>۳٪</Num> PendleLoop بود
      </>
    );
  const closed = r.unopenable > 0 && (
    <>
      {' '}
      (در <Num>{formatNumber(r.unopenable, 0)}</Num> ساعت دیگر اصلاً باز نمی‌شد)
    </>
  );
  return r.liquidated > 0 ? (
    <>
      با <Num>{x(r.leverage)}</Num> در <Num className="font-semibold">{formatNumber(r.liquidated, 0)}</Num> از <Num>{formatNumber(r.entries, 0)}</Num> ورود (<Num className="font-semibold">{formatPercent(r.sharePct, 1)}</Num>) لیکوئید می‌شد{closed}
    </>
  ) : (
    <>
      با <Num>{x(r.leverage)}</Num> هیچ ورودی لیکوئید نمی‌شد؛ کمترین فاصله تا لیکوئید <Num className="font-semibold">{formatPercent(r.minBufferPct, 1)}</Num>{closed}
    </>
  );
}

/**
 * «If you had entered this loop before»: every past hour of this PendleLoop box (Pendle keeps
 * ~92 days) replayed as an entry at each leverage and held to today or maturity, on the price
 * the money market's oracle actually read and the borrow rate it actually charged. A table in
 * the calculator; one line beside a loop elsewhere (the leverage in use, and 4× and 6× above it).
 */
export function LoopHistory(p: LoopHistoryProps) {
  const { loading, failed, found, summary, rows, chosen } = useBacktests(p);
  const line = p.variant === 'line';
  if (loading) return <p className="text-xs text-muted">در حال خواندن سابقه‌ی این لوپ…</p>;
  if (failed || !found) return line ? null : <p className="text-xs text-muted">سابقه‌ی این لوپ از Pendle دریافت نشد.</p>;
  if (!summary || !summary.enough || !rows.length || rows[0].candidates < MIN_ENTRIES)
    return (
      <p className="text-xs text-muted">
        سابقه‌ی این لوپ کوتاه است{summary && summary.days > 0 && <> (<Num>{formatNumber(summary.days, 0)}</Num> روز)</>}؛ درباره‌ی لیکوئید در گذشته چیزی نمی‌شود گفت.
      </p>
    );
  const days = formatNumber(summary.days, 0);

  if (line) {
    const shown = rows.filter((r) => r === chosen || (r.leverage > p.leverage && (r.leverage === 4 || r.leverage === 6)));
    if (!shown.length) return null;
    return (
      <p className="flex items-start gap-1.5 text-xs leading-5 text-secondary">
        <History size={13} className="shrink-0 mt-0.5 text-muted" aria-hidden />
        <span>
          در <Num>{days}</Num> روز گذشته، ورود در هر ساعت و نگه‌داشتن تا امروز:{' '}
          {shown.map((r, i) => (
            <span key={r.leverage} className={toneOf(r)}>
              {i > 0 && '؛ '}
              <Verdict r={r} />
            </span>
          ))}
          .
        </span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-primary flex items-center gap-1.5">
        <History size={15} aria-hidden /> اگر قبلاً وارد این لوپ می‌شدید
      </h3>
      <p className="text-xs text-muted leading-5">
        هر ساعت از <Num>{days}</Num> روز گذشته (از <Num>{dateOf(summary.from)}</Num>) یک ورود فرضی، نگه‌داشته تا امروز یا سررسید؛ با قیمتی که اوراکل همین بازار وام خوانده و بهره‌ای که
        واقعاً گرفته. بیشترین بهره‌ی وام <Num>{formatPercent(summary.maxBorrowPct, 1)}</Num>، بیشترین افت قیمت اوراکل <Num>{formatPercent(summary.maxOracleDropPct, 2)}</Num>.
      </p>
      {chosen && (
        <p className={`text-sm leading-6 ${toneOf(chosen)}`}>
          <Verdict r={chosen} />
          {chosen.liquidated > 0 ? <> — بدترین لحظه <Num>{dateOf(chosen.worstAt)}</Num>.</> : '.'}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-muted text-right">
              <th className="font-medium py-1.5">اهرم</th>
              <th className="font-medium py-1.5">لیکوئید در گذشته</th>
              <th className="font-medium py-1.5">کمترین فاصله تا لیکوئید</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leverage} className={`border-t border-default ${r === chosen ? 'bg-elevated font-semibold' : ''}`}>
                <td className="py-1.5"><Num>{x(r.leverage)}</Num></td>
                <td className={`py-1.5 ${toneOf(r)}`}>{r.entries === 0 ? 'باز نمی‌شود' : r.liquidated > 0 ? <><Num>{formatPercent(r.sharePct, 1)}</Num> ورودها</> : 'هیچ'}</td>
                <td className="py-1.5">{!(r.minHealth >= 1) ? '—' : <Num>{formatPercent(r.minBufferPct, 1)}</Num>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted leading-5">
        گذشته‌ی کوتاه، آینده را تضمین نمی‌کند. کارمزد ورود و جهش‌های کوتاه‌تر از یک ساعت در این بازپخش نیست. اهرم دلاری است؛ عددی که PendleLoop نشان می‌دهد به تعداد توکن است و کمی بزرگ‌تر.
      </p>
    </div>
  );
}

/** The one-line history beside any loop that PendleLoop also lists (none for the others). */
export function LoopHistoryFor({ o, leverage }: { o: Pick<Opportunity, 'chain' | 'loop'>; leverage: number | null | undefined }) {
  const box = boxIdOf(o.loop?.pendleLoop);
  const chainId = evmChainId(o.chain);
  const collateral = o.loop?.collateral.token.address;
  if (!box || !chainId || !collateral || !o.loop || !(leverage && leverage > 1)) return null;
  return <LoopHistory chainId={chainId} collateral={collateral.toLowerCase()} boxId={box} lltv={o.loop.maxLtv} leverage={leverage} variant="line" />;
}
