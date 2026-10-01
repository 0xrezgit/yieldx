'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Database, ExternalLink, Loader2, RefreshCw, Search, Wrench } from 'lucide-react';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';
import { FAMILY_FILTERS, selectHorizon, type Evaluated, type FamilyFilter } from '../../lib/market/analysis';
import { badgesOf, exitShort, FAMILY_LABEL } from '../../lib/market/labels';
import { isAppRoot } from '../../lib/market/links';
import { flags } from '../../lib/merkl/filters';
import { DEFAULT_HORIZON, HORIZONS, isHorizon, PAGE_SIZE, TOP_LIMIT, type HorizonDays } from '../../lib/opportunity/policy';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { networkByKey } from '../../lib/registry/networks';
import { formatAgo, formatNumber, formatPercent, normalizeSearch } from '../../lib/utils/formatting';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { LogoWithNetwork } from '../ui/asset-identity';
import { Collapsible } from '../ui/card';
import { Empty, Pill, Segmented } from '../opportunities/parts';
import { OpportunityDetails, usd } from './OpportunityDetails';
import { Coverage } from './Coverage';
import { LeaderRanking } from './LeaderRanking';
import { StepStrip } from './ActionPlan';
import { primaryAction, Rank, secondaryAction, Stats, Tags } from './RowParts';
import { Confidence } from './Confidence';
import { stepsFor } from '../../lib/market/steps';

type View = 'all' | 'yt' | 'loop';

interface Stored {
  capital: number | null;
  horizon: HorizonDays;
  /** The unified ranking, or the separate YT dollar ranking beside it. */
  view: View;
}

/** Only the capital the user typed is kept — never a sample value presented as theirs. */
function restore(): Stored {
  const s = readLocal<Partial<Stored>>(STORAGE_KEYS.market, {});
  const capital = typeof s.capital === 'number' && Number.isFinite(s.capital) && s.capital > 0 ? s.capital : null;
  return { capital, horizon: isHorizon(s.horizon) ? s.horizon : DEFAULT_HORIZON, view: s.view === 'yt' || s.view === 'loop' ? s.view : 'all' };
}

function Identity({ row }: { row: Evaluated }) {
  const { o } = row;
  const net = networkByKey(o.chain);
  const symbol = o.assets.deposit[0]?.symbol ?? o.market.name;
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <LogoWithNetwork icon={o.icon} name={symbol} chain={net.name} size={32} />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold text-primary min-w-0">
          <bdi dir="ltr" className="truncate">
            {symbol}
          </bdi>
          <span className="text-secondary font-normal">·</span>
          <bdi dir="ltr" className="text-secondary font-normal shrink-0">
            {o.protocol.name}
          </bdi>
        </span>
        <span className="text-xs text-secondary truncate mt-0.5">
          {FAMILY_LABEL[o.family] ?? o.family} · {net.nameFa} · <bdi>{o.market.name}</bdi>
        </span>
      </span>
    </span>
  );
}

export function RankingRow({ row, rank, days, open, onToggle, modelVersion }: { row: Evaluated; rank: number; days: HorizonDays; open: boolean; onToggle: () => void; modelVersion: string }) {
  const e = row.byHorizon[days];
  const tags = badgesOf(e, row.o);
  // Serious Merkl risk flags (memecoin, hack history, access rules) come first, in red.
  const danger = [...new Set(row.merkl.flatMap((m) => flags(m).filter((f) => f.tone === 'danger').map((f) => f.label)))].slice(0, 1);
  const steps = stepsFor(row.o, e);
  const loss = e.net !== null && e.net < 0;
  return (
    <li className="py-4">
      <div className="rank-row no-facts">
        <button type="button" onClick={onToggle} aria-expanded={open} className="a-id flex items-start gap-2.5 min-w-0 text-right rounded-lg">
          <span className="mt-1.5">
            <Rank n={rank} />
          </span>
          <span className="min-w-0 flex-1">
            <Identity row={row} />
          </span>
        </button>
        <div className="a-pnl flex flex-col items-end gap-1">
          <span className={`text-xl font-bold leading-tight ${loss ? 'text-danger' : 'text-success'}`}>{e.net === null ? '—' : <Num>{usd(e.net)}</Num>}</span>
          <Confidence confidence={e.confidence} why={e.confidence === 'suspect' ? e.assumptions.slice(0, 1) : undefined} />
        </div>

        <div className="a-stats flex flex-col gap-1.5">
          <Stats
            items={[
              { label: 'بازده دوره', value: e.netPct === null ? '—' : <Num>{formatPercent(e.netPct, 2)}</Num>, tone: loss ? 'text-danger' : 'text-success' },
              { label: 'خروج', value: exitShort(e, row.o) },
              { label: 'افق', value: <><Num>{formatNumber(days, 0)}</Num> روز</> },
            ]}
          />
          {e.range && Math.abs(e.range.high - e.range.low) >= 0.5 && (
            <p className="text-xs text-muted">
              بازه <Num>{usd(e.range.low)}</Num> تا <Num>{usd(e.range.high)}</Num>
            </p>
          )}
        </div>

        <div className="a-path flex flex-col gap-2.5 min-w-0">
          <StepStrip steps={steps} />
          {(danger.length > 0 || tags.length > 0) && (
            <Tags>
              {danger.map((t) => (
                <Pill key={t} tone="danger">
                  {t}
                </Pill>
              ))}
              {tags.map((t) => (
                <Pill key={t} tone="warning">
                  {t}
                </Pill>
              ))}
            </Tags>
          )}
        </div>

        <div className="a-act flex items-center gap-2">
          {row.o.url && (
            <a href={row.o.url} target="_blank" rel="noopener noreferrer" className={`${primaryAction} flex-1`}>
              <ExternalLink size={15} aria-hidden /> {isAppRoot(row.o.url) ? <>اپ <bdi dir="ltr">{row.o.protocol.name}</bdi></> : 'ورود به بازار'}
            </a>
          )}
          <button type="button" onClick={onToggle} aria-expanded={open} className={`${secondaryAction} ${row.o.url ? '' : 'flex-1'}`}>
            جزئیات
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-default bg-canvas p-3 sm:p-4">
          <OpportunityDetails row={row} days={days} modelVersion={modelVersion} />
        </div>
      )}
    </li>
  );
}

/** «تحلیل بازار»: the capital, four horizons, one ranking of at most sixty opportunities by estimated net dollars. */
export default function MarketAnalysis() {
  const [st, setSt] = useState<Stored | null>(null);
  const [filter, setFilter] = useState<FamilyFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setSt(restore()), []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.market, st);
  }, [st]);

  const capital = st?.capital ?? 0;
  const days = st?.horizon ?? DEFAULT_HORIZON;
  const m = useMarketAnalysis(capital);
  const view = useMemo(() => (m.analysis ? selectHorizon(m.analysis, days, filter, normalizeSearch(query)) : null), [m.analysis, days, filter, query]);
  // A new capital, horizon or domain starts from the first page.
  useEffect(() => setPage(0), [capital, days, filter, query]);

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }

  const top = view?.ranking.top ?? [];
  const pages = Math.max(1, Math.ceil(top.length / PAGE_SIZE));
  const shown = top.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-5 lg:py-8 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="page-title">تحلیل بازار</h1>
          <p className="page-sub">فرصت‌ها به ترتیب سود خالص دلاری</p>
        </div>
        <button type="button" onClick={m.refresh} disabled={m.refreshing} className="tap shrink-0 inline-flex items-center gap-1.5 rounded-md border border-default px-3 min-h-9 text-xs font-medium text-muted hover:text-primary hover:bg-raised disabled:opacity-60" aria-label="به‌روزرسانی داده‌ها">
          <RefreshCw size={14} className={m.refreshing ? 'animate-spin' : ''} aria-hidden />
          {m.updatedAt ? formatAgo(m.updatedAt) : 'به‌روزرسانی'}
        </button>
      </header>

      <Segmented<View>
        value={st.view}
        onChange={(view) => setSt({ ...st, view })}
        label="رتبه‌بندی"
        options={[
          { id: 'all', label: 'همه‌ی فرصت‌ها' },
          { id: 'yt', label: <>دلاری <bdi dir="ltr">YT</bdi></> },
          { id: 'loop', label: <>لوپ <bdi dir="ltr">PT</bdi></> },
        ]}
      />

      <section className="sx-card p-4 flex flex-col gap-3" aria-label="سرمایه و افق">
        <NumberField label="سرمایه‌ی اولیه" value={st.capital ?? NaN} onChange={(v) => setSt({ ...st, capital: Number.isFinite(v) && v > 0 ? v : null })} suffix="دلار" placeholder="مثلاً ۱۰۰۰" />
        {st.view === 'all' && (
          <Segmented<`${HorizonDays}`>
            value={`${days}`}
            onChange={(v) => setSt({ ...st, horizon: Number(v) as HorizonDays })}
            label="افق"
            options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))}
          />
        )}
      </section>

      {st.view !== 'all' && (m.loading && !m.markets.length ? <div className="h-40 rounded-lg bg-surface border border-default animate-pulse" aria-busy="true" /> : <LeaderRanking key={st.view} markets={m.markets} capital={capital} strategy={st.view} lending={m.lending} />)}
      {st.view === 'all' && (
        <>

      <p className="text-xs text-secondary">سود هر ردیف جداست و جمع‌پذیر نیست.</p>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">جست‌وجو</span>
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی نماد، پروتکل یا شبکه" className="w-full pr-9 pl-3 text-sm" />
        </label>
        <div className="min-w-0 sm:w-auto">
          <Segmented<FamilyFilter> value={filter} onChange={setFilter} label="نوع" size="sm" options={FAMILY_FILTERS} />
        </div>
      </div>

      {!(capital > 0) ? (
        <Empty>سرمایه‌ی اولیه را وارد کنید.</Empty>
      ) : m.loading || (!m.analysis && !m.failed) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : m.failed ? (
        <Empty>منبعی پاسخ نداد.</Empty>
      ) : !top.length ? (
        <Empty>برای این سرمایه و افق فرصت سودده‌ای پیدا نشد.</Empty>
      ) : (
        <section aria-label="رتبه‌بندی" aria-busy={m.pending} className={`sx-card px-3 pt-3 sm:px-4 sm:pt-4 pb-1 transition-opacity ${m.pending ? 'opacity-60' : ''}`}>
          <h2 className="flex items-start justify-between gap-3 pb-1">
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold text-primary">
                سود خالص <Num>{formatNumber(days, 0)}</Num> روزه
              </span>
              <span className="text-xs text-secondary">
                <Num>{formatNumber(top.length, 0)}</Num> فرصت برتر {view?.narrowed ? 'در همین دامنه' : 'بین بازارهای بررسی‌شده'} · حداکثر <Num>{formatNumber(TOP_LIMIT, 0)}</Num>
              </span>
            </span>
          </h2>
          <ol className="rank-list flex flex-col divide-y divide-default">
            {shown.map((e, i) => {
              const row = m.analysis!.rowByKey.get(e.key);
              return row ? <RankingRow key={e.key} row={row} rank={page * PAGE_SIZE + i + 1} days={days} open={open === e.key} onToggle={() => setOpen(open === e.key ? null : e.key)} modelVersion={m.analysis!.modelVersion} /> : null;
            })}
          </ol>
          {pages > 1 && (
            <nav className="flex items-center justify-center gap-1 pt-3" aria-label="صفحه‌ها">
              {Array.from({ length: pages }, (_, p) => (
                <button key={p} type="button" onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined} className={`tap min-w-10 min-h-10 rounded-md text-sm font-medium ${p === page ? 'bg-hover text-primary' : 'text-muted hover:text-primary hover:bg-raised'}`}>
                  <Num>{formatNumber(p + 1, 0)}</Num>
                </button>
              ))}
            </nav>
          )}
        </section>
      )}

      <Collapsible title="پوشش داده‌ها" icon={<Database size={18} aria-hidden />}>
        <Coverage sources={m.sources} counts={view?.counts ?? null} total={view?.total ?? 0} />
      </Collapsible>
        </>
      )}

      <Link href="/tools" className="tap self-start inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary">
        <Wrench size={14} aria-hidden /> ابزارهای تخصصی: YT، LP، هزینه‌ی وام
      </Link>
    </main>
  );
}
