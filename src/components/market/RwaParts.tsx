'use client';

import { AlertTriangle, ExternalLink, Landmark, Lock } from 'lucide-react';
import type { Opportunity, RwaInfo } from '../../types/opportunity';
import type { Evaluated } from '../../lib/market/analysis';
import { RWA_RISKS } from '../../lib/opportunity/rwa';
import { PT_LOOP_POLICY } from '../../lib/opportunity/policy';
import { networkByKey } from '../../lib/registry/networks';
import { formatNumber, formatPercent } from '../../lib/utils/formatting';
import { LogoWithNetwork } from '../ui/asset-identity';
import { Num } from '../ui/num';
import { Pill } from '../opportunities/parts';

/** The cautious leverage an RWA loop is costed at (its NAV is not a peg). */
const RWA_LEVERAGE = PT_LOOP_POLICY.cautiousLeverage;

/** Who issues the RWA, what backs it and what can go wrong — in a loop's details. */
export function RwaCallout({ rwa }: { rwa: RwaInfo }) {
  return (
    <section className="rounded-xl border border-warning/35 bg-warning/6 p-3 flex flex-col gap-2" aria-label="ریسک دارایی RWA">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary">
        <Landmark size={15} className="text-warning" aria-hidden /> دارایی واقعی (RWA)
        <span className="text-secondary font-normal">
          · <bdi dir="ltr">{rwa.issuer}</bdi>
        </span>
      </h3>
      <p className="text-secondary">پشتوانه: {rwa.backing}. اهرم محتاط (حداکثر <Num>{formatNumber(RWA_LEVERAGE, 1)}×</Num>) حساب شده، نه سقف پروتکل.</p>
      <ul className="flex flex-col gap-1.5 text-xs text-secondary leading-6">
        {RWA_RISKS.map((r) => (
          <li key={r} className="flex gap-1.5">
            <AlertTriangle size={13} className="text-warning shrink-0 mt-1" aria-hidden />
            <span>{r}</span>
          </li>
        ))}
      </ul>
      {rwa.url && (
        <a href={rwa.url} target="_blank" rel="noopener noreferrer" className="tap self-start inline-flex items-center gap-1 text-xs text-accent min-h-9">
          سایت صادرکننده <ExternalLink size={12} aria-hidden />
        </a>
      )}
    </section>
  );
}

/** What the «RWA» filter shows above its list. */
export function RwaIntro({ ranked, waiting }: { ranked: number; waiting: number }) {
  return (
    <section className="sx-card p-4 flex flex-col gap-2" aria-label="لوپ‌های RWA">
      <h2 className="flex items-center gap-2 font-semibold text-primary">
        <Landmark size={18} className="text-warning" aria-hidden /> لوپ روی دارایی‌های واقعی
      </h2>
      <p className="text-sm text-secondary leading-7">
        توکن‌هایی با پشتوانه‌ی بیمه‌ی اتکایی، وام خودرو و مسکن یا تأمین مالی تجاری، که با وام دلاری لوپ می‌شوند. بازده بالا دارند، ولی ارزششان NAV صادرکننده است و می‌تواند یک‌باره پایین بیاید. اپ آن‌ها را با اهرم محتاط (<Num>{formatNumber(RWA_LEVERAGE, 1)}×</Num>) حساب می‌کند.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="success">
          <Num>{formatNumber(ranked, 0)}</Num> قابل ورود
        </Pill>
        {waiting > 0 && (
          <Pill tone="muted">
            <Lock size={11} aria-hidden /> <Num>{formatNumber(waiting, 0)}</Num> با ظرفیت پر
          </Pill>
        )}
      </div>
    </section>
  );
}

/** Carry a year at the cautious leverage, %: L × yield − (L − 1) × borrow. */
const carryOf = (o: Opportunity) => {
  const l = o.loop!;
  const cap = l.borrowLtv ?? l.maxLtv;
  const L = Math.min(RWA_LEVERAGE, cap > 0 && cap < 1 ? 1 / (1 - cap) : RWA_LEVERAGE);
  const y = l.collateral.yield.pct + (l.collateral.supplyPct ?? 0);
  const b = l.debt.side.ratePct ?? 0;
  return { L, apy: L * y - (L - 1) * b, y, b, max: cap > 0 && cap < 1 ? 1 / (1 - cap) : null };
};

/**
 * RWA loops whose market cannot lend now (its borrow cap is full): not in the ranking, but
 * worth knowing — Kamino frees capacity in steps, and they come back on their own.
 */
export function RwaWaiting({ rows }: { rows: Evaluated[] }) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => carryOf(b.o).apy - carryOf(a.o).apy);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="rwa-waiting">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 px-1">
        <h2 id="rwa-waiting" className="font-semibold text-primary flex items-center gap-1.5 shrink-0">
          <Lock size={15} className="text-muted" aria-hidden /> ظرفیت وام پر
        </h2>
        <span className="text-xs text-muted">در رتبه‌بندی نیستند؛ با آزاد شدن ظرفیت خودشان برمی‌گردند</span>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {sorted.map(({ o }) => {
          const l = o.loop!;
          const c = carryOf(o);
          const net = networkByKey(o.chain);
          const fixed = l.debt.side.fixedTermDays;
          return (
            <li key={o.key} className="sx-card p-3.5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2.5 min-w-0">
                  <LogoWithNetwork icon={o.icon} name={l.collateral.token.symbol ?? ''} chain={net.name} size={32} />
                  <span className="flex flex-col min-w-0 leading-tight">
                    <span className="font-semibold text-primary truncate">
                      <bdi dir="ltr">{l.collateral.token.symbol}</bdi> <span className="text-secondary font-normal">با وام</span> <bdi dir="ltr">{l.debt.token.symbol}</bdi>
                    </span>
                    <span className="text-xs text-secondary truncate mt-0.5">
                      <bdi dir="ltr">{l.rwa?.issuer}</bdi> · {l.rwa?.backing}
                    </span>
                  </span>
                </span>
                <Pill tone="muted">
                  <Lock size={11} aria-hidden /> پر
                </Pill>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted">بازده دارایی</dt>
                  <dd className="text-sm font-semibold text-success">
                    <Num>{formatPercent(c.y, 1)}</Num>
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted">{fixed ? `وام ثابت ${formatNumber(Math.round(fixed), 0)} روز` : 'نرخ وام'}</dt>
                  <dd className="text-sm font-semibold text-warning">
                    <Num>{formatPercent(c.b, 2)}</Num>
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted">
                    در <Num>{formatNumber(c.L, 1)}×</Num>
                  </dt>
                  <dd className={`text-sm font-semibold ${c.apy > c.y ? 'text-primary' : 'text-danger'}`}>
                    <Num>{formatPercent(c.apy, 1)}</Num>
                  </dd>
                </div>
              </dl>
              <div className="flex items-center justify-between gap-2 text-xs text-muted border-t border-default pt-2.5">
                <span>
                  <bdi dir="ltr">{o.protocol.name}</bdi> · {net.nameFa}
                  {c.max !== null && (
                    <>
                      {' '}
                      · سقف <Num>{formatNumber(c.max, 1)}×</Num>
                    </>
                  )}
                </span>
                {o.url && (
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1 text-accent min-h-9">
                    بازار <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
