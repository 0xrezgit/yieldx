'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChoiceCards, type Choice } from '../ui/choice-cards';
import { ChevronDown, Database, ExternalLink, Gift, Layers, Loader2, RefreshCw, Repeat, Search, Trophy } from 'lucide-react';
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
import { ghostAction, primaryAction, Rank, secondaryAction, Tags } from './RowParts';
import { Confidence } from './Confidence';

type View = 'all' | 'yt' | 'loop';

interface Stored {
  capital: number | null;
  horizon: HorizonDays;
  /** The unified ranking, or the separate YT dollar ranking beside it. */
  view: View;
}

/** Results show at once: until the user types a capital, the field holds this (editable) amount. */
const START_CAPITAL = 1000;

const isView = (v: unknown): v is View => v === 'all' || v === 'yt' || v === 'loop';

/** Saved settings, then the address (`?view=yt|loop`, `?q=`) — links from the learn section land on a view or a search. */
function restore(): Stored & { query: string } {
  const s = readLocal<Partial<Stored>>(STORAGE_KEYS.market, {});
  const params = new URLSearchParams(window.location.search);
  const capital = typeof s.capital === 'number' && Number.isFinite(s.capital) && s.capital > 0 ? s.capital : START_CAPITAL;
  const linked = params.get('view');
  return {
    capital,
    horizon: isHorizon(s.horizon) ? s.horizon : DEFAULT_HORIZON,
    view: isView(linked) ? linked : isView(s.view) ? s.view : 'all',
    query: params.get('q') ?? '',
  };
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
  const loss = e.net !== null && e.net < 0;
  return (
    <li className="py-3">
      <div className="line-row">
        <button type="button" onClick={onToggle} aria-expanded={open} className="l-id flex items-center gap-2.5 min-w-0 text-right rounded-lg">
          <Rank n={rank} />
          <span className="min-w-0 flex-1">
            <Identity row={row} />
          </span>
        </button>
        <div className="l-stats flex items-center gap-3 text-xs text-secondary min-w-0">
          <span className="flex flex-col leading-tight">
            <span className="text-muted">بازده دوره</span>
            <span className={`text-sm font-semibold ${loss ? 'text-danger' : 'text-primary'}`}>{e.netPct === null ? '—' : <Num>{formatPercent(e.netPct, 2)}</Num>}</span>
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-muted">خروج</span>
            <span className="text-sm text-primary truncate">{exitShort(e, row.o)}</span>
          </span>
        </div>
        <div className="l-pnl flex flex-col items-end gap-0.5">
          <span className={`text-lg font-semibold leading-tight ${loss ? 'text-danger' : 'text-success'}`}>{e.net === null ? '—' : <Num>{usd(e.net)}</Num>}</span>
          {e.range && Math.abs(e.range.high - e.range.low) >= 0.5 ? (
            <span className="text-[11px] text-muted">
              بدبینانه <Num>{usd(e.range.low)}</Num>
            </span>
          ) : (
            <Confidence confidence={e.confidence} why={e.confidence === 'suspect' ? e.assumptions.slice(0, 1) : undefined} />
          )}
        </div>
        <div className="l-act flex items-center gap-1.5">
          {row.o.url && (
            <a href={row.o.url} target="_blank" rel="noopener noreferrer" className={`${ghostAction} grow`} aria-label={`ورود به بازار در ${row.o.protocol.name}`}>
              <ExternalLink size={14} aria-hidden /> ورود
            </a>
          )}
          <button type="button" onClick={onToggle} aria-expanded={open} className={`${ghostAction} ${row.o.url ? '' : 'grow'}`}>
            جزئیات
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </div>
        {(danger.length > 0 || tags.length > 0) && (
          <div className="l-tags">
            <Tags>
              {danger.map((t) => (
                <Pill key={t} tone="danger">
                  {t}
                </Pill>
              ))}
              {tags.slice(0, 2).map((t) => (
                <Pill key={t} tone="warning">
                  {t}
                </Pill>
              ))}
            </Tags>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-default bg-canvas p-3 sm:p-4">
          <OpportunityDetails row={row} days={days} modelVersion={modelVersion} />
        </div>
      )}
    </li>
  );
}

const VIEWS: Choice<View>[] = [
  { id: 'all', icon: Layers, title: 'همه‌ی فرصت‌ها', text: 'وام‌دهی، خزانه، PT و YT — به ترتیب سود خالص دلاری' },
  { id: 'yt', icon: Gift, title: <>دلاری <bdi dir="ltr">YT</bdi></>, text: 'خرید YT و فروش در بهترین روز، با سه سناریوی بازده' },
  { id: 'loop', icon: Repeat, title: <>لوپ <bdi dir="ltr">PT</bdi></>, text: 'PT با اهرم روی بازار وام واقعی، تا سررسید' },
];

/** The one answer most visits come for: the best net dollars for this capital and horizon. */
function BestPick({ row, days, capital, modelVersion }: { row: Evaluated; days: HorizonDays; capital: number; modelVersion: string }) {
  const [open, setOpen] = useState(false);
  const e = row.byHorizon[days];
  if (e.net === null) return null;
  return (
    <section className="spotlight p-4 sm:p-6 flex flex-col gap-4" aria-label="بهترین فرصت">
      <div className="flex items-center gap-2 text-sm text-accent font-medium">
        <Trophy size={16} aria-hidden /> بهترین سود دلاری برای <Num>{usd(capital)}</Num> در <Num>{formatNumber(days, 0)}</Num> روز
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <Identity row={row} />
        <div className="flex flex-col sm:items-end">
          <span className={`hero-num font-semibold ${e.net >= 0 ? 'text-success' : 'text-danger'}`}>
            <Num>{usd(e.net)}</Num>
          </span>
          <span className="text-sm text-secondary">
            {e.netPct !== null && <><Num>{formatPercent(e.netPct, 2)}</Num> در دوره · </>}
            {exitShort(e, row.o)}
          </span>
          {e.range && Math.abs(e.range.high - e.range.low) >= 0.5 && (
            <span className="text-xs text-muted">
              بدبینانه <Num>{usd(e.range.low)}</Num> · خوش‌بینانه <Num>{usd(e.range.high)}</Num>
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.o.url && (
          <a href={row.o.url} target="_blank" rel="noopener noreferrer" className={`${primaryAction} grow sm:grow-0`}>
            <ExternalLink size={15} aria-hidden /> {isAppRoot(row.o.url) ? <>اپ <bdi dir="ltr">{row.o.protocol.name}</bdi></> : 'ورود به بازار'}
          </a>
        )}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={secondaryAction}>
          جزئیات و شبیه‌سازی
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="rounded-xl border border-default bg-canvas p-3 sm:p-4">
          <OpportunityDetails row={row} days={days} modelVersion={modelVersion} />
        </div>
      )}
    </section>
  );
}

/**
 * «تحلیل بازار»: capital and horizon, three rankings (every opportunity, YT in dollars,
 * PT loops) as cards, the best pick on top and the ranked list under it. Not split by
 * platform: each row carries its protocol's logo and the link into it.
 */
export default function MarketAnalysis() {
  const [st, setSt] = useState<Stored | null>(null);
  const [filter, setFilter] = useState<FamilyFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const { query: q, ...saved } = restore();
    setSt(saved);
    setQuery(q);
  }, []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.market, st);
  }, [st]);

  const capital = st?.capital ?? 0;
  const days = st?.horizon ?? DEFAULT_HORIZON;
  const m = useMarketAnalysis(capital);
  const view = useMemo(() => (m.analysis ? selectHorizon(m.analysis, days, filter, normalizeSearch(query)) : null), [m.analysis, days, filter, query]);
  const mode: View = st?.view ?? 'all';
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
  const best = !view?.narrowed && top.length ? m.analysis!.rowByKey.get(top[0].key) : undefined;
  const list = best ? top.slice(1) : top;
  const offset = best ? 1 : 0;
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const shown = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-5 lg:py-8 flex flex-col gap-4 lg:gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="page-title">تحلیل بازار</h1>
          <p className="page-sub">سرمایه و مدت را بدهید؛ بازارها به ترتیب سود خالص دلاری می‌آیند.</p>
        </div>
        <button type="button" onClick={m.refresh} disabled={m.refreshing} className="tap shrink-0 inline-flex items-center gap-1.5 rounded-md border border-default px-3 min-h-9 text-xs font-medium text-muted hover:text-primary hover:bg-elevated disabled:opacity-60" aria-label="به‌روزرسانی داده‌ها">
          <RefreshCw size={14} className={m.refreshing ? 'animate-spin' : ''} aria-hidden />
          {m.updatedAt ? formatAgo(m.updatedAt) : 'به‌روزرسانی'}
        </button>
      </header>

      <section className="sx-card p-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 md:items-end" aria-label="سرمایه و مدت">
        <NumberField label="سرمایه" value={st.capital ?? NaN} onChange={(v) => setSt({ ...st, capital: Number.isFinite(v) && v > 0 ? v : null })} suffix="دلار" placeholder="مثلاً ۱۰۰۰" />
        {mode === 'all' ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">مدت نگه‌داری</span>
            <Segmented<`${HorizonDays}`>
              value={`${days}`}
              onChange={(v) => setSt({ ...st, horizon: Number(v) as HorizonDays })}
              label="مدت نگه‌داری"
              options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))}
            />
          </div>
        ) : (
          <p className="text-sm text-muted md:pb-3">{mode === 'yt' ? 'مدت را خود رتبه‌بندی انتخاب می‌کند: بهترین روز فروش هر YT.' : 'هر لوپ تا سررسید همان PT نگه داشته می‌شود.'}</p>
        )}
      </section>

      <ChoiceCards value={mode} onChange={(v) => setSt({ ...st, view: v })} options={VIEWS} label="رتبه‌بندی" />

      {mode !== 'all' && (m.loading && !m.markets.length ? <div className="h-40 rounded-xl bg-surface border border-default animate-pulse" aria-busy="true" /> : <LeaderRanking key={mode} markets={m.markets} capital={capital} strategy={mode as Exclude<View, 'all'>} lending={m.lending} />)}
      {mode === 'all' && (
        <>
          {!(capital > 0) ? (
            <Empty>سرمایه را وارد کنید.</Empty>
          ) : m.loading || (!m.analysis && !m.failed) ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <div className="h-44 rounded-2xl bg-surface border border-default animate-pulse" />
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-20 rounded-xl bg-surface border border-default animate-pulse" />
              ))}
            </div>
          ) : m.failed ? (
            <Empty>منبعی پاسخ نداد.</Empty>
          ) : (
            <>
              {best && <BestPick key={best.o.key} row={best} days={days} capital={capital} modelVersion={m.analysis!.modelVersion} />}

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

              {!top.length ? (
                <Empty>برای این سرمایه و مدت فرصت سودده‌ای پیدا نشد.</Empty>
              ) : (
                list.length > 0 && (
                  <section aria-label="رتبه‌بندی" aria-busy={m.pending} className={`sx-card px-3 pt-3 sm:px-5 sm:pt-4 pb-1 transition-opacity ${m.pending ? 'opacity-60' : ''}`}>
                    <h2 className="flex items-baseline justify-between gap-3 pb-1">
                      <span className="font-semibold text-primary">{best ? 'فرصت‌های بعدی' : 'نتیجه‌ی جست‌وجو'}</span>
                      <span className="text-xs text-muted">
                        <Num>{formatNumber(top.length, 0)}</Num> فرصت · سود هر ردیف جداست و جمع‌پذیر نیست
                      </span>
                    </h2>
                    <ol className="rank-list flex flex-col divide-y divide-default">
                      {shown.map((e, i) => {
                        const row = m.analysis!.rowByKey.get(e.key);
                        return row ? <RankingRow key={e.key} row={row} rank={offset + page * PAGE_SIZE + i + 1} days={days} open={open === e.key} onToggle={() => setOpen(open === e.key ? null : e.key)} modelVersion={m.analysis!.modelVersion} /> : null;
                      })}
                    </ol>
                    {pages > 1 && (
                      <nav className="flex items-center justify-center gap-1 pt-3" aria-label="صفحه‌ها">
                        {Array.from({ length: pages }, (_, p) => (
                          <button key={p} type="button" onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined} className={`tap min-w-10 min-h-10 rounded-md text-sm font-medium ${p === page ? 'bg-hover text-primary' : 'text-muted hover:text-primary hover:bg-elevated'}`}>
                            <Num>{formatNumber(p + 1, 0)}</Num>
                          </button>
                        ))}
                      </nav>
                    )}
                  </section>
                )
              )}
            </>
          )}

          <Collapsible title="پوشش داده‌ها" icon={<Database size={18} aria-hidden />}>
            <Coverage sources={m.sources} counts={view?.counts ?? null} total={view?.total ?? 0} />
          </Collapsible>
        </>
      )}
    </main>
  );
}
