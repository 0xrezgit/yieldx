'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, Coins, Hourglass, Star } from 'lucide-react';
import { liquidityLabel, type RewardBoard, type RewardEntry, type RewardGroup } from '../../lib/merkl/rewards';
import { formatAgo, formatCompact, formatNumber, formatUSDCompact } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Empty, Pill } from '../opportunities/parts';
import { days, OppFooter, usd } from './MerklDetails';
import { OppIdentity, RewardToken, WatchStar } from './parts';

const MAX_TOKENS = 30;
const MAX_PER_GROUP = 10;

function Liquidity({ e }: { e: RewardEntry }) {
  const l = liquidityLabel(e);
  if (l === 'deep') return <span className="text-success">عمیق (دارایی اصلی)</span>;
  if (l === null) return <span className="text-muted">نامعلوم</span>;
  return (
    <span className={l < 50_000 ? 'text-warning' : 'text-primary'}>
      <Num>{formatUSDCompact(l)}</Num>
    </span>
  );
}

/** Amount of one reward for the user's capital; details open below. */
function Entry({ e, rank, children, watched, toggleWatch }: { e: RewardEntry; rank: number | null; children: ReactNode; watched: boolean; toggleWatch: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col">
      <div className="flex items-start gap-1">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex-1 min-w-0 flex items-start gap-3 py-3 text-right rounded-lg hover:bg-elevated px-1">
          {rank !== null ? <span className="grid place-items-center size-7 mt-0.5 rounded-full bg-elevated text-xs font-semibold text-secondary shrink-0 num">{formatNumber(rank, 0)}</span> : <span className="size-7 shrink-0" aria-hidden />}
          <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <OppIdentity o={e.o} size={24} />
            <div className="flex flex-wrap gap-1">
              {e.conditions.map((c) => (
                <Pill key={c}>{c}</Pill>
              ))}
              {e.note && <Pill tone="warning">تقریبی</Pill>}
            </div>
          </div>
          <div className="shrink-0 flex flex-wrap sm:flex-col items-baseline sm:items-end gap-x-3 gap-y-0.5 text-right sm:text-left">
            {children}
            <ChevronDown size={16} className={`self-center sm:self-end sm:mt-1 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </div>
          </div>
        </button>
        <div className="pt-2.5">
          <WatchStar on={watched} onToggle={toggleWatch} name={e.o.name} />
        </div>
      </div>
      {open && (
        <div className="px-1 pb-4 pt-3 border-t border-default flex flex-col gap-3 text-sm text-secondary">
          <p className="leading-7">
            <Num>{formatCompact(e.units, 2)}</Num> <bdi dir="ltr">{e.token.symbol}</bdi> در <Num>{days(e.days)}</Num> روز · <Num>{formatCompact(e.unitsToEnd, 2)}</Num> تا پایان کمپین (<Num>{days(e.daysToEnd)}</Num> روز). {e.note}
          </p>
          <OppFooter o={e.o} />
        </div>
      )}
    </li>
  );
}

function Amount({ e }: { e: RewardEntry }) {
  return (
    <span className="text-primary font-semibold">
      <Num>{formatCompact(e.units, 2)}</Num> <bdi dir="ltr" className="text-sm">{e.token.symbol}</bdi>
    </span>
  );
}

/** Equal amounts share a rank (fixed-rate points give every deposit the same amount). */
const sharedRank = (list: RewardEntry[], i: number) => 1 + list.findIndex((x) => Math.abs(x.units - list[i].units) <= 1e-9 * Math.max(1, list[i].units));

function Groups({ groups, icon, empty, unit, watch, toggleWatch }: { groups: RewardGroup[]; icon: ReactNode; empty: string; unit: string; watch: ReadonlySet<string>; toggleWatch: (id: string) => void }) {
  if (!groups.length) return <Empty>{empty}</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.key} className="sx-card p-3 sm:p-4 flex flex-col gap-1 min-w-0">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary px-1">
            {icon}
            <RewardToken t={g.token} size={20} />
            <span className="text-xs text-muted font-normal">
              {unit}
              {g.programs.length > 0 && <> · برنامه: <bdi dir="ltr">{g.programs.join('، ')}</bdi></>}
            </span>
          </h4>
          <ol className="flex flex-col divide-y divide-default">
            {g.entries.slice(0, MAX_PER_GROUP).map((e, i) => (
              <Entry key={`${e.o.id}:${e.c.id}`} e={e} rank={g.entries.length > 1 ? sharedRank(g.entries, i) : null} watched={watch.has(e.o.id)} toggleWatch={() => toggleWatch(e.o.id)}>
                <Amount e={e} />
                <span className="text-xs text-muted">ارزش دلاری: نامعلوم</span>
              </Entry>
            ))}
          </ol>
          {g.entries.length > MAX_PER_GROUP && (
            <p className="text-xs text-muted px-1">
              <Num>{formatNumber(MAX_PER_GROUP, 0)}</Num> مورد اول از <Num>{formatNumber(g.entries.length, 0)}</Num>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * «رتبه‌بندی توکن و پوینت»: independent of the dollar ranking. Tokens ranked by
 * validated dollar value; points ranked only inside one program's unit; pre-TGE in
 * units with unknown dollar value.
 */
export function RewardsBoard({ board, horizon, watch, toggleWatch }: { board: RewardBoard; horizon: number; watch: ReadonlySet<string>; toggleWatch: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-secondary leading-7">
        مقدار پاداش احتمالی برای مبلغ شما در <Num>{formatNumber(horizon, 0)}</Num> روز (هر کمپین تا پایان خودش)، با نرخ فعلی. پوینت و توکن عرضه‌نشده به دلار تبدیل نمی‌شوند و به سود دلاری اضافه نمی‌شوند.
      </p>

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold flex items-center gap-2 text-primary">
          <Coins size={18} className="text-accent" aria-hidden /> توکن‌های عرضه‌شده
          <span className="text-xs text-muted font-normal">به ترتیب ارزش دلاری، نه تعداد</span>
        </h3>
        {board.tokens.length === 0 ? (
          <Empty>توکن پاداش قیمت‌دار و قابل برآوردی نیست.</Empty>
        ) : (
          <div className="sx-card p-3 sm:p-4 min-w-0">
            <ol className="flex flex-col divide-y divide-default">
              {board.tokens.slice(0, MAX_TOKENS).map((e, i) => (
                <Entry key={`${e.o.id}:${e.c.id}`} e={e} rank={i + 1} watched={watch.has(e.o.id)} toggleWatch={() => toggleWatch(e.o.id)}>
                  <span className="text-success font-semibold text-lg leading-tight">
                    <Num>{usd(e.usd as number)}</Num>
                  </span>
                  <Amount e={e} />
                  <span className="text-xs text-secondary">
                    قیمت <Num>{usd(e.token.price ?? 0)}</Num>
                    {e.token.priceAt !== null && <> · {formatAgo(e.token.priceAt * 1000)}</>}
                  </span>
                  <span className="text-xs text-secondary">
                    نقدشوندگی <Liquidity e={e} />
                  </span>
                </Entry>
              ))}
            </ol>
          </div>
        )}
        {board.unpriced.length > 0 && (
          <details className="sx-card group min-w-0">
            <summary className="px-4 py-3 text-sm text-secondary flex items-center justify-between min-h-12">
              <span>
                توکن‌های بدون قیمت یا نقدشوندگی معتبر (<Num>{formatNumber(board.unpriced.length, 0)}</Num>) — رتبه‌بندی نشده
              </span>
              <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="px-3 pb-3 flex flex-col divide-y divide-default">
              {board.unpriced.slice(0, 40).map((e) => (
                <Entry key={`${e.o.id}:${e.c.id}`} e={e} rank={null} watched={watch.has(e.o.id)} toggleWatch={() => toggleWatch(e.o.id)}>
                  <Amount e={e} />
                  <span className="text-xs text-warning max-w-[12rem] text-left">{e.price.reason?.label ?? 'قیمت معتبر ندارد'}</span>
                </Entry>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold flex items-center gap-2 text-primary">
          <Star size={18} className="text-info" aria-hidden /> پوینت‌ها
          <span className="text-xs text-muted font-normal">رتبه فقط درون هر برنامه و واحد</span>
        </h3>
        <Groups groups={board.points} icon={null} empty="پوینت قابل برآوردی برای این مبلغ نیست." unit="واحد همین برنامه" watch={watch} toggleWatch={toggleWatch} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold flex items-center gap-2 text-primary">
          <Hourglass size={18} className="text-warning" aria-hidden /> Pre-TGE و توکن‌های عرضه‌نشده
          <span className="text-xs text-muted font-normal">تاریخ عرضه، نسبت تبدیل و قیمت حدس زده نمی‌شود</span>
        </h3>
        <Groups groups={board.pretge} icon={null} empty="توکن عرضه‌نشده‌ی قابل برآوردی برای این مبلغ نیست." unit="توکن عرضه‌نشده" watch={watch} toggleWatch={toggleWatch} />
      </section>
    </div>
  );
}
