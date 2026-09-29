'use client';

import { ExternalLink } from 'lucide-react';
import { hookInfo, merklUrl, RATE_KIND, TOKEN_TYPE } from '../../lib/merkl/rules';
import { campaignTvl, daysLeft, nativeApr, type CampaignEstimate } from '../../lib/merkl/estimate';
import type { MerklCampaign, MerklOpportunity } from '../../lib/merkl/types';
import { formatAgo, formatCompact, formatDate, formatGregorian, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Metric, Pill } from '../opportunities/parts';
import { FlagPills, ProtocolLogo, RewardToken, protocolName } from './parts';

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 2 : 4);

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1.5 rounded-lg border border-control px-3 min-h-10 text-sm text-primary hover:bg-elevated">
      {children} <ExternalLink size={13} className="text-muted" aria-hidden />
    </a>
  );
}

/** What the whole campaign pays per day: dollars for priced tokens, units otherwise. */
function CampaignDaily({ c }: { c: MerklCampaign }) {
  if (c.rewardToken.type === 'TOKEN' && c.dailyUsd > 0) return <Num>{usd(c.dailyUsd)}</Num>;
  if (c.dailyUnits !== null)
    return (
      <span>
        <Num>{formatCompact(c.dailyUnits)}</Num> <bdi dir="ltr">{c.rewardToken.symbol}</bdi>
      </span>
    );
  return <span className="text-muted">—</span>;
}

function Personal({ e }: { e: CampaignEstimate }) {
  if (e.status === 'none') return <span className="text-xs text-muted">{e.note}</span>;
  const t = e.c.rewardToken;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-primary">
        {e.usdPerDay !== null ? (
          <>
            <Num>{usd(e.usdPerDay)}</Num> در روز · <Num>{usd(e.usdPerDay * e.daysLeft)}</Num> تا پایان
          </>
        ) : e.unitsPerDay !== null ? (
          <>
            <Num>{formatCompact(e.unitsPerDay)}</Num> <bdi dir="ltr">{t.symbol}</bdi> در روز · <Num>{formatCompact(e.unitsPerDay * e.daysLeft)}</Num> تا پایان
          </>
        ) : (
          '—'
        )}
      </span>
      {e.assumedUsdPerDay !== null && (
        <span className="text-xs text-warning">
          با قیمت فرضی Merkl حدود <Num>{usd(e.assumedUsdPerDay * e.daysLeft)}</Num> — قیمت بازار نیست
        </span>
      )}
      {e.note && <span className="text-xs text-secondary">{e.note}</span>}
    </span>
  );
}

function Campaign({ c, o, e }: { c: MerklCampaign; o: MerklOpportunity; e?: CampaignEstimate }) {
  const dl = daysLeft(c, Date.now() / 1000);
  const hooks = c.hooks.map(hookInfo);
  const { tvl, derived } = campaignTvl(c, o);
  return (
    <li className="rounded-lg border border-default bg-surface p-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary min-w-0">
          <RewardToken t={c.rewardToken} size={20} />
          <Pill tone={c.rewardToken.type === 'PRETGE' ? 'warning' : c.rewardToken.type === 'POINT' ? 'info' : 'muted'}>{TOKEN_TYPE[c.rewardToken.type]}</Pill>
        </span>
        <span className="text-xs text-secondary" title={`میلادی: ${formatGregorian(iso(c.end))}`}>
          پایان {formatDate(iso(c.end))} · <Num>{formatNumber(dl, dl < 3 ? 1 : 0)}</Num> روز مانده
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="APR کمپین">
          <Num>{formatPercent(c.apr, 2)}</Num>
        </Metric>
        <Metric label="پاداش روزانه‌ی کل کمپین">
          <CampaignDaily c={c} />
        </Metric>
        <Metric label="TVL واجد شرایط" hint={derived ? 'از APR و پاداش کمپین' : 'TVL کل فرصت'}>
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
      {e && (
        <div className="rounded-md bg-elevated px-3 py-2">
          <div className="text-xs text-secondary mb-0.5">برای سرمایه‌ی شما (برآورد)</div>
          <Personal e={e} />
        </div>
      )}
    </li>
  );
}

/** Everything behind one opportunity: its campaigns, conditions, data age and where to go. */
export function MerklDetails({ o, estimates }: { o: MerklOpportunity; estimates?: CampaignEstimate[] }) {
  const native = nativeApr(o);
  const priced = o.campaigns.map((c) => c.rewardToken.priceAt).filter((x): x is number => x !== null);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <bdi dir="ltr" className="text-sm text-primary font-medium text-right">
          {o.name}
        </bdi>
        <FlagPills o={o} max={10} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="APR مشوق (Merkl)" hint="میانگین همه؛ سهم شما نیست">
          <Num>{formatPercent(o.apr, 2)}</Num>
        </Metric>
        <Metric label="بازده بومی" hint={o.nativeApr === null ? 'گزارش نشده' : native === null ? 'عدد نامعتبر، نمایش داده نشد' : 'گزارش Merkl، جدا از مشوق'}>
          {native === null ? <span className="text-muted">—</span> : <Num>{formatPercent(native, 2)}</Num>}
        </Metric>
        <Metric label="TVL">
          <Num>{formatUSDCompact(o.tvl)}</Num>
        </Metric>
        <Metric label="پاداش روزانه‌ی کل" hint="برای همه‌ی شرکت‌کنندگان">
          <Num>{usd(o.dailyUsd)}</Num>
        </Metric>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">
          کمپین‌های زنده (<Num>{formatNumber(o.campaigns.length, 0)}</Num>)
        </h3>
        <ul className="flex flex-col gap-2">
          {o.campaigns.map((c) => (
            <Campaign key={c.id} c={c} o={o} e={estimates?.find((e) => e.c.id === c.id)} />
          ))}
        </ul>
      </div>

      {o.howTo.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-primary">نحوه‌ی شرکت (از Merkl)</h3>
          <ol className="list-decimal pr-5 text-sm text-secondary" dir="ltr">
            {o.howTo.map((s, i) => (
              <li key={i} className="text-left">
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-xs text-muted">
        {o.aprAt !== null && <>APR ثبت‌شده {formatAgo(o.aprAt * 1000)}</>}
        {priced.length > 0 && <> · قیمت توکن پاداش {formatAgo(Math.min(...priced) * 1000)}</>}
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
    </div>
  );
}
