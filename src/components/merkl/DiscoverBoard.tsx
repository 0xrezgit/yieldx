'use client';

import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { discover, firstEnd, lastEnd, type DiscoverSort } from '../../lib/merkl/estimate';
import { merklUrl } from '../../lib/merkl/rules';
import type { MerklOpportunity } from '../../lib/merkl/types';
import { formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Empty, Segmented } from '../opportunities/parts';
import { MarketTable } from '../opportunities/MarketTable';
import { MerklDetails } from './MerklDetails';
import { FlagPills, lookAlikes, OppIdentity, RewardChips } from './parts';

const DAY = 86_400;
const openOpportunity = (o: MerklOpportunity) => window.open(o.depositUrl ?? merklUrl(o), '_blank', 'noopener,noreferrer');

function Ends({ o }: { o: MerklOpportunity }) {
  const now = Date.now() / 1000;
  const first = (firstEnd(o) - now) / DAY;
  const last = (lastEnd(o) - now) / DAY;
  const d = (x: number) => formatNumber(x, x < 3 ? 1 : 0);
  return (
    <span className={`flex flex-col whitespace-nowrap ${first < 3 ? 'text-warning' : 'text-primary'}`}>
      <span>
        <Num>{d(first)}</Num> روز
      </span>
      {o.campaigns.length > 1 && (
        <span className="text-xs text-secondary">
          {Math.round(last) !== Math.round(first) ? (
            <>
              تا <Num>{d(last)}</Num> روز ·{' '}
            </>
          ) : null}
          <Num>{formatNumber(o.campaigns.length, 0)}</Num> کمپین
        </span>
      )}
    </span>
  );
}

const Apr = ({ o }: { o: MerklOpportunity }) =>
  o.apr > 0 ? <Num className="text-primary font-semibold">{o.apr > 9999 ? 'بیش از ۹٬۹۹۹٪' : formatPercent(o.apr, o.apr >= 100 ? 0 : 2)}</Num> : <span className="text-xs text-info">فقط پوینت</span>;

/**
 * Discovery: Merkl's own numbers, for spotting what to look at. APR is the pool
 * average and «daily rewards» are for everyone — neither is what one user earns.
 */
export function DiscoverBoard({ list, by, setBy }: { list: MerklOpportunity[]; by: DiscoverSort; setBy: (b: DiscoverSort) => void }) {
  const rows = useMemo(() => discover(list, by), [list, by]);
  const alike = useMemo(() => lookAlikes(list), [list]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <p className="text-sm text-secondary leading-7">
          اعداد همان گزارش Merkl‌اند: APR میانگین همه‌ی شرکت‌کنندگان است و «پاداش روزانه» برای کل کمپین؛ <b className="text-primary">سهم شما نیست</b>. برای برآورد شخصی به بخش «برای سرمایه‌ی من» بروید.
        </p>
        <div className="shrink-0">
          <Segmented
            value={by}
            onChange={setBy}
            label="مرتب‌سازی"
            size="sm"
            options={[
              { id: 'apr', label: 'APR' },
              { id: 'daily', label: 'پاداش روزانه' },
              { id: 'tvl', label: 'TVL' },
              { id: 'ending', label: 'نزدیک‌ترین پایان' },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>فرصتی با این شرایط پیدا نشد. فیلترها یا حداقل TVL را کم کنید.</Empty>
      ) : (
        <MarketTable<MerklOpportunity>
          key={by}
          caption="فرصت‌های پاداش Merkl"
          identityHeader="فرصت، پروتکل و شبکه"
          rows={rows}
          rowKey={(o) => o.id}
          identity={(o) => (
            <div className="flex flex-col gap-1.5 min-w-0">
              <OppIdentity o={o} showId={alike.has(o.id)} />
              <FlagPills o={o} max={3} />
            </div>
          )}
          actionLabel="ورود"
          actionIcon={<ExternalLink size={14} aria-hidden />}
          onAction={openOpportunity}
          columns={[
            { id: 'apr', header: 'APR مشوق', cell: (o) => <Apr o={o} /> },
            { id: 'daily', header: 'پاداش روزانه‌ی کل', cell: (o) => (o.dailyUsd > 0 ? <Num>{formatUSD(o.dailyUsd, o.dailyUsd >= 100 ? 0 : 2)}</Num> : <span className="text-muted">—</span>) },
            { id: 'tvl', header: 'TVL', cell: (o) => <Num>{formatUSDCompact(o.tvl)}</Num> },
            { id: 'rewards', header: 'پاداش', cell: (o) => <RewardChips o={o} max={2} /> },
            { id: 'ends', header: 'تا پایان', cell: (o) => <Ends o={o} /> },
          ]}
          mobile={(o) => ({
            result: <Apr o={o} />,
            sub: (
              <>
                TVL <Num>{formatUSDCompact(o.tvl)}</Num>
              </>
            ),
            meta: (
              <span className="flex flex-col gap-1.5 w-full">
                <RewardChips o={o} max={3} />
                <span>
                  پاداش روزانه‌ی کل <Num>{formatUSD(o.dailyUsd, 0)}</Num> · پایان <Num>{formatNumber(Math.max(0, (firstEnd(o) - Date.now() / 1000) / DAY), 1)}</Num> روز دیگر
                </span>
              </span>
            ),
          })}
          details={(o) => <MerklDetails o={o} />}
        />
      )}
    </div>
  );
}
