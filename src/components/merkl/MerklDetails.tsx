'use client';

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { hookInfo, merklUrl, RATE_KIND, TOKEN_TYPE } from '../../lib/merkl/rules';
import { campaignTvl, CONSERVATIVE, type CampaignCalc, type CostItem, type Estimate } from '../../lib/merkl/profit';
import type { MerklOpportunity } from '../../lib/merkl/types';
import { formatAgo, formatCompact, formatDate, formatGregorian, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Metric, Pill } from '../opportunities/parts';
import { FlagPills, ProtocolLogo, RewardToken, protocolName } from './parts';

const iso = (sec: number) => new Date(sec * 1000).toISOString();
export const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 2 : 4);
export const days = (d: number) => formatNumber(d, d < 3 ? 1 : 0);

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1.5 rounded-lg border border-control px-3 min-h-10 text-sm text-primary hover:bg-elevated">
      {children} <ExternalLink size={13} className="text-muted" aria-hidden />
    </a>
  );
}

const BASIS: Record<CostItem['basis'], { label: string; tone: 'success' | 'warning' | 'info' }> = {
  measured: { label: 'اندازه‌گیری‌شده', tone: 'success' },
  model: { label: 'مدل روی داده‌ی زنده', tone: 'info' },
  assumed: { label: 'فرض شما', tone: 'warning' },
};

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      {children}
    </section>
  );
}

/** One campaign: its own rate, end and what it gives this capital. */
function CampaignCard({ x, o }: { x: CampaignCalc; o: MerklOpportunity }) {
  const c = x.c;
  const { tvl, derived } = campaignTvl(c, o);
  const hooks = c.hooks.map(hookInfo);
  const t = c.rewardToken;
  return (
    <li className="rounded-lg border border-default bg-surface p-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary min-w-0">
          <RewardToken t={t} size={20} />
          <Pill tone={t.type === 'PRETGE' ? 'warning' : t.type === 'POINT' ? 'info' : 'muted'}>{TOKEN_TYPE[t.type]}</Pill>
        </span>
        <span className="text-xs text-secondary" title={`میلادی: ${formatGregorian(iso(c.end))}`}>
          پایان {formatDate(iso(c.end))} · <Num>{days(x.daysToEnd)}</Num> روز مانده
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="APR کمپین (Merkl)" hint="میانگین همه">
          <Num>{formatPercent(c.apr, 2)}</Num>
        </Metric>
        <Metric label="پاداش روزانه‌ی کل کمپین" hint="برای همه، نه شما">
          {t.type === 'TOKEN' && c.dailyUsd > 0 ? <Num>{usd(c.dailyUsd)}</Num> : c.dailyUnits !== null ? <Num>{formatCompact(c.dailyUnits)}</Num> : <span className="text-muted">—</span>}
        </Metric>
        <Metric label="TVL واجد شرایط" hint={derived ? 'از پاداش و APR کمپین' : 'TVL کل فرصت'}>
          <Num>{formatUSDCompact(tvl)}</Num>
        </Metric>
        <Metric label="سازوکار" hint={c.capApr !== null ? `سقف ${formatPercent(c.capApr, 2)}` : undefined}>
          <span className="text-sm font-normal">{RATE_KIND[c.rateKind]}</span>
        </Metric>
      </div>
      {(hooks.length > 0 || c.whitelistCount > 0) && (
        <div className="flex flex-wrap gap-1">
          {c.whitelistCount > 0 && <Pill tone="danger">فقط آدرس‌های فهرست سفید</Pill>}
          {hooks.map((h, i) => (
            <Pill key={i} tone={h.effect === 'restrict' ? 'danger' : h.effect === 'boost' ? 'warning' : 'muted'}>
              {h.label}
            </Pill>
          ))}
        </div>
      )}
      <div className="rounded-md bg-elevated px-3 py-2 text-sm">
        <div className="text-xs text-secondary mb-0.5">برای سرمایه‌ی شما</div>
        {x.status === 'none' ? (
          <span className="text-xs text-muted">{x.note}</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <span className="text-primary font-semibold">
              {x.usdPerDay !== null ? (
                <>
                  <Num>{usd(x.usdPerDay)}</Num> در روز · <Num>{usd(x.usdPerDay * x.days)}</Num> در <Num>{days(x.days)}</Num> روز · <Num>{usd(x.usdPerDay * x.daysToEnd)}</Num> تا پایان کمپین
                </>
              ) : x.unitsPerDay !== null ? (
                <>
                  <Num>{formatCompact(x.unitsPerDay * x.days)}</Num> <bdi dir="ltr">{t.symbol}</bdi> در <Num>{days(x.days)}</Num> روز (بدون ارزش دلاری)
                </>
              ) : (
                '—'
              )}
            </span>
            {x.apr !== null && (
              <span className="text-xs text-secondary">
                APR مشوق برای شما <Num>{formatPercent(x.apr, 2)}</Num> · قیمت {t.symbol} <Num>{usd(t.price ?? 0)}</Num>
                {t.priceAt !== null && <> ({formatAgo(t.priceAt * 1000)})</>}
              </span>
            )}
            {t.type === 'TOKEN' && !x.price.ok && x.price.reason && <span className="text-xs text-warning">به دلار حساب نشد: {x.price.reason.label}</span>}
            {x.note && <span className="text-xs text-secondary">{x.note}</span>}
          </span>
        )}
      </div>
    </li>
  );
}

/** Links, programs and trust data — shared by every Merkl detail view. */
export function OppFooter({ o }: { o: MerklOpportunity }) {
  return (
    <>
      {o.programs.length > 0 && (
        <p className="text-sm text-secondary">
          برنامه‌ی مرتبط:{' '}
          {o.programs.map((p, i) => (
            <span key={p.slug}>
              {i > 0 && '، '}
              <a href={`https://app.merkl.xyz/programs/${encodeURIComponent(p.slug)}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 text-primary">
                <bdi dir="ltr">{p.name}</bdi>
              </a>
            </span>
          ))}
        </p>
      )}
      {o.howTo.length > 0 && (
        <Section title="نحوه‌ی شرکت (از Merkl)">
          <ol className="list-decimal pl-5 text-sm text-secondary" dir="ltr">
            {o.howTo.map((s, i) => (
              <li key={i} className="text-left">
                {s}
              </li>
            ))}
          </ol>
        </Section>
      )}
      <p className="text-xs text-muted">
        {o.aprAt !== null && <>عکس‌برداری APR و TVL در Merkl {formatAgo(o.aprAt * 1000)}</>}
        {o.protocol && (
          <>
            {' '}
            · ممیزی: {o.protocol.audits === null ? 'نامعلوم' : <Num>{formatNumber(o.protocol.audits, 0)}</Num>}
            {o.protocol.hacks > 0 && (
              <span className="text-danger">
                {' '}
                · <Num>{formatNumber(o.protocol.hacks, 0)}</Num> هک ثبت‌شده
              </span>
            )}
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {o.depositUrl && <ExtLink href={o.depositUrl}>ورود به پروتکل</ExtLink>}
        <ExtLink href={merklUrl(o)}>مشاهده در Merkl</ExtLink>
        {o.protocol?.url && (
          <ExtLink href={o.protocol.url}>
            <ProtocolLogo protocol={o.protocol} size={16} /> <bdi dir="ltr">{protocolName(o.protocol)}</bdi>
          </ExtLink>
        )}
      </div>
    </>
  );
}

/** Everything behind one «top 30» row: the formula with its numbers, costs, campaigns, confidence, risks and links. */
export function EstimateDetails({ e }: { e: Estimate }) {
  const { o } = e;
  const fullyNet = e.unknownCosts.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <bdi dir="ltr" className="text-sm text-primary font-medium text-right">
          {o.name}
        </bdi>
        <FlagPills o={o} max={10} />
      </div>

      <Section title={<>فرمول برای افق <Num>{formatNumber(e.horizon, 0)}</Num> روز</>}>
        <div className="rounded-lg bg-elevated px-3 py-2.5 text-sm leading-8 text-secondary">
          پاداش Merkl <Num className="text-primary">{usd(e.incentiveUsd)}</Num> + بازده بومی <Num className="text-primary">{usd(e.nativeUsd)}</Num> − هزینه‌های لحاظ‌شده <Num className="text-primary">{usd(e.knownCostUsd)}</Num> ={' '}
          <Num className={`font-semibold ${e.net >= 0 ? 'text-success' : 'text-danger'}`}>{usd(e.net)}</Num>
          <div className="text-xs">
            سرمایه‌ی مؤثر پس از هزینه‌ی ورود <Num>{usd(e.deployed)}</Num> از <Num>{usd(e.capital)}</Num>. {e.native.note}
            {e.native.counted && (
              <>
                {' '}
                (<Num>{formatPercent(e.native.apr, 2)}</Num> سالانه)
              </>
            )}
            .
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Metric label="سناریوی پایه" hint="نرخ‌ها و قیمت‌های فعلی">
            <Num>{usd(e.net)}</Num>
          </Metric>
          <Metric label="سناریوی محتاط" hint="فرض‌های پایین‌تر؛ زیر را ببینید">
            <Num>{usd(e.netLow)}</Num>
          </Metric>
          <Metric label="تا پایان اختصاصی کمپین‌ها" hint={<>حدود <Num>{days(e.daysToEnd)}</Num> روز، هر کمپین تا پایان خودش</>}>
            <Num>{usd(e.netToEnd)}</Num>
          </Metric>
        </div>
        <p className="text-xs text-muted leading-6">
          سناریوی محتاط: TVL رقیب <Num>{formatPercent(CONSERVATIVE.tvlUp * 100, 0)}</Num> بیشتر، قیمت توکن پاداش <Num>{formatPercent(CONSERVATIVE.priceDown * 100, 0)}</Num> کمتر و بدون بازده بومی؛ همان هزینه‌ها.
        </p>
      </Section>

      <Section title="هزینه‌ها">
        <ul className="flex flex-col gap-1.5 text-sm">
          {e.costs.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-3">
              <span className="text-secondary flex items-center gap-2 min-w-0">
                <span className="truncate">{c.label}</span> <Pill tone={BASIS[c.basis].tone}>{BASIS[c.basis].label}</Pill>
              </span>
              <Num className="text-primary shrink-0">{usd(c.usd)}</Num>
            </li>
          ))}
        </ul>
        {!fullyNet && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-secondary leading-6">
            <b className="text-warning">خالص پس از هزینه‌های لحاظ‌شده؛</b> این هزینه‌ها اندازه‌گیری‌پذیر نبودند و در عدد نیستند: {e.unknownCosts.join('، ')}.
          </div>
        )}
      </Section>

      <Section title={<>کمپین‌های فعال (<Num>{formatNumber(e.campaigns.length, 0)}</Num>)</>}>
        <ul className="flex flex-col gap-2">
          {e.campaigns.map((x) => (
            <CampaignCard key={x.c.id} x={x} o={o} />
          ))}
        </ul>
      </Section>

      {e.why.length > 0 && (
        <Section title="دلیل سطح اطمینان">
          <ul className="list-disc pr-5 text-sm text-secondary leading-7">
            {e.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="ریسک‌ها (به عدد دلاری تبدیل نشده‌اند)">
        <ul className="list-disc pr-5 text-sm text-secondary leading-7">
          {e.risks.map((w) => (
            <li key={w} className={w.startsWith('میم‌کوین') ? 'text-danger' : ''}>
              {w}
            </li>
          ))}
          <li>نرخ‌ها با TVL، قیمت توکن پاداش و تمدید یا توقف کمپین‌ها تغییر می‌کنند.</li>
        </ul>
      </Section>

      <OppFooter o={o} />
    </div>
  );
}
