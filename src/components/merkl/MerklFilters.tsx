'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Layers, Search, X } from 'lucide-react';
import { ACTION, TOKEN_TYPE, merklNetwork } from '../../lib/merkl/rules';
import { defaultMerklFilters, type MerklFilters, type RewardFilter } from '../../lib/merkl/estimate';
import type { MerklAction, MerklOpportunity, MerklTokenType } from '../../lib/merkl/types';
import { formatNumber, formatUSDCompact } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { LogoSelect, type LogoOption } from './LogoSelect';
import { ActionIcon, ChainLogo, ProtocolLogo, TokenTypeIcon } from './parts';

const ALL_ICON = (
  <span className="grid place-items-center size-[18px] rounded-md bg-elevated text-muted">
    <Layers size={12} aria-hidden />
  </span>
);

function count<K>(list: MerklOpportunity[], key: (o: MerklOpportunity) => K) {
  const m = new Map<K, number>();
  for (const o of list) m.set(key(o), (m.get(key(o)) ?? 0) + 1);
  return m;
}

/** Filters for both Merkl views; options and counts come from the live list itself, so new chains and protocols appear on their own. */
export function MerklFilterBar({ list, f, setF, shown, total, extra }: { list: MerklOpportunity[]; f: MerklFilters; setF: (f: MerklFilters) => void; shown: number; total: number; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const gridId = useId();

  const chains = useMemo<LogoOption<number | 'all'>[]>(() => {
    const byId = new Map(list.map((o) => [o.chain.id, o.chain]));
    const n = count(list, (o) => o.chain.id);
    return [
      { value: 'all', label: 'همه‌ی شبکه‌ها', search: 'همه all', icon: ALL_ICON },
      ...[...byId.values()]
        .sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0))
        .map((c) => {
          const net = merklNetwork(c);
          return { value: c.id, label: net.nameFa, search: `${net.nameFa} ${net.name}`, icon: <ChainLogo chain={c} size={18} />, count: n.get(c.id) };
        }),
    ];
  }, [list]);

  const protocols = useMemo<LogoOption<string>[]>(() => {
    const byId = new Map(list.filter((o) => o.protocol).map((o) => [o.protocol!.id, o.protocol!]));
    const n = count(list, (o) => o.protocol?.id);
    return [
      { value: 'all', label: 'همه‌ی پروتکل‌ها', search: 'همه all', icon: ALL_ICON },
      ...[...byId.values()]
        .sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0))
        .map((p) => ({ value: p.id, label: <bdi dir="ltr">{p.name}</bdi>, search: `${p.name} ${p.id}`, icon: <ProtocolLogo protocol={p} size={18} />, count: n.get(p.id) })),
    ];
  }, [list]);

  const actions = useMemo<LogoOption<MerklAction | 'all'>[]>(() => {
    const n = count(list, (o) => o.action);
    return [
      { value: 'all', label: 'همه‌ی فعالیت‌ها', search: 'همه', icon: ALL_ICON },
      ...(Object.keys(ACTION) as MerklAction[])
        .filter((a) => n.has(a))
        .map((a) => ({ value: a, label: ACTION[a].label, search: `${ACTION[a].label} ${a}`, icon: <span className="text-secondary"><ActionIcon action={a} size={16} /></span>, count: n.get(a) })),
    ];
  }, [list]);

  const rewards: LogoOption<RewardFilter>[] = [
    { value: 'all', label: 'همه‌ی پاداش‌ها', search: 'همه', icon: ALL_ICON },
    ...(['TOKEN', 'POINT', 'PRETGE'] as MerklTokenType[]).map((t) => ({ value: t, label: TOKEN_TYPE[t], search: TOKEN_TYPE[t], icon: <TokenTypeIcon type={t} size={16} /> })),
  ];

  const active: { label: ReactNode; clear: () => void }[] = [];
  if (f.q) active.push({ label: <>جست‌وجو: «{f.q}»</>, clear: () => setF({ ...f, q: '' }) });
  const chip = <V extends string | number>(opts: LogoOption<V>[], v: V, key: keyof MerklFilters, prefix: string) => {
    const o = opts.find((x) => x.value === v);
    if (o && v !== 'all')
      active.push({
        label: (
          <span className="inline-flex items-center gap-1.5">
            {o.icon} {prefix}: {o.label}
          </span>
        ),
        clear: () => setF({ ...f, [key]: 'all' }),
      });
  };
  chip(chains, f.chain, 'chain', 'شبکه');
  chip(protocols, f.protocol, 'protocol', 'پروتکل');
  chip(actions, f.action, 'action', 'فعالیت');
  chip(rewards, f.reward, 'reward', 'پاداش');
  if (f.stable) active.push({ label: 'فقط استیبل‌کوین', clear: () => setF({ ...f, stable: false }) });
  if (f.hideRestricted) active.push({ label: 'بدون شرط دسترسی', clear: () => setF({ ...f, hideRestricted: false }) });

  return (
    <section className="sx-card p-4 flex flex-col gap-4" aria-label="فیلترها">
      <div className="relative">
        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
        <input type="search" dir="auto" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="جست‌وجوی توکن، پروتکل، شبکه یا آدرس" aria-label="جست‌وجوی فرصت" className="w-full pr-10 pl-3 text-base" />
      </div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={gridId} className="md:hidden tap flex items-center justify-between rounded-lg border border-control px-3 min-h-11 text-[15px] text-primary">
        <span>
          فیلترها{active.length > 0 && <> (<Num>{formatNumber(active.length, 0)}</Num> فعال)</>}
        </span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div id={gridId} className={`${open ? 'grid' : 'hidden'} md:grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end`}>
        <LogoSelect label="شبکه" value={f.chain} onChange={(chain) => setF({ ...f, chain })} options={chains} />
        <LogoSelect label="پروتکل" value={f.protocol} onChange={(protocol) => setF({ ...f, protocol })} options={protocols} />
        <LogoSelect label="فعالیت" value={f.action} onChange={(action) => setF({ ...f, action })} options={actions} />
        <LogoSelect label="نوع پاداش" value={f.reward} onChange={(reward) => setF({ ...f, reward })} options={rewards} />
        <NumberField label="حداقل TVL" value={f.minTvl} onChange={(v) => setF({ ...f, minTvl: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        <NumberField label="حداقل روز باقی‌مانده" value={f.minDays} onChange={(v) => setF({ ...f, minDays: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
        <div className="col-span-2 md:col-span-3 xl:col-span-6 flex flex-wrap gap-x-5 gap-y-1">
          <label className="flex items-center gap-2 text-sm min-h-10">
            <input type="checkbox" checked={f.stable} onChange={(e) => setF({ ...f, stable: e.target.checked })} /> فقط استیبل‌کوین
          </label>
          <label className="flex items-center gap-2 text-sm min-h-10">
            <input type="checkbox" checked={f.hideRestricted} onChange={(e) => setF({ ...f, hideRestricted: e.target.checked })} /> پنهان‌کردن فرصت‌های دارای شرط دسترسی
          </label>
        </div>
      </div>
      {extra}
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span className="text-secondary">
          <Num>{formatNumber(shown, 0)}</Num> نتیجه از <Num>{formatNumber(total, 0)}</Num> فرصت زنده
          {f.minTvl > 0 && (
            <span className="text-muted">
              {' '}
              · TVL دست‌کم <Num>{formatUSDCompact(f.minTvl)}</Num>
            </span>
          )}
        </span>
        {active.map((a, i) => (
          <button key={i} type="button" onClick={a.clear} className="tap inline-flex items-center gap-1 rounded-full border border-accent/60 bg-accent/10 px-3 min-h-8 text-primary" aria-label="حذف فیلتر">
            {a.label} <X size={13} aria-hidden />
          </button>
        ))}
        {active.length > 0 && (
          <button type="button" onClick={() => setF({ ...defaultMerklFilters, minTvl: f.minTvl, minDays: f.minDays })} className="tap text-accent underline underline-offset-4 px-1">
            پاک‌کردن فیلترها
          </button>
        )}
      </div>
    </section>
  );
}
