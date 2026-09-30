'use client';

import { useMemo, useState } from 'react';
import { useLending } from '../../hooks/useLending';
import { borrowQuotes, type BorrowClass } from '../../lib/opportunity/borrow';
import { HORIZONS, type HorizonDays } from '../../lib/opportunity/policy';
import { formatNumber } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Segmented } from '../opportunities/parts';
import { BorrowBoard } from './BorrowBoard';

/** The cost of a loan by itself — apart from the income ranking (a loan is not income). */
export function BorrowTool() {
  const { feed, loading } = useLending();
  const [amount, setAmount] = useState(1000);
  const [days, setDays] = useState<HorizonDays>(30);
  const [cls, setCls] = useState<BorrowClass>('usd');
  const q = useMemo(() => (feed && amount > 0 ? borrowQuotes(feed.opportunities, amount, days, cls) : null), [feed, amount, days, cls]);
  return (
    <div className="flex flex-col gap-4">
      <section className="sx-card p-4 flex flex-col gap-3">
        <NumberField label="مبلغ وام" value={amount} onChange={(v) => setAmount(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" />
        <Segmented<`${HorizonDays}`> value={`${days}`} onChange={(v) => setDays(Number(v) as HorizonDays)} label="مدت" options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
        <Segmented<BorrowClass>
          value={cls}
          onChange={setCls}
          label="دارایی وام"
          size="sm"
          options={[
            { id: 'usd', label: 'دلاری' },
            { id: 'eth', label: 'ETH' },
            { id: 'btc', label: 'BTC' },
            { id: 'all', label: 'همه' },
          ]}
        />
      </section>
      {loading ? <div className="h-40 rounded-lg bg-surface border border-default animate-pulse" aria-busy="true" /> : <BorrowBoard rows={q?.rows ?? []} blocked={q?.blocked ?? []} amount={amount} days={days} />}
    </div>
  );
}
