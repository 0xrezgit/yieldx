'use client';

import { useMemo, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import {
  buckets,
  leaderLoop,
  leaderPt,
  leaderYt,
  type LeaderRow,
  type LeaderStrategy,
  type RankBy,
  type Verdict,
} from '../../lib/risk/leaderboard';
import type { LoopSettings, OpportunityListing, ScreenSettings } from '../../lib/risk/opportunities';
import { formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import protocols from '../../config/protocols.json';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { Pill, Segmented, signedPct } from './parts';
import type { Tone } from '../ui/badge';

export interface RankSettings {
  capital: number;
  strategy: LeaderStrategy;
  by: RankBy;
  /** Minimum annualised return for a PT / loop to count as worth it, %. */
  hurdle: number;
  pointsOnly: boolean;
}

export const defaultRankSettings: RankSettings = { capital: 1000, strategy: 'pt', by: 'total', hurdle: 8, pointsOnly: true };

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  // Only a comparison with the user's hurdle — not an overall endorsement.
  worth: { label: 'بالای حداقل بازده', tone: 'success' },
  thin: { label: 'زیر حداقل بازده', tone: 'warning' },
  loss: { label: 'زیان', tone: 'danger' },
  free: { label: 'پوینت رایگان', tone: 'success' },
  cheap: { label: 'ضرر کم', tone: 'warning' },
  costly: { label: 'پرهزینه', tone: 'danger' },
};

const BASIS: Record<LeaderStrategy, string> = {
  pt: 'خرید PT و نگه‌داری تا سررسید (نزدیک‌ترین تاریخی که سود قطعی می‌شود).',
  yt: 'خرید YT و فروش در بهترین روز با نرخ امروز بازار — ممکن است خیلی زودتر از سررسید باشد. «بدون ضرر تا روز…» یعنی تا آن روز پوینت رایگان جمع می‌کنید.',
  loop: 'لوپ PT با اهرم، بهره‌ی وام و LLTV زیر تا سررسید.',
};

const money = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/** Fifteen markets each for the biggest / smallest dollar profit and loss, for the capital the user enters. */
export function LeaderBoard({
  markets,
  s,
  r,
  setR,
  loop,
  setLoop,
  onCalc,
}: {
  markets: OpportunityListing[];
  s: ScreenSettings;
  r: RankSettings;
  setR: (p: Partial<RankSettings>) => void;
  loop: LoopSettings;
  setLoop: (l: LoopSettings) => void;
  onCalc: (row: LeaderRow, strategy: LeaderStrategy) => void;
}) {
  const rows = useMemo(() => {
    if (!(r.capital > 0)) return [];
    const input = { capital: r.capital, hurdle: r.hurdle };
    if (r.strategy === 'pt') return leaderPt(markets, s, input);
    if (r.strategy === 'loop') return leaderLoop(markets, s, loop, input);
    return leaderYt(markets, s, input, r.pointsOnly);
  }, [markets, s, loop, r.capital, r.hurdle, r.strategy, r.pointsOnly]);
  const b = useMemo(() => buckets(rows, r.by), [rows, r.by]);
  const gains = rows.filter((x) => x.pnl >= 0).length;

  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)] gap-3 items-end">
          <NumberField label="سرمایه" value={r.capital} onChange={(v) => setR({ capital: Number.isFinite(v) ? v : 0 })} suffix="دلار" />
          <Segmented
            value={r.strategy}
            onChange={(strategy) => setR({ strategy })}
            label="استراتژی"
            options={[
              { id: 'pt', label: 'PT عادی' },
              { id: 'yt', label: 'YT' },
              { id: 'loop', label: 'لوپ PT' },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div className="col-span-2">
            <div className="text-sm text-secondary mb-1.5">مرتب‌سازی</div>
            <Segmented
              value={r.by}
              onChange={(by) => setR({ by })}
              label="مرتب‌سازی"
              size="sm"
              options={[
                { id: 'total', label: 'سود کل دلاری' },
                { id: 'perDay', label: 'سود در هر روز' },
              ]}
            />
          </div>
          {r.strategy !== 'yt' && (
            <NumberField label="حداقل بازده سالانه" value={r.hurdle} onChange={(v) => setR({ hurdle: v })} suffix="%" hint="کمتر از این = کم‌ارزش" />
          )}
          {r.strategy === 'yt' && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-secondary pb-2.5">
              <input type="checkbox" checked={r.pointsOnly} onChange={(e) => setR({ pointsOnly: e.target.checked })} className="accent-accent size-4" />
              فقط بازارهای پوینت‌دار
            </label>
          )}
        </div>

        {r.strategy === 'loop' && (
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="اهرم" value={loop.leverage} onChange={(v) => setLoop({ ...loop, leverage: v })} suffix="×" />
            <NumberField label="بهره‌ی وام" value={loop.borrowAPY} onChange={(v) => setLoop({ ...loop, borrowAPY: v })} suffix="%" />
            <NumberField label="LLTV" value={loop.lltv} onChange={(v) => setLoop({ ...loop, lltv: v })} suffix="%" />
          </div>
        )}

        <div className="rounded-lg bg-elevated px-3 py-2.5 text-sm text-secondary leading-7">
          <b className="text-primary">معیار رتبه:</b> {r.by === 'total' ? 'نتیجه‌ی نقدی دلاری کل' : 'نتیجه‌ی نقدی دلاری در هر روز نگه‌داری'} برای سرمایه‌ی <Num>{formatUSD(r.capital, 0)}</Num>، بدون ارزش پوینت یا ایردراپ.{' '}
          <b className="text-primary">افق نگه‌داری:</b> {BASIS[r.strategy]} کارمزد <Num>{formatNumber(s.feePercent, 2)}</Num>٪ هر معامله. رتبه‌ی بالا یعنی عدد بزرگ‌تر با همین فرض‌ها، نه تأیید ریسک بازار.
        </div>
      </section>

      {r.capital > 0 && (
        <p className="text-sm text-secondary">
          <Num>{formatNumber(rows.length, 0)}</Num> بازار با <Num>{formatUSD(r.capital, 0)}</Num> حساب شد ·{' '}
          <span className="text-success">
            <Num>{formatNumber(gains, 0)}</Num> سودده
          </span>{' '}
          ·{' '}
          <span className="text-danger">
            <Num>{formatNumber(rows.length - gains, 0)}</Num> زیان‌ده
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Bucket title="بیشترین سود" icon={<TrendingUp size={18} />} cls="text-success" rows={b.topProfit} strategy={r.strategy} onCalc={onCalc} />
        <Bucket title="کمترین سود" icon={<ArrowUpRight size={18} />} cls="text-info" rows={b.leastProfit} strategy={r.strategy} onCalc={onCalc} />
        <Bucket title="بیشترین ضرر" icon={<TrendingDown size={18} />} cls="text-danger" rows={b.topLoss} strategy={r.strategy} onCalc={onCalc} />
        <Bucket title="کمترین ضرر" icon={<ArrowDownRight size={18} />} cls="text-warning" rows={b.leastLoss} strategy={r.strategy} onCalc={onCalc} />
      </div>
    </div>
  );
}

function Bucket({
  title,
  icon,
  cls,
  rows,
  strategy,
  onCalc,
}: {
  title: string;
  icon: ReactNode;
  cls: string;
  rows: LeaderRow[];
  strategy: LeaderStrategy;
  onCalc: (row: LeaderRow, strategy: LeaderStrategy) => void;
}) {
  return (
    <section className="sx-card p-4 flex flex-col gap-2 min-w-0">
      <h2 className={`font-semibold flex items-center gap-2 ${cls}`}>
        {icon} {title}
        <span className="text-xs text-muted font-normal">
          (<Num>{formatNumber(rows.length, 0)}</Num>)
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">بازاری در این دسته نیست.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-default">
          {rows.map((row, i) => (
            <li key={`${row.m.protocol}-${row.m.id}`}>
              <Row row={row} rank={i + 1} strategy={strategy} onClick={() => onCalc(row, strategy)} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ row, rank, strategy, onClick }: { row: LeaderRow; rank: number; strategy: LeaderStrategy; onClick: () => void }) {
  const { m } = row;
  const v = VERDICT[row.verdict];
  const good = row.pnl >= 0;

  return (
    <button type="button" onClick={onClick} aria-label={`محاسبه‌ی ${m.name} در ${protocols[m.protocol].name}`} className="w-full flex items-center gap-3 py-2.5 min-h-14 text-right rounded-lg hover:bg-elevated px-1 transition-colors">
      <span className="grid place-items-center size-6 rounded-full bg-elevated text-xs text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <AssetIdentity symbol={m.name} icon={m.icon} chain={m.chain} protocol={m.protocol} maturity={m.maturity} size={24} />
        <div className="text-xs text-secondary">
          نرخ ثابت <Num>{formatPercent(m.impliedAPY, 1)}</Num>
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <Pill tone={v.tone}>{v.label}</Pill>
          {strategy === 'yt' ? (
            <Pill>
              خروج روز <Num>{formatNumber(row.days, 0)}</Num>
              {row.days === m.daysToMaturity && ' (سررسید)'}
            </Pill>
          ) : (
            <Pill>
              <Num>{formatNumber(row.days, 0)}</Num> روز
            </Pill>
          )}
          {row.freeUntil !== null && (
            <Pill tone="success">
              بی‌ضرر تا روز <Num>{formatNumber(row.freeUntil, 0)}</Num>
            </Pill>
          )}
          {row.pointsExposure !== null && m.hasPoints && (
            <Pill tone="warning">
              پوینت روی <Num>{formatUSDCompact(row.pointsExposure)}</Num>
            </Pill>
          )}
          {row.tooBig && <Pill tone="danger">بزرگ نسبت به نقدینگی</Pill>}
          {strategy === 'yt' && m.baseAPY !== null && m.baseAPY - m.impliedAPY > 5 && m.baseAPY > 2 * m.impliedAPY && (
            <Pill tone="warning">بازده پایه احتمالاً موقت</Pill>
          )}
        </div>
      </div>
      <div className="text-left shrink-0">
        <div className={`font-semibold text-lg leading-tight ${good ? 'text-success' : 'text-danger'}`}>
          <Num>{money(row.pnl)}</Num>
        </div>
        <div className="text-xs text-muted">نقدی</div>
        <div className="text-xs text-secondary">
          <Num>{signedPct(row.pnlPercent, 2)}</Num> · سالانه {row.annualized > 9999 ? <>بیش از <Num>{formatPercent(9999, 0)}</Num></> : <Num>{signedPct(row.annualized, 1)}</Num>}
        </div>
        <div className="text-xs text-muted">
          <Num>{money(row.perDay)}</Num> در روز
        </div>
      </div>
    </button>
  );
}
