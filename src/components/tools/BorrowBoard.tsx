'use client';

import { CircleSlash, ExternalLink } from 'lucide-react';
import type { BorrowRow } from '../../lib/opportunity/borrow';
import { networkByKey } from '../../lib/registry/networks';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { Num } from '../ui/num';
import { Empty, Pill } from '../opportunities/parts';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 2 : 4);

function Row({ r, rank }: { r: BorrowRow; rank?: number }) {
  const net = networkByKey(r.o.chain);
  const asset = r.o.assets.deposit[0]?.symbol ?? '—';
  return (
    <li className="py-3 px-1 flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        {rank !== undefined && <span className="grid place-items-center size-7 rounded-full bg-elevated text-xs font-semibold text-secondary shrink-0 num">{formatNumber(rank, 0)}</span>}
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <span className="text-[15px] font-semibold text-primary">
            وام <bdi dir="ltr">{asset}</bdi> · <bdi dir="ltr" className="font-normal text-secondary">{r.o.protocol.name}</bdi>
          </span>
          <span className="text-xs text-secondary">
            {r.kind === 'fixed' ? 'نرخ ثابت تا سررسید' : 'نرخ متغیر'} · {net.nameFa} · <bdi>{r.o.market.name}</bdi>
          </span>
          <div className="flex flex-wrap gap-1">
            {r.collateral.slice(0, 6).map((c, i) => (
              <Pill key={i}>
                وثیقه <bdi dir="ltr">{c.symbol ?? '—'}</bdi> تا <Num>{formatPercent(c.maxLtv * 100, 0)}</Num>
              </Pill>
            ))}
            {r.collateral.length > 6 && <Pill>+<Num>{formatNumber(r.collateral.length - 6, 0)}</Num></Pill>}
          </div>
        </div>
        <div className="shrink-0 text-left flex flex-col items-end gap-0.5">
          {r.costUsd !== null ? (
            <span className="font-semibold text-lg text-danger">
              <Num>{usd(r.costUsd)}</Num>
            </span>
          ) : (
            <span className="text-secondary">—</span>
          )}
          <span className="text-xs text-secondary">
            {r.ratePct === null ? '—' : <Num>{formatPercent(r.ratePct, 2)}</Num>} سالانه · <Num>{formatNumber(r.days, 0)}</Num> روز
          </span>
          {r.o.url && (
            <a href={r.o.url} target="_blank" rel="noopener noreferrer" className="tap mt-1 inline-flex items-center gap-1 rounded-md border border-default px-2.5 min-h-9 text-xs font-medium text-secondary hover:text-primary hover:border-strong hover:bg-elevated">
              <ExternalLink size={13} aria-hidden /> ورود
            </a>
          )}
        </div>
      </div>
      {(r.blocked || r.notes.length > 0) && <p className="text-xs text-muted leading-6">{r.blocked ?? r.notes.join(' ')}</p>}
    </li>
  );
}

/** «هزینه‌ی تأمین سرمایه»: the cheapest places to borrow this amount for this period. */
export function BorrowBoard({ rows, blocked, amount, days }: { rows: BorrowRow[]; blocked: BorrowRow[]; amount: number; days: number }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-secondary leading-6 rounded-md bg-surface border border-default px-3 py-2">
        هزینه‌ی بهره‌ی وام <Num>{usd(amount)}</Num> در <Num>{formatNumber(days, 0)}</Num> روز، ارزان‌ترین اول. وام درآمد نیست؛ گس و هزینه‌ی وثیقه جداست.
      </p>
      {rows.length === 0 ? (
        <Empty>برای این مبلغ و دارایی بازاری پیدا نشد.</Empty>
      ) : (
        <section className="sx-card p-2 sm:p-3" aria-label="ارزان‌ترین وام‌ها">
          <ol className="flex flex-col divide-y divide-default">
            {rows.slice(0, 30).map((r, i) => (
              <Row key={r.key} r={r} rank={i + 1} />
            ))}
          </ol>
        </section>
      )}
      {blocked.length > 0 && (
        <Collapsible title="برای این مبلغ ممکن نیست" icon={<CircleSlash size={18} aria-hidden />} badge={<Num>{formatNumber(blocked.length, 0)}</Num>}>
          <ul className="flex flex-col divide-y divide-default">
            {blocked.slice(0, 40).map((r) => (
              <Row key={r.key} r={r} />
            ))}
          </ul>
        </Collapsible>
      )}
    </div>
  );
}
