'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import protocols from '../../config/protocols.json';
import type { ProtocolId } from '../../types/protocol';
import { isStable, type OpportunityListing } from '../../lib/risk/opportunities';
import { networkByName } from '../../lib/registry/networks';
import { formatNumber, formatUSDCompact, normalizeSearch } from '../../lib/utils/formatting';
import { searchText } from '../forms/MarketPicker';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';

export type AssetType = 'all' | 'stable' | 'eth' | 'btc' | 'sol' | 'other';
export type MaturityRange = 'all' | 'lt30' | '30to90' | '90to180' | 'gt180';
export type PointsFilter = 'all' | 'points' | 'none';

export interface Filters {
  q: string;
  protocol: ProtocolId | 'all';
  chain: string;
  asset: AssetType;
  maturity: MaturityRange;
  points: PointsFilter;
}

export const defaultFilters: Filters = { q: '', protocol: 'all', chain: 'all', asset: 'all', maturity: 'all', points: 'all' };

const ASSET_LABEL: Record<AssetType, string> = { all: 'همه', stable: 'استیبل', eth: 'ETH', btc: 'BTC', sol: 'SOL', other: 'سایر' };
const MATURITY_LABEL: Record<MaturityRange, string> = { all: 'همه', lt30: 'کمتر از ۳۰ روز', '30to90': '۳۰ تا ۹۰ روز', '90to180': '۹۰ تا ۱۸۰ روز', gt180: 'بیش از ۱۸۰ روز' };
const POINTS_LABEL: Record<PointsFilter, string> = { all: 'همه', points: 'پوینت‌دار', none: 'بدون پوینت یا نامعلوم' };

export function assetType(m: Pick<OpportunityListing, 'name' | 'categories'>): Exclude<AssetType, 'all'> {
  if (isStable(m)) return 'stable';
  if (m.categories.includes('eth') || /eth/i.test(m.name)) return 'eth';
  if (m.categories.includes('btc') || /btc/i.test(m.name)) return 'btc';
  if (m.categories.includes('sol') || /sol/i.test(m.name)) return 'sol';
  return 'other';
}

const inRange = (d: number, r: MaturityRange) =>
  r === 'all' || (r === 'lt30' ? d < 30 : r === '30to90' ? d >= 30 && d < 90 : r === '90to180' ? d >= 90 && d < 180 : d >= 180);

/** Independent filters; search matches symbol, project, protocol, network (fa/en) and addresses. */
export function applyFilters(markets: OpportunityListing[], f: Filters): OpportunityListing[] {
  const q = normalizeSearch(f.q);
  return markets.filter(
    (m) =>
      (f.protocol === 'all' || m.protocol === f.protocol) &&
      (f.chain === 'all' || m.chain === f.chain) &&
      (f.asset === 'all' || assetType(m) === f.asset) &&
      inRange(m.daysToMaturity, f.maturity) &&
      (f.points === 'all' || (f.points === 'points' ? m.hasPoints : !m.hasPoints)) &&
      (!q || q.split(' ').every((w) => searchText(m).includes(w))),
  );
}

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-secondary min-w-0">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="w-full px-2.5 text-[15px]">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The filter bar: each control independent, active filters listed as removable chips, result count, clear all. */
export function FilterBar({
  markets,
  f,
  setF,
  minLiquidity,
  setMinLiquidity,
  shown,
  total,
  extra,
}: {
  markets: OpportunityListing[];
  f: Filters;
  setF: (f: Filters) => void;
  minLiquidity: number;
  setMinLiquidity: (v: number) => void;
  shown: number;
  total: number;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const gridId = useId();
  const chains = [...new Set(markets.map((m) => m.chain))].sort((a, b) => networkByName(a).nameFa.localeCompare(networkByName(b).nameFa, 'fa'));
  const active: { label: ReactNode; clear: () => void }[] = [];
  if (f.q) active.push({ label: <>جست‌وجو: «{f.q}»</>, clear: () => setF({ ...f, q: '' }) });
  if (f.protocol !== 'all') active.push({ label: <>پروتکل: <bdi dir="ltr">{protocols[f.protocol].name}</bdi></>, clear: () => setF({ ...f, protocol: 'all' }) });
  if (f.chain !== 'all') active.push({ label: <>شبکه: {networkByName(f.chain).nameFa}</>, clear: () => setF({ ...f, chain: 'all' }) });
  if (f.asset !== 'all') active.push({ label: <>دارایی: {ASSET_LABEL[f.asset]}</>, clear: () => setF({ ...f, asset: 'all' }) });
  if (f.maturity !== 'all') active.push({ label: <>سررسید: {MATURITY_LABEL[f.maturity]}</>, clear: () => setF({ ...f, maturity: 'all' }) });
  if (f.points !== 'all') active.push({ label: <>پوینت: {POINTS_LABEL[f.points]}</>, clear: () => setF({ ...f, points: 'all' }) });

  return (
    <section className="sx-card p-4 flex flex-col gap-4" aria-label="فیلترها">
      <div className="relative">
        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
        <input type="search" dir="auto" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="جست‌وجوی نماد، پروژه، شبکه یا آدرس" aria-label="جست‌وجوی بازار" className="w-full pr-10 pl-3 text-base" />
      </div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={gridId} className="md:hidden tap flex items-center justify-between rounded-lg border border-control px-3 min-h-11 text-[15px] text-primary">
        <span>
          فیلترها{active.length > 0 && <> (<Num>{formatNumber(active.length, 0)}</Num> فعال)</>}
        </span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div id={gridId} className={`${open ? 'grid' : 'hidden'} md:grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end`}>
        <Select<ProtocolId | 'all'> label="پروتکل" value={f.protocol} onChange={(protocol) => setF({ ...f, protocol })} options={[{ value: 'all', label: 'همه' }, ...(Object.keys(protocols) as ProtocolId[]).map((p) => ({ value: p, label: protocols[p].name }))]} />
        <Select label="شبکه" value={f.chain} onChange={(chain) => setF({ ...f, chain })} options={[{ value: 'all', label: 'همه' }, ...chains.map((c) => ({ value: c, label: networkByName(c).nameFa }))]} />
        <Select<AssetType> label="نوع دارایی" value={f.asset} onChange={(asset) => setF({ ...f, asset })} options={(Object.keys(ASSET_LABEL) as AssetType[]).map((a) => ({ value: a, label: ASSET_LABEL[a] }))} />
        <Select<MaturityRange> label="بازه‌ی سررسید" value={f.maturity} onChange={(maturity) => setF({ ...f, maturity })} options={(Object.keys(MATURITY_LABEL) as MaturityRange[]).map((a) => ({ value: a, label: MATURITY_LABEL[a] }))} />
        <NumberField label="حداقل نقدینگی" value={minLiquidity} onChange={(v) => setMinLiquidity(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" />
        <Select<PointsFilter> label="وضعیت پوینت" value={f.points} onChange={(points) => setF({ ...f, points })} options={(Object.keys(POINTS_LABEL) as PointsFilter[]).map((a) => ({ value: a, label: POINTS_LABEL[a] }))} />
      </div>
      {extra}
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span className="text-secondary">
          <Num>{formatNumber(shown, 0)}</Num> نتیجه از <Num>{formatNumber(total, 0)}</Num> بازار فعال
          {minLiquidity > 0 && (
            <span className="text-muted">
              {' '}
              · نقدینگی دست‌کم <Num>{formatUSDCompact(minLiquidity)}</Num>
            </span>
          )}
        </span>
        {active.map((a, i) => (
          <button key={i} type="button" onClick={a.clear} className="tap inline-flex items-center gap-1 rounded-full border border-accent/60 bg-accent/10 px-3 min-h-8 text-primary" aria-label="حذف فیلتر">
            {a.label} <X size={13} aria-hidden />
          </button>
        ))}
        {active.length > 0 && (
          <button type="button" onClick={() => setF(defaultFilters)} className="tap text-accent underline underline-offset-4 px-1">
            پاک‌کردن فیلترها
          </button>
        )}
      </div>
    </section>
  );
}
