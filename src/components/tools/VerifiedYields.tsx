'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, ChevronDown, ExternalLink, Loader2, Search, Sprout, TrendingDown, TrendingUp } from 'lucide-react';
import { addressUrl, chainLogo, kinds, matches, poolUrl, PRESETS, presetById, projectLogo, type PresetId } from '../../lib/llama/yields';
import { PATTERN_LABEL, robustNote } from '../../lib/opportunity/robust-rate';
import { exitLabel, profitOf, type ExitStatus, type Profit, type VerifiedFeed, type VerifiedPool, type VerifyReject } from '../../lib/llama/verify';
import { DEFAULT_HORIZON, HORIZONS, isHorizon, type HorizonDays } from '../../lib/opportunity/policy';
import { txCost } from '../../lib/opportunity/costs';
import { useMerkl } from '../../hooks/useMerkl';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { networkByName } from '../../lib/registry/networks';
import { formatDate, formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { DataStatus } from '../ui/data-status';
import { NumberField, SelectField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { TokenLogo } from '../ui/token-logo';
import { Empty, Metric, Pill, Segmented } from '../opportunities/parts';

type SortKey = 'profit' | 'stability' | 'exit' | 'tvl';
const SORT_LABEL: Record<SortKey, string> = { profit: 'سود دلاری', stability: 'ثبات', exit: 'برداشت فوری', tvl: 'نقدینگی' };
/** Exit order for a tie in dollars, as in the market ranking: easier exit first. */
const EXIT_ORDER = ['instant', 'partial', 'queued', null] as const;
const STEP = 20;
/** Live refresh; quicker while the server is still verifying pools. */
const REFRESH_MS = 10 * 60_000;
const PREPARING_MS = 8_000;

const REJECT_LABEL: Record<VerifyReject, string> = {
  address: 'بدون نشانی قرارداد',
  not4626: 'ساختار پشتیبانی‌نشده (نه ERC-4626، نه Aave)',
  young: 'سابقه‌ی کمتر از ۳ روز',
  price: 'بازده غیرعادی یا سابقه‌ی ناکافی برای الگوی پله‌ای/پرنوسان',
  holders: 'دارنده‌ی کافی پیدا نشد',
  duplicate: 'همان قرارداد یک ردیف دیگر',
  error: 'خطای شبکه (دوباره بررسی می‌شود)',
};
const STATUS_LABEL: Record<ExitStatus, string> = { full: 'کامل', partial: 'بخشی', blocked: 'مسدود', collateral: 'وثیقه‌ی وام خودش' };
const STATUS_TONE: Record<ExitStatus, string> = { full: 'text-success', partial: 'text-warning', blocked: 'text-danger', collateral: 'text-muted' };

interface Stored {
  preset: PresetId;
  sort: SortKey;
  chain: string;
  capital: number;
  horizon: HorizonDays;
}

const pct = (x: number | null, digits = 2) => (x === null ? '—' : formatPercent(x, digits));
const signedUsd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const iso = (ms: number) => new Date(ms).toISOString();

function useVerified() {
  const [feed, setFeed] = useState<VerifiedFeed | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, ms);
    };
    function load() {
      if (document.visibilityState !== 'visible') return schedule(REFRESH_MS);
      fetch('/api/verified', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<VerifiedFeed>) : Promise.reject(new Error(String(r.status)))))
        .then((f) => {
          if (!live) return;
          setFeed(f);
          setFailed(false);
          schedule(f.pending > 0 ? PREPARING_MS : REFRESH_MS);
        })
        .catch(() => {
          if (!live) return;
          setFailed(true);
          schedule(REFRESH_MS);
        });
    }
    const now = () => document.visibilityState === 'visible' && load();
    load();
    document.addEventListener('visibilitychange', now);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', now);
    };
  }, []);
  return { feed, failed: failed && !feed, stale: failed && !!feed, loading: !feed && !failed };
}

function ExitPill({ p }: { p: VerifiedPool }) {
  const l = exitLabel(p);
  if (l === 'instant') return <Pill tone="success">برداشت فوری</Pill>;
  if (l === 'partial')
    return (
      <Pill tone="warning">
        برداشت فوری <Num>{formatPercent(p.instantPct ?? 0, 0)}</Num>
      </Pill>
    );
  if (l === 'queued') return <Pill tone="danger">صف یا قفل خروج</Pill>;
  return null;
}

function PoolLogo({ p }: { p: VerifiedPool }) {
  const net = networkByName(p.chain);
  return (
    <span className="relative shrink-0" style={{ width: 32, height: 32 }}>
      <TokenLogo src={projectLogo(p.project)} name={p.projectName} size={32} />
      <span className="absolute rounded-full ring-2 ring-surface bg-surface" style={{ insetInlineStart: -5, bottom: -5, width: 14, height: 14 }} title={net.nameFa}>
        <TokenLogo src={net.logo ?? chainLogo(p.chain)} name={p.chain} size={14} />
      </span>
    </span>
  );
}

function Row({ p, profit, fallback, rank, open, onToggle, explorer }: { p: VerifiedPool; profit: Profit | null; fallback?: { pct: number; profit: Profit | null } | null; rank: number; open: boolean; onToggle: () => void; explorer: string | null }) {
  const net = networkByName(p.chain);
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onToggle} aria-expanded={open} className="tap flex-1 min-w-0 text-right py-3 flex items-center gap-3 rounded-lg hover:bg-raised/50">
          <span className="w-6 shrink-0 text-xs text-muted text-center">
            <Num>{formatNumber(rank, 0)}</Num>
          </span>
          <PoolLogo p={p} />
          <span className="min-w-0 flex-1 flex flex-col leading-tight gap-1">
            <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold text-primary min-w-0">
              <bdi dir="ltr" className="truncate max-w-full">
                {p.symbol}
              </bdi>
              <ExitPill p={p} />
              {p.robust.young && (
                <Pill tone="info">
                  نوپا · <Num>{formatNumber(p.robust.days, 0)}</Num> روز
                </Pill>
              )}
              {p.robust.pattern !== 'smooth' && <Pill tone="warning">{PATTERN_LABEL[p.robust.pattern]}</Pill>}
              {p.kind === 'aave' && <Pill>وام‌دهی Aave</Pill>}
              {p.stability !== null && p.stability < 50 && <Pill tone="warning">بازده نامنظم</Pill>}
            </span>
            <span className="text-xs text-secondary truncate">
              <bdi dir="ltr">{p.projectName}</bdi> · {net.nameFa}
              {p.meta && (
                <>
                  {' '}· <bdi dir="ltr">{p.meta}</bdi>
                </>
              )}
            </span>
            <span className="text-xs text-secondary flex flex-wrap gap-x-2">
              <span className="whitespace-nowrap inline-flex items-center gap-1">
                واقعی <Num>{pct(p.robust.pct)}</Num>
                {p.robust.trend === 'up' && <TrendingUp size={13} className="text-success" aria-label="هفته‌ی اخیر بالاتر از ماه" />}
                {p.robust.trend === 'down' && <TrendingDown size={13} className="text-danger" aria-label="هفته‌ی اخیر پایین‌تر از ماه" />}
              </span>
              <span className="whitespace-nowrap">
                اعلام‌شده <Num>{pct(p.apyBase ?? p.apy)}</Num>
              </span>
              {p.stability !== null && (
                <span className="whitespace-nowrap">
                  ثبات <Num>{formatNumber(p.stability, 0)}</Num>
                </span>
              )}
              {fallback && (
                <span className="whitespace-nowrap text-warning">
                  اگر به سطح عادی (<Num>{pct(fallback.pct)}</Num>) برگردد: <Num>{fallback.profit ? signedUsd(fallback.profit.net) : '—'}</Num>
                </span>
              )}
              {p.coveredPct < 25 && (
                <span className="whitespace-nowrap text-warning">
                  شبیه‌سازی <Num>{formatPercent(p.coveredPct, 0)}</Num> خزانه
                </span>
              )}
              {p.holdersCount !== null && (
                <span className="whitespace-nowrap">
                  <Num>{formatNumber(p.holdersCount, 0)}</Num> دارنده
                </span>
              )}
            </span>
          </span>
          <span className="shrink-0 flex flex-col items-end leading-tight">
            <span className={`text-base font-semibold ${profit && profit.net >= 0 ? 'text-success' : 'text-danger'}`}>
              <Num>{profit ? signedUsd(profit.net) : '—'}</Num>
            </span>
            <span className="text-[11px] text-muted mt-0.5">
              <Num>{formatUSDCompact(p.tvlUsd)}</Num>
            </span>
          </span>
          <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <a href={poolUrl(p.id)} target="_blank" rel="noopener noreferrer" className="tap shrink-0 grid place-items-center size-10 rounded-md text-muted hover:text-primary hover:bg-raised" aria-label={`صفحه‌ی ${p.symbol} در DefiLlama`} title="صفحه‌ی همین استخر در DefiLlama">
          <ExternalLink size={16} aria-hidden />
        </a>
      </div>
      {open && <Detail p={p} profit={profit} explorer={explorer} />}
    </li>
  );
}

interface GrowthAnswer {
  value: number;
  gain: number;
  returnPct: number;
  annualPct: number;
  days: number;
  from: number;
  to: number;
  tooEarly?: true;
}

function Growth({ p }: { p: VerifiedPool }) {
  const [amount, setAmount] = useState(1000);
  const [from, setFrom] = useState(() => iso(p.day - 30 * 86_400_000).slice(0, 10));
  const [g, setG] = useState<GrowthAnswer | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  useEffect(() => {
    if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      setState('loading');
      fetch(`/api/verified/${encodeURIComponent(p.id)}?amount=${amount}&from=${from}`, { signal: c.signal })
        .then((r) => (r.ok ? (r.json() as Promise<GrowthAnswer>) : Promise.reject(new Error(String(r.status)))))
        .then((x) => {
          setG(x);
          setState('idle');
        })
        .catch((e) => (e as Error).name !== 'AbortError' && (setG(null), setState('failed')));
    }, 400);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [p.id, amount, from]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-primary">ماشین‌حساب رشد سپرده</h3>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="مبلغ سپرده" value={amount} onChange={(v) => setAmount(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" />
        <TextField label="تاریخ ورود" type="date" value={from} onChange={setFrom} />
      </div>
      {state === 'loading' ? (
        <p className="text-xs text-secondary flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" aria-hidden /> در حال خواندن قیمت سهم روی زنجیره…
        </p>
      ) : state === 'failed' ? (
        <p className="text-xs text-warning">برای این تاریخ محاسبه نشد؛ تاریخی پیش از {formatDate(iso(p.day))} انتخاب کنید.</p>
      ) : g?.tooEarly ? (
        <p className="text-xs text-warning">خزانه در آن تاریخ هنوز وجود نداشت.</p>
      ) : g ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="ارزش">
              <Num>{formatUSD(g.value, 2)}</Num>
            </Metric>
            <Metric label="سود" tone={g.gain >= 0 ? 'text-success' : 'text-danger'}>
              <Num>{formatUSD(g.gain, 2, true)}</Num>
            </Metric>
            <Metric label="بازده کل">
              <Num>{formatPercent(g.returnPct, 2, true)}</Num>
            </Metric>
            <Metric label="سالانه">
              <Num>{formatPercent(g.annualPct, 2)}</Num>
            </Metric>
          </div>
          <p className="text-xs text-muted leading-6">
            از {formatDate(iso(g.from))} تا {formatDate(iso(g.to))} (<Num>{formatNumber(g.days, 0)}</Num> روز)، از قیمت هر سهم خزانه که روی زنجیره خوانده شد. تغییر قیمت خود دارایی و کارمزد ورود و خروج حساب نشده است.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Detail({ p, profit, explorer }: { p: VerifiedPool; profit: Profit | null; explorer: string | null }) {
  const largest = p.sims[0];
  const gap = p.robust.pct !== null && p.apyBase !== null ? p.robust.pct - p.apyBase : null;
  return (
    <div className="rounded-xl bg-raised/40 border border-default p-3 sm:p-4 mb-3 flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="بازده واقعی ۷ روزه">
          <Num>{pct(p.measured.d7)}</Num>
        </Metric>
        <Metric label="بازده واقعی ۳۰ روزه">
          <Num>{pct(p.measured.d30)}</Num>
        </Metric>
        <Metric label="بازده واقعی ۹۰ روزه">
          <Num>{pct(p.measured.d90)}</Num>
        </Metric>
        <Metric label="امتیاز ثبات ۳۰ روزه" tone={p.stability === null ? 'text-muted' : p.stability >= 80 ? 'text-success' : p.stability >= 50 ? 'text-warning' : 'text-danger'} hint="از ۱۰۰">
          {p.stability === null ? '—' : <Num>{formatNumber(p.stability, 0)}</Num>}
        </Metric>
      </div>
      <p className="text-xs text-secondary leading-6">
        <b className="text-primary">نرخ رتبه‌بندی <Num>{pct(p.robust.pct)}</Num>:</b> {robustNote(p.robust)} میانه‌ی ۳۰ روزه <Num>{pct(p.robust.median30)}</Num>.
      </p>
      {profit && (
        <p className="text-xs text-secondary leading-6">
          سود: بهره با نرخ رتبه‌بندی <Num>{signedUsd(profit.gross)}</Num>
          {profit.exitFee > 0 && (
            <>
              {' '}− هزینه‌ی خروج <Num>{formatUSD(profit.exitFee, 2)}</Num>
            </>
          )}{' '}
          − گس ورود و خروج <Num>{formatUSD(profit.gas, 2)}</Num> = <b className={profit.net >= 0 ? 'text-success' : 'text-danger'}><Num>{signedUsd(profit.net)}</Num></b>. تغییر قیمت خود دارایی حساب نشده است.
        </p>
      )}
      {p.kind === 'aave' && p.liquidityPct !== null && (
        <p className={`text-xs leading-6 ${p.liquidityPct < 10 ? 'text-warning' : 'text-secondary'}`}>
          سپرده‌ی وام‌دهی Aave: <Num>{formatPercent(p.liquidityPct, 0)}</Num> از سپرده‌ها پول نقد آزاد است و همین حالا قابل برداشت؛ بقیه وام داده شده و برداشت بیشتر از این باید منتظر بازپرداخت وام‌ها یا ورود سپرده‌ی تازه بماند.
        </p>
      )}
      {gap !== null && Math.abs(gap) >= 1 && (
        <p className={`text-xs leading-6 ${gap < 0 ? 'text-warning' : 'text-secondary'}`}>
          نرخ اعلام‌شده‌ی DefiLlama <Num>{pct(p.apyBase)}</Num> است؛ دارندگان {gap < 0 ? 'کمتر' : 'بیشتر'} گرفته‌اند (<Num>{formatPercent(gap, 1, true)}</Num> واحد درصد).
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">شبیه‌سازی برداشت بزرگ‌ترین دارندگان</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-secondary">
              <tr className="text-right">
                <th className="font-normal py-1.5">دارنده</th>
                <th className="font-normal py-1.5">موقعیت</th>
                <th className="font-normal py-1.5">سهم</th>
                <th className="font-normal py-1.5">برداشت</th>
                <th className="font-normal py-1.5">هزینه‌ی خروج</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {p.sims.map((h) => (
                <tr key={h.address}>
                  <td className="py-1.5">
                    {explorer ? (
                      <a href={addressUrl(explorer, h.address)} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline" dir="ltr">
                        {h.name ?? shortAddr(h.address)}
                      </a>
                    ) : (
                      <bdi dir="ltr">{h.name ?? shortAddr(h.address)}</bdi>
                    )}
                  </td>
                  <td className="py-1.5">
                    <Num>{formatUSDCompact(h.usd)}</Num>
                  </td>
                  <td className="py-1.5">
                    <Num>{formatPercent(h.sharePct, 1)}</Num>
                  </td>
                  <td className={`py-1.5 ${STATUS_TONE[h.status]}`}>
                    {STATUS_LABEL[h.status]}
                    {h.status === 'partial' && h.value > 0 && (
                      <>
                        {' '}(<Num>{formatPercent((h.out / h.value) * 100, 0)}</Num>)
                      </>
                    )}
                    {h.asWallet && <span className="block text-[11px] text-muted">به‌شرط برداشت به کیف پول ساده</span>}
                  </td>
                  <td className="py-1.5">{h.feeBps === null ? '—' : <Num>{formatNumber(h.feeBps, 2)} bps</Num>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.holdersFromLogs !== null && (
          <p className="text-xs text-warning leading-6">
            این شبکه فهرست رایگان دارندگان ندارد؛ دارندگان از انتقال‌های <Num>{formatNumber(p.holdersFromLogs, 0)}</Num> روز اخیر خود خزانه پیدا شدند. دارنده‌ی بزرگی که در این مدت جابه‌جا نکرده ممکن است در فهرست نباشد.
          </p>
        )}
        {p.sims.some((h) => h.status === 'collateral') && (
          <p className="text-xs text-muted leading-6">«وثیقه‌ی وام خودش»: این دارنده با همین سپرده وام گرفته و تا وامش را برنگرداند نمی‌تواند برداشت کند. این وضعیت خود اوست، نه کمبود نقدینگی استخر؛ پس در رقم برداشت فوری حساب نشد و دارنده‌ی بعدی شبیه‌سازی شد.</p>
        )}
        {p.sims.some((h) => h.asWallet) && (
          <p className="text-xs text-muted leading-6">«به‌شرط برداشت به کیف پول ساده»: قرارداد خود دارنده توکنی را که خزانه همراه پول می‌فرستد نمی‌پذیرد؛ در شبیه‌سازی دارنده مثل یک کیف پول ساده فرض شد و خزانه پول را پرداخت. یعنی نقدینگی هست، ولی خروج به دست قرارداد دارنده است.</p>
        )}
        <p className="text-xs text-secondary leading-6">
          این <Num>{formatNumber(p.sims.filter((h) => h.status !== 'collateral').length, 0)}</Num> دارنده <Num>{formatPercent(p.coveredPct, 0)}</Num> از کل سهام خزانه را دارند؛ از پول آن‌ها <Num>{pct(p.instantPct, 0)}</Num> فوراً قابل برداشت بود.
          {largest && largest.sharePct >= 10 && (
            <>
              {' '}
              <b className="text-primary">تمرکز:</b> بزرگ‌ترین دارنده <Num>{formatPercent(largest.sharePct, 0)}</Num> خزانه (<Num>{formatUSDCompact(largest.usd)}</Num>) را دارد و{' '}
              {largest.status === 'full' ? 'می‌تواند همین حالا همه را بیرون بکشد؛ خروج او نقدینگی و نرخ را برای بقیه تغییر می‌دهد.' : 'نمی‌تواند همه را فوراً بیرون بکشد.'}
            </>
          )}
        </p>
      </div>

      <Growth p={p} />

      <p className="text-xs text-muted leading-6 border-t border-default pt-3">
        بلوک ثابت روزانه{' '}
        <bdi dir="ltr" className="num">
          #{p.block}
        </bdi>{' '}
        ({formatDate(iso(p.day))}، ساعت ۰۰:۰۰ UTC). خزانه‌ی{' '}
        {explorer ? (
          <a href={addressUrl(explorer, p.address)} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2" dir="ltr">
            {shortAddr(p.address)}
          </a>
        ) : (
          <bdi dir="ltr">{shortAddr(p.address)}</bdi>
        )}
        . شبیه‌سازی فقط خواندن است و هیچ تراکنشی فرستاده نمی‌شود.
      </p>
    </div>
  );
}

/**
 * «بازده تأییدشده»: DefiLlama pools that YieldX verified on-chain itself — the yield
 * from the vault's share price, exits from simulated withdrawals of real holders. Only
 * verified pools are listed; DefiLlama's own list is the candidate source.
 */
export function VerifiedYields() {
  const { feed, failed, stale, loading } = useVerified();
  // Gas price and native-token price per chain, measured on the server (the same as the market ranking).
  const gasQuotes = useMerkl().feed?.gas;
  const [st, setSt] = useState<Stored>({ preset: 'all', sort: 'profit', chain: '', capital: 1000, horizon: DEFAULT_HORIZON });
  const [typed, setTyped] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [shown, setShown] = useState(STEP);
  /** Verified pools with a month of history, or the young ones (3–29 days) apart. */
  const [group, setGroup] = useState<'mature' | 'young'>('mature');

  useEffect(() => {
    const s = readLocal<Partial<Stored>>(STORAGE_KEYS.verified, {});
    setSt((d) => ({
      preset: PRESETS.some((p) => p.id === s.preset) ? (s.preset as PresetId) : d.preset,
      sort: s.sort && s.sort in SORT_LABEL ? s.sort : d.sort,
      chain: typeof s.chain === 'string' ? s.chain : '',
      capital: typeof s.capital === 'number' && s.capital > 0 ? s.capital : d.capital,
      horizon: isHorizon(s.horizon) ? s.horizon : d.horizon,
    }));
  }, []);
  const patch = (p: Partial<Stored>) => {
    const next = { ...st, ...p };
    setSt(next);
    writeLocal(STORAGE_KEYS.verified, next);
    setShown(STEP);
    setOpenId(null);
  };

  const all = feed?.pools ?? [];
  const youngCount = useMemo(() => all.filter((p) => p.robust.young).length, [all]);
  const pools = useMemo(() => all.filter((p) => (!st.chain || p.chain === st.chain) && p.robust.young === (group === 'young')), [all, st.chain, group]);
  /**
   * A young pool's yield often falls as money arrives; the fallback is the median rate of
   * mature verified pools of the same asset class (dollar, ETH, BTC, SOL …).
   */
  const classOf = (p: VerifiedPool) => (p.stablecoin ? 'usd' : (kinds(p.symbol)[0] ?? 'other'));
  const classMedian = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const p of all) if (!p.robust.young && p.robust.pct !== null) by.set(classOf(p), [...(by.get(classOf(p)) ?? []), p.robust.pct]);
    const out = new Map<string, number>();
    for (const [k, xs] of by) {
      const s = [...xs].sort((a, b) => a - b);
      out.set(k, s[Math.floor(s.length / 2)]);
    }
    return out;
  }, [all]);
  const chains = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of all) n.set(p.chain, (n.get(p.chain) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const counts = useMemo(() => Object.fromEntries(PRESETS.map((pr) => [pr.id, pools.filter((p) => matches(p, pr.id, typed)).length])) as Record<PresetId, number>, [pools, typed]);
  const profits = useMemo(() => {
    const out = new Map<string, Profit | null>();
    for (const p of all) {
      const id = feed?.chainIds[p.chain];
      const gas = txCost(id ? `eip155:${id}` : p.chain, ['approve', 'deposit', 'withdraw'], gasQuotes ?? []).usd;
      out.set(p.id, profitOf(p, st.capital, st.horizon, gas));
    }
    return out;
  }, [all, feed, gasQuotes, st.capital, st.horizon]);
  const fallbacks = useMemo(() => {
    const out = new Map<string, { pct: number; profit: Profit | null }>();
    for (const p of all) {
      const pctValue = classMedian.get(classOf(p));
      if (!p.robust.young || pctValue === undefined || p.robust.pct === null || pctValue >= p.robust.pct) continue;
      const gas = (profits.get(p.id)?.gas ?? 0);
      out.set(p.id, { pct: pctValue, profit: profitOf({ ...p, robust: { ...p.robust, pct: pctValue } }, st.capital, st.horizon, gas) });
    }
    return out;
  }, [all, classMedian, profits, st.capital, st.horizon]);
  const list = useMemo(() => {
    const cents = (p: VerifiedPool) => Math.round((profits.get(p.id)?.net ?? -Infinity) * 100);
    const exit = (p: VerifiedPool) => EXIT_ORDER.indexOf(exitLabel(p));
    const key = (p: VerifiedPool) => (st.sort === 'tvl' ? p.tvlUsd : st.sort === 'stability' ? (p.stability ?? -1) : st.sort === 'exit' ? (p.instantPct ?? -1) : cents(p));
    // Dollars first (a cent is a real tie), then the easier exit, then TVL — as in the market ranking.
    return pools.filter((p) => matches(p, st.preset, typed)).sort((a, b) => key(b) - key(a) || exit(a) - exit(b) || b.tvlUsd - a.tvlUsd);
  }, [pools, st, typed, profits]);
  const dropped = feed ? (Object.entries(feed.rejected) as [VerifyReject, number][]).filter(([, n]) => n > 0) : [];
  const preset = presetById(st.preset);

  const checked = feed ? feed.candidates - feed.pending : 0;

  return (
    <section className="flex flex-col gap-4" aria-label="بازده تأییدشده">
      <header className="flex flex-col gap-2">
        <h2 className="font-semibold text-primary flex items-center gap-2">
          <BadgeCheck size={18} className="text-accent" aria-hidden /> بازده تأییدشده روی زنجیره
        </h2>
        <p className="text-sm text-secondary leading-7">خزانه‌هایی که YieldX بازده واقعی و امکان برداشتشان را خودش روی زنجیره چک کرده، به ترتیب سود خالص دلاری.</p>
        <details className="group rounded-lg border border-default bg-surface">
          <summary className="tap flex items-center justify-between gap-2 px-4 min-h-10 text-sm text-secondary hover:text-primary">
            روش بررسی و منابع
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="px-4 pb-4 text-sm text-secondary leading-7 flex flex-col gap-2">
            <li>
              <b className="text-primary">بازده واقعی:</b> قیمت هر سهم خزانه (در Aave شاخص سود) هر روز در یک بلوک ثابت (۰۰:۰۰ UTC) روی زنجیره خوانده می‌شود؛ رشد آن همان چیزی است که دارندگان واقعاً گرفته‌اند، نه نرخ اعلام‌شده. روزهای جهش کنار می‌روند؛ برای خزانه‌ی یکنواخت میانه‌ی ۷ روز اخیر، برای پله‌ای میانگین ۹۰ روزه، و برای پرنوسان کمترینِ این دو. استخرهای زیر ۳۰ روز در بخش «نوپا» جدا می‌آیند.
            </li>
            <li>
              <b className="text-primary">برداشت:</b> بزرگ‌ترین دارندگان واقعی خزانه پیدا می‌شوند و برداشت کامل هرکدام در همان بلوک شبیه‌سازی می‌شود.
            </li>
            <li>
              <b className="text-primary">فهرست:</b> نامزدها از DefiLlama: تک‌دارایی، نقدینگی <Num>{formatUSDCompact(feed?.minTvlUsd ?? 1e6)}</Num> و بیشتر، روی {feed ? Object.keys(feed.explorers).map((c) => networkByName(c).nameFa).join('، ') : 'شبکه‌های پشتیبانی‌شده'}.
            </li>
            <li>
              <b className="text-primary">امتیاز ثبات:</b> ۱۰۰ × (۱ − انحراف معیار ÷ میانگین) بازده واقعی هر ۵ روز در ۳۰ روز اخیر. «حسابرسی‌شده» یعنی DefiLlama برای پروتکل گزارش حسابرسی ثبت کرده. منابع: DefiLlama، Blockscout و RPC عمومی؛ همه رایگان.
              {dropped.length > 0 && (
                <>
                  {' '}کنار گذاشته شد:{' '}
                  {dropped.map(([r, n], i) => (
                    <span key={r}>
                      {i > 0 && '، '}
                      {REJECT_LABEL[r]} <Num>{formatNumber(n, 0)}</Num>
                    </span>
                  ))}
                  .
                </>
              )}
            </li>
          </ul>
        </details>
      </header>

      {feed && feed.pending > 0 && (
        <div className="sx-card px-4 py-3 flex flex-col gap-2" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-secondary">
              <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
              <span>
                <Num>{formatNumber(checked, 0)}</Num> از <Num>{formatNumber(feed.candidates, 0)}</Num> خزانه بررسی شد
              </span>
            </span>
            <span className="text-xs text-muted">بزرگ‌ترها اول · خودکار اضافه می‌شوند</span>
          </div>
          <div className="h-1.5 rounded-full bg-canvas overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={feed.candidates} aria-valuenow={checked}>
            <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${feed.candidates ? (checked / feed.candidates) * 100 : 0}%` }} />
          </div>
          <span className="text-xs text-muted">نتیجه‌ها ذخیره می‌شوند؛ بار بعد فقط خزانه‌های تازه بررسی می‌شوند.</span>
        </div>
      )}

      <div className="sx-card p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 md:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">جست‌وجو</span>
            <span className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
              <input type="search" dir="auto" value={typed} onChange={(e) => (setTyped(e.target.value), setShown(STEP))} placeholder="نماد یا پروتکل" aria-label="جست‌وجوی خزانه" className="w-full pr-10 pl-3 text-base" />
            </span>
          </label>
          <NumberField label="سرمایه" value={st.capital} onChange={(v) => Number.isFinite(v) && v > 0 && patch({ capital: v })} suffix="دلار" />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">مدت</span>
            <Segmented<`${HorizonDays}`> value={`${st.horizon}`} onChange={(v) => patch({ horizon: Number(v) as HorizonDays })} label="مدت" size="sm" options={HORIZONS.map((d) => ({ id: `${d}` as `${HorizonDays}`, label: <><Num>{formatNumber(d, 0)}</Num> روز</> }))} />
          </div>
        </div>

        <div className="strip -mx-4 px-4 flex gap-2" role="radiogroup" aria-label="فیلتر آماده">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={st.preset === p.id}
              onClick={() => patch({ preset: p.id })}
              className={`tap shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 min-h-9 text-sm whitespace-nowrap ${st.preset === p.id ? 'border-accent bg-accent/10 text-primary' : 'border-default text-secondary hover:text-primary'}`}
            >
              {p.label}
              {feed && (
                <span className="text-xs text-muted">
                  <Num>{formatNumber(counts[p.id], 0)}</Num>
                </span>
              )}
            </button>
          ))}
        </div>
        {st.preset !== 'all' && <p className="text-xs text-muted leading-6 -mt-1">{preset.rule}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:items-end">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">گروه</span>
            <Segmented<'mature' | 'young'>
              value={group}
              onChange={(g) => (setGroup(g), setShown(STEP), setOpenId(null))}
              label="گروه"
              size="sm"
              options={[
                { id: 'mature', label: <><BadgeCheck size={14} aria-hidden /> تأییدشده</> },
                { id: 'young', label: <><Sprout size={14} aria-hidden /> نوپا (<Num>{formatNumber(youngCount, 0)}</Num>)</> },
              ]}
            />
          </div>
          <SelectField label="شبکه" value={st.chain} onChange={(chain) => patch({ chain })} options={[{ value: '', label: 'همه' }, ...chains.map(([name, n]) => ({ value: name, label: `${networkByName(name).nameFa} (${formatNumber(n, 0)})` }))]} />
          <SelectField label="مرتب‌سازی" value={st.sort} onChange={(sort) => patch({ sort: sort as SortKey })} options={(Object.keys(SORT_LABEL) as SortKey[]).map((id) => ({ value: id, label: SORT_LABEL[id] }))} />
        </div>
        {group === 'young' && (
          <p className="text-xs text-warning leading-6">
            نوپا = ۳ تا ۲۹ روز سابقه، جدا از رتبه‌بندی اصلی: نرخ آن‌ها میانه‌ی هفته‌ی اخیر است و اغلب با ورود پول پایین می‌آید؛ کنار هر ردیف سودِ «اگر به سطح عادی همان نوع دارایی برگردد» هم آمده. بعد از ۳۰ روز خودکار به رتبه‌بندی اصلی می‌روند.
          </p>
        )}
      </div>

      <div className="sx-card px-3 pt-3 sm:px-4 pb-1 flex flex-col">
        <div className="flex items-start justify-between gap-3 pb-2">
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-primary">
              {preset.label}
              {feed && (
                <span className="text-secondary font-normal">
                  {' '}· <Num>{formatNumber(list.length, 0)}</Num> {group === 'young' ? 'خزانه‌ی نوپا' : 'خزانه‌ی تأییدشده'}
                </span>
              )}
            </span>
            <span className="text-xs text-muted leading-5">
              عدد بزرگ: سود خالص <Num>{formatNumber(st.horizon, 0)}</Num> روزه با <Num>{formatUSD(st.capital, 0)}</Num>، پس از هزینه‌ی خروج و گس. برای شبیه‌سازی برداشت و ماشین‌حساب روی ردیف بزنید.
            </span>
          </span>
          {feed && <DataStatus source="api" fetchedAt={Date.parse(feed.fetchedAt)} stale={stale} label="روی زنجیره" />}
        </div>
        {loading ? (
          <p className="text-sm text-secondary flex items-center gap-2 py-8 justify-center" aria-busy="true">
            <Loader2 size={14} className="animate-spin" aria-hidden /> در حال دریافت…
          </p>
        ) : failed ? (
          <Empty>داده دریافت نشد.</Empty>
        ) : !list.length && feed?.pending ? (
          <p className="text-sm text-secondary py-8 text-center">در حال بررسی خزانه‌ها روی زنجیره…</p>
        ) : !list.length ? (
          <Empty>{group === 'young' ? 'هیچ استخر نوپایی با این فیلتر نیست.' : 'هیچ خزانه‌ی تأییدشده‌ای با این فیلتر نیست.'}</Empty>
        ) : (
          <>
            <ol className="flex flex-col divide-y divide-default">
              {list.slice(0, shown).map((p, i) => (
                <Row key={p.id} p={p} profit={profits.get(p.id) ?? null} fallback={fallbacks.get(p.id) ?? null} rank={i + 1} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} explorer={feed?.explorers[p.chain] ?? null} />
              ))}
            </ol>
            {shown < list.length && (
              <button type="button" onClick={() => setShown(shown + STEP)} className="tap self-center my-2 rounded-md border border-default px-4 min-h-9 text-xs text-secondary hover:text-primary">
                بیشتر (<Num>{formatNumber(list.length - shown, 0)}</Num>)
              </button>
            )}
          </>
        )}

        <div className="pb-2" />
      </div>
    </section>
  );
}
