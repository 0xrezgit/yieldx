'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, CircleSlash, Trophy } from 'lucide-react';
import { rankMine, reasonCounts, type MineRow, type MineSettings } from '../../lib/merkl/estimate';
import type { MerklOpportunity } from '../../lib/merkl/types';
import { formatCompact, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Collapsible } from '../ui/card';
import { Num } from '../ui/num';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { MerklDetails } from './MerklDetails';
import { FlagPills, lookAlikes, OppIdentity, RewardToken } from './parts';

const money = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const plain = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 2 : 3);

function Row({ row, rank, showId }: { row: MineRow; rank: number; showId: boolean }) {
  const [open, setOpen] = useState(false);
  const { o } = row;
  const good = row.net >= 0;
  return (
    <li className="flex flex-col">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-start gap-3 py-3 text-right rounded-lg hover:bg-elevated px-1 transition-colors">
        <span className="grid place-items-center size-6 mt-1 rounded-full bg-elevated text-xs text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <OppIdentity o={o} showId={showId} />
          <div className="flex flex-wrap items-center gap-1">
            <Pill>
              <Num>{formatNumber(row.days, row.days < 3 ? 1 : 0)}</Num> روز
            </Pill>
            <Pill tone="info">
              APR شما <Num>{formatPercent(row.aprAfter, 2)}</Num>
            </Pill>
            {row.breakEvenDays !== null && (
              <Pill tone={row.breakEvenDays > row.days ? 'danger' : 'muted'}>
                سربه‌سر هزینه <Num>{row.breakEvenDays < 1 ? 'کمتر از ۱' : formatNumber(row.breakEvenDays, 0)}</Num> روز
              </Pill>
            )}
            {row.approx && <Pill tone="warning">تقریبی</Pill>}
            {row.large && <Pill tone="warning">سهم بزرگ از TVL</Pill>}
            <FlagPills o={o} max={2} />
          </div>
          {(row.points.length > 0 || row.pretge.length > 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
              {[...row.points, ...row.pretge].map((p) => (
                <RewardToken key={`${p.token.chainId}:${p.token.address}`} t={p.token} size={14}>
                  <span>
                    + <Num>{formatCompact(p.toEnd)}</Num> تا پایان
                  </span>
                </RewardToken>
              ))}
            </div>
          )}
        </div>
        <div className="text-left shrink-0 flex flex-col items-end">
          <div className={`font-semibold text-lg leading-tight ${good ? 'text-success' : 'text-danger'}`}>
            <Num>{money(row.net)}</Num>
          </div>
          <div className="text-xs text-muted">خالص تا پایان</div>
          <div className="text-xs text-secondary">
            <Num>{plain(row.usdPerDay)}</Num> در روز
          </div>
          <ChevronDown size={16} className={`mt-1 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </div>
      </button>
      {open && (
        <div className="px-1 pb-4 pt-1 border-t border-default">
          <p className="text-xs text-secondary mb-3 leading-6">
            پاداش دلاری تا پایان <Num>{plain(row.usdToEnd)}</Num> − هزینه‌ی ورود و خروج <Num>{plain(row.cost)}</Num> = <Num>{money(row.net)}</Num>. پوینت و توکن پیش از TGE جدا شمرده شده‌اند و در این عدد نیستند.
          </p>
          <MerklDetails o={o} estimates={row.estimates} />
        </div>
      )}
    </li>
  );
}

/**
 * «For my capital»: at most fifteen opportunities where a personal estimate is
 * possible, ranked by dollar reward to the end of their campaigns net of entry cost.
 * Everything else is listed with the reason it was left out.
 */
export function MineBoard({ list, s, setS, minDays }: { list: MerklOpportunity[]; s: MineSettings; setS: (p: Partial<MineSettings>) => void; minDays: number }) {
  const { rows, excluded, total } = useMemo(() => rankMine(list, s, minDays), [list, s, minDays]);
  const reasons = useMemo(() => reasonCounts(excluded), [excluded]);
  const alike = useMemo(() => lookAlikes(list), [list]);

  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <NumberField label="سرمایه" value={s.capital} onChange={(v) => setS({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
          <NumberField label="هزینه‌ی ورود و خروج در اتریوم" value={s.costEthereum} onChange={(v) => setS({ costEthereum: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" help="گس، سواپ و کارمزد برای ورود و خروج، روی شبکه‌ی اتریوم." />
          <NumberField label="هزینه‌ی ورود و خروج در سایر شبکه‌ها" value={s.costOther} onChange={(v) => setS({ costOther: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
          <span className="text-sm text-secondary">مرتب‌سازی</span>
          <Segmented
            value={s.by}
            onChange={(by) => setS({ by })}
            label="مرتب‌سازی"
            size="sm"
            options={[
              { id: 'net', label: 'خالص تا پایان کمپین' },
              { id: 'perDay', label: 'پاداش در هر روز' },
            ]}
          />
        </div>
        <div className="rounded-lg bg-elevated px-3 py-2.5 text-sm text-secondary leading-7">
          <b className="text-primary">روش:</b> سهم <Num>{formatUSD(s.capital, 0)}</Num> از پاداش هر کمپین پس از ورود شما (رقیق‌شدن)، با TVL و قیمت امروز، تا تاریخ پایان همان کمپین؛ منهای هزینه‌ی ورود و خروج.{' '}
          <b className="text-primary">فقط</b> نگه‌داری، وام‌دهی، نقدینگی ساده و استیک؛ بدون شرط دسترسی؛ با پاداش توکنی قیمت‌دار. بازده بومی، تغییر قیمت دارایی و زیان ناپایدار در این عدد نیستند.{' '}
          <b className="text-primary">برآورد است، نه سود تضمینی.</b>
        </div>
      </section>

      {s.capital > 0 && (
        <p className="text-sm text-secondary">
          <Num>{formatNumber(total, 0)}</Num> فرصت قابل برآورد · <Num>{formatNumber(excluded.length, 0)}</Num> فرصت کنار گذاشته شد
        </p>
      )}

      {!(s.capital > 0) ? (
        <Empty>سرمایه را وارد کنید.</Empty>
      ) : rows.length === 0 ? (
        <Empty>با این فیلترها فرصت قابل برآوردی نیست. فیلترها یا حداقل TVL را کم کنید.</Empty>
      ) : (
        <section className="sx-card p-4 flex flex-col gap-2 min-w-0">
          <h2 className="font-semibold flex items-center gap-2 text-success">
            <Trophy size={18} aria-hidden /> بیشترین پاداش برآوردی
            <span className="text-xs text-muted font-normal">
              (<Num>{formatNumber(rows.length, 0)}</Num>)
            </span>
          </h2>
          <ol className="flex flex-col divide-y divide-default">
            {rows.map((row, i) => (
              <Row key={row.o.id} row={row} rank={i + 1} showId={alike.has(row.o.id)} />
            ))}
          </ol>
        </section>
      )}

      {excluded.length > 0 && (
        <Collapsible
          title="کنار گذاشته‌شده‌ها و دلیلش"
          icon={<CircleSlash size={18} aria-hidden />}
          badge={
            <span className="text-xs text-muted font-normal">
              (<Num>{formatNumber(excluded.length, 0)}</Num>)
            </span>
          }
        >
          <ul className="flex flex-col gap-1.5 text-sm">
            {reasons.map((r) => (
              <li key={r.reason} className="flex items-start justify-between gap-3">
                <span className="text-secondary">{r.reason}</span>
                <Num className="text-primary shrink-0">{formatNumber(r.count, 0)}</Num>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col divide-y divide-default">
            {[...excluded]
              .sort((a, b) => b.o.apr - a.o.apr)
              .slice(0, 30)
              .map((e) => (
                <li key={e.o.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 justify-between">
                  <OppIdentity o={e.o} size={24} showId={alike.has(e.o.id)} />
                  <span className="text-xs text-secondary sm:text-left sm:max-w-[45%]">
                    APR <Num>{formatPercent(e.o.apr, 1)}</Num> · {e.reason}
                  </span>
                </li>
              ))}
          </ul>
          {excluded.length > 30 && <p className="text-xs text-muted">۳۰ مورد با بالاترین APR نمایش داده شد؛ بقیه را در بخش «کشف» ببینید.</p>}
        </Collapsible>
      )}
    </div>
  );
}
