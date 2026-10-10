'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, BadgeCheck, ExternalLink, LayoutGrid, Lock, Repeat } from 'lucide-react';
import type { Analysis, Evaluated } from '../../lib/market/analysis';
import { selectHorizon } from '../../lib/market/analysis';
import { PLATFORMS, platformOf, type Platform, type PlatformId } from '../../lib/market/platforms';
import { STRATEGIES, type Strategy, type StrategyId } from '../../lib/market/strategies';
import type { HorizonDays } from '../../lib/opportunity/policy';
import { profitOf, type VerifiedFeed } from '../../lib/llama/verify';
import { txCost } from '../../lib/opportunity/costs';
import { formatNumber } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { usd } from './OpportunityDetails';

export interface PlatformSummary {
  platform: Platform;
  /** Markets read on this platform. */
  total: number;
  /** Ranked with a positive net. */
  ranked: number;
  best: { row: Evaluated; net: number } | null;
}

/** One group's ranking for the horizon: how many rank and the best net dollars. */
function summaryOf(a: Analysis, rows: Evaluated[], days: HorizonDays) {
  const top = selectHorizon({ ...a, rows }, days).ranking.top;
  const first = top[0];
  const row = first ? a.rowByKey.get(first.key) : undefined;
  return { total: rows.length, ranked: top.length, best: row && first.net !== null ? { row, net: first.net } : null };
}

export interface StrategySummary extends Omit<PlatformSummary, 'platform'> {
  strategy: Strategy;
}

/** The PT and PT-loop sections' summaries, across platforms. */
export function summarizeStrategies(a: Analysis | null, days: HorizonDays): Map<StrategyId, StrategySummary> {
  const out = new Map<StrategyId, StrategySummary>();
  for (const st of STRATEGIES) out.set(st.id, { strategy: st, ...(a ? summaryOf(a, a.rows.filter((r) => st.test(r.o)), days) : { total: 0, ranked: 0, best: null }) });
  return out;
}

/** Each platform's ranking for the horizon: how many rank and the best net dollars. */
export function summarize(a: Analysis | null, days: HorizonDays): Map<PlatformId, PlatformSummary> {
  const out = new Map<PlatformId, PlatformSummary>();
  for (const p of PLATFORMS) out.set(p.id, { platform: p, total: 0, ranked: 0, best: null });
  if (!a) return out;
  const groups = new Map<PlatformId, Evaluated[]>();
  for (const r of a.rows) {
    const id = platformOf(r.o);
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  for (const [id, rows] of groups) out.set(id, { platform: out.get(id)!.platform, ...summaryOf(a, rows, days) });
  return out;
}

/** Narrow the analysis to one section's rows (a platform or a strategy). */
export const scopeTo = (a: Analysis | null, keep: ((r: Evaluated) => boolean) | null): Analysis | null => (a && keep ? { ...a, rows: a.rows.filter(keep) } : a);

export const STRATEGY_ICON: Record<StrategyId, typeof Lock> = { pt: Lock, loop: Repeat };

const symbolOf = (row: Evaluated) => row.o.assets.deposit[0]?.symbol ?? row.o.market.name;

/** Sticky switch between «All», each platform and the verified vaults. */
export function PlatformStrip({ summaries, strategies }: { summaries: Map<PlatformId, PlatformSummary>; strategies: Map<StrategyId, StrategySummary> }) {
  const pathname = usePathname();
  const item = (href: string, active: boolean, content: ReactNode, key: string) => (
    <Link
      key={key}
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`tap shrink-0 inline-flex items-center gap-2 rounded-full border px-3 min-h-9 text-sm font-medium transition-colors ${active ? 'border-accent/60 bg-accent/10 text-primary' : 'border-default bg-surface text-secondary hover:text-primary hover:bg-raised'}`}
    >
      {content}
    </Link>
  );
  return (
    <nav className="sticky below-header z-20 -mx-[var(--space-page-x)] px-[var(--space-page-x)] py-2 bg-canvas/95 backdrop-blur" aria-label="پلتفرم‌ها">
      <div className="strip flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
        {item('/', pathname === '/', <><LayoutGrid size={15} aria-hidden /> همه</>, 'all')}
        {STRATEGIES.map((st) => {
          const Icon = STRATEGY_ICON[st.id];
          const n = strategies.get(st.id)?.ranked ?? 0;
          return item(
            `/s/${st.id}`,
            pathname === `/s/${st.id}`,
            <>
              <Icon size={15} className="text-accent" aria-hidden /> {st.name}
              {n > 0 && (
                <span className="text-xs text-muted">
                  <Num>{formatNumber(n, 0)}</Num>
                </span>
              )}
            </>,
            st.id,
          );
        })}
        <span className="shrink-0 self-center w-px h-5 bg-default" aria-hidden />
        {PLATFORMS.map((p) => {
          const s = summaries.get(p.id);
          return item(
            `/p/${p.id}`,
            pathname === `/p/${p.id}`,
            <>
              <TokenLogo src={p.logo} name={p.name} size={18} />
              <bdi dir="ltr">{p.name}</bdi>
              {s && s.ranked > 0 && (
                <span className="text-xs text-muted">
                  <Num>{formatNumber(s.ranked, 0)}</Num>
                </span>
              )}
            </>,
            p.id,
          );
        })}
        {item('/tools?tab=verified', false, <><BadgeCheck size={15} className="text-accent" aria-hidden /> تأییدشده روی زنجیره</>, 'verified')}
      </div>
    </nav>
  );
}

/** One card per platform: its best net dollars for the capital and horizon, and how many rank. */
export function PlatformCards({ summaries, strategies, capital, days }: { summaries: Map<PlatformId, PlatformSummary>; strategies: Map<StrategyId, StrategySummary>; capital: number; days: HorizonDays }) {
  const list = [...summaries.values()].filter((s) => s.total > 0).sort((a, b) => (b.best?.net ?? -Infinity) - (a.best?.net ?? -Infinity));
  return (
    <>
    <section aria-label="استراتژی‌ها" className="flex flex-col gap-3">
      <h2 className="font-semibold text-primary">استراتژی‌ها</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[...strategies.values()].map((s) => {
          const Icon = STRATEGY_ICON[s.strategy.id];
          return (
            <li key={s.strategy.id}>
              <Link href={`/s/${s.strategy.id}`} className="group sx-card p-4 h-full flex flex-col gap-3 hover:bg-raised/40 transition-colors border-accent/30">
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="grid place-items-center size-8 rounded-full bg-accent/15 text-accent shrink-0">
                    <Icon size={17} aria-hidden />
                  </span>
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="text-[15px] font-semibold text-primary">{s.strategy.name}</span>
                    <span className="text-xs text-secondary truncate">{s.strategy.what}</span>
                  </span>
                  <ArrowLeft size={16} className="ms-auto shrink-0 text-muted group-hover:text-accent transition-colors" aria-hidden />
                </span>
                {s.best ? (
                  <span className="flex items-end justify-between gap-3">
                    <span className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-xs text-secondary">بهترین فرصت</span>
                      <bdi dir="ltr" className="text-sm text-primary truncate text-right">
                        {symbolOf(s.best.row)} · {s.best.row.o.protocol.name}
                      </bdi>
                    </span>
                    <span className={`text-xl font-bold leading-none ${s.best.net >= 0 ? 'text-success' : 'text-danger'}`}>
                      <Num>{usd(s.best.net)}</Num>
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-muted">برای این سرمایه و افق فرصت سودده‌ای نیست.</span>
                )}
                <span className="text-xs text-muted border-t border-default pt-2">
                  <Num>{formatNumber(s.ranked, 0)}</Num> فرصت سودده از <Num>{formatNumber(s.total, 0)}</Num>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
    <section aria-label="پلتفرم‌ها" className="flex flex-col gap-3">
      <h2 className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-primary">پلتفرم‌ها</span>
        <span className="text-xs text-secondary">
          بهترین سود خالص <Num>{formatNumber(days, 0)}</Num> روزه با <Num>{usd(capital)}</Num> در هر پلتفرم
        </span>
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((s) => (
          <li key={s.platform.id}>
            <Link href={`/p/${s.platform.id}`} className="group sx-card p-4 h-full flex flex-col gap-3 hover:bg-raised/40 transition-colors">
              <span className="flex items-center gap-2.5 min-w-0">
                <TokenLogo src={s.platform.logo} name={s.platform.name} size={32} />
                <span className="min-w-0 flex flex-col leading-tight">
                  <bdi dir="ltr" className="text-[15px] font-semibold text-primary text-right">
                    {s.platform.name}
                  </bdi>
                  <span className="text-xs text-secondary truncate">{s.platform.what}</span>
                </span>
                <ArrowLeft size={16} className="ms-auto shrink-0 text-muted group-hover:text-accent transition-colors" aria-hidden />
              </span>
              {s.best ? (
                <span className="flex items-end justify-between gap-3">
                  <span className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-xs text-secondary">بهترین فرصت</span>
                    <bdi dir="ltr" className="text-sm text-primary truncate text-right">
                      {symbolOf(s.best.row)}
                    </bdi>
                  </span>
                  <span className={`text-xl font-bold leading-none ${s.best.net >= 0 ? 'text-success' : 'text-danger'}`}>
                    <Num>{usd(s.best.net)}</Num>
                  </span>
                </span>
              ) : (
                <span className="text-sm text-muted">برای این سرمایه و افق فرصت سودده‌ای نیست.</span>
              )}
              <span className="text-xs text-muted border-t border-default pt-2">
                <Num>{formatNumber(s.ranked, 0)}</Num> فرصت سودده از <Num>{formatNumber(s.total, 0)}</Num> بازار
              </span>
            </Link>
          </li>
        ))}
        <li>
          <VerifiedCard capital={capital} days={days} />
        </li>
      </ul>
    </section>
    </>
  );
}

/** The verified vaults (DefiLlama pools checked on-chain) as one more card. */
function VerifiedCard({ capital, days }: { capital: number; days: HorizonDays }) {
  const [feed, setFeed] = useState<VerifiedFeed | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/verified', { signal: c.signal })
      .then((r) => (r.ok ? (r.json() as Promise<VerifiedFeed>) : null))
      .then((f) => f && setFeed(f))
      .catch(() => {});
    return () => c.abort();
  }, []);
  const best = useMemo(() => {
    if (!feed) return null;
    let top: { symbol: string; project: string; net: number } | null = null;
    for (const p of feed.pools) {
      if (p.robust.young) continue;
      const id = feed.chainIds[p.chain];
      // Gas at the stated defaults here; the verified page uses measured gas prices.
      const pr = profitOf(p, capital, days, txCost(id ? `eip155:${id}` : p.chain, ['approve', 'deposit', 'withdraw'], []).usd);
      if (pr && (!top || pr.net > top.net)) top = { symbol: p.symbol, project: p.projectName, net: pr.net };
    }
    return top;
  }, [feed, capital, days]);
  const mature = feed?.pools.filter((p) => !p.robust.young).length ?? 0;
  return (
    <Link href="/tools?tab=verified" className="group sx-card p-4 h-full flex flex-col gap-3 hover:bg-raised/40 transition-colors border-accent/30">
      <span className="flex items-center gap-2.5">
        <span className="grid place-items-center size-8 rounded-full bg-accent/15 text-accent">
          <BadgeCheck size={18} aria-hidden />
        </span>
        <span className="min-w-0 flex flex-col leading-tight">
          <span className="text-[15px] font-semibold text-primary">تأییدشده روی زنجیره</span>
          <span className="text-xs text-secondary truncate">خزانه‌های DefiLlama، بازده و برداشت آزموده</span>
        </span>
        <ExternalLink size={15} className="ms-auto shrink-0 text-muted group-hover:text-accent transition-colors" aria-hidden />
      </span>
      {best ? (
        <span className="flex items-end justify-between gap-3">
          <span className="min-w-0 flex flex-col gap-0.5">
            <span className="text-xs text-secondary">بهترین خزانه</span>
            <bdi dir="ltr" className="text-sm text-primary truncate text-right">
              {best.symbol} · {best.project}
            </bdi>
          </span>
          <span className={`text-xl font-bold leading-none ${best.net >= 0 ? 'text-success' : 'text-danger'}`}>
            <Num>{usd(best.net)}</Num>
          </span>
        </span>
      ) : (
        <span className="text-sm text-muted">{feed ? 'هنوز خزانه‌ای تأیید نشده است.' : 'در حال دریافت…'}</span>
      )}
      <span className="text-xs text-muted border-t border-default pt-2">
        <Num>{formatNumber(mature, 0)}</Num> خزانه‌ی تأییدشده
      </span>
    </Link>
  );
}

/** A platform page's header: who it is, a link to it, and its best result. */
export function PlatformHeader({ platform, summary, days }: { platform: Platform; summary: PlatformSummary | undefined; days: HorizonDays }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <TokenLogo src={platform.logo} name={platform.name} size={44} />
      <div className="min-w-0 flex flex-col gap-1">
        <h1 className="page-title flex items-center gap-2">
          <bdi dir="ltr">{platform.name}</bdi>
          <a href={platform.site} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent" aria-label={`سایت ${platform.name}`}>
            <ExternalLink size={16} aria-hidden />
          </a>
        </h1>
        <p className="page-sub">{platform.what}</p>
        {summary && (
          <p className="text-xs text-secondary flex flex-wrap gap-x-3 gap-y-1">
            <span>
              <Num>{formatNumber(summary.total, 0)}</Num> بازار
            </span>
            <span>
              <Num>{formatNumber(summary.ranked, 0)}</Num> فرصت سودده در <Num>{formatNumber(days, 0)}</Num> روز
            </span>
            {summary.best && (
              <span>
                بهترین <b className="text-success">{<Num>{usd(summary.best.net)}</Num>}</b>
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/** A strategy page's header: what it is, how it works, and its best result. */
export function StrategyHeader({ strategy, summary, days }: { strategy: Strategy; summary: StrategySummary | undefined; days: HorizonDays }) {
  const Icon = STRATEGY_ICON[strategy.id];
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className="grid place-items-center size-11 rounded-full bg-accent/15 text-accent shrink-0">
        <Icon size={22} aria-hidden />
      </span>
      <div className="min-w-0 flex flex-col gap-1">
        <h1 className="page-title">{strategy.name}</h1>
        <p className="page-sub">{strategy.what}</p>
        <p className="text-xs text-secondary leading-6 max-w-3xl">{strategy.how}</p>
        {summary && (
          <p className="text-xs text-secondary flex flex-wrap gap-x-3 gap-y-1">
            <span>
              <Num>{formatNumber(summary.total, 0)}</Num> فرصت
            </span>
            <span>
              <Num>{formatNumber(summary.ranked, 0)}</Num> سودده در <Num>{formatNumber(days, 0)}</Num> روز
            </span>
            {summary.best && (
              <span>
                بهترین <b className="text-success">{<Num>{usd(summary.best.net)}</Num>}</b>
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
