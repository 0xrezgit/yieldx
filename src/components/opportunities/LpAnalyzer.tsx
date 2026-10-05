'use client';

import { useMemo, useState } from 'react';
import { Droplets, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { breakEven, defaultMoves, positionFeeApr, scenario, type LpInput, type LpScenario, type PoolShape } from '../../lib/lp/scenarios';
import { typicalMove } from '../../lib/lp/estimate';
import { logoOf } from '../../lib/lp/pools';
import type { RealLpStats } from '../../lib/lp/revert';
import { tokenInfo } from '../../lib/portfolio/tokens';
import { tokenClass } from '../../lib/merkl/vetting';
import { networkByName } from '../../lib/registry/networks';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { Collapsible } from '../ui/card';
import { PairLogo } from '../ui/asset-identity';
import { Segmented } from './parts';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const signed = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const tone = (x: number) => (x > 0 ? 'text-success' : x < 0 ? 'text-danger' : 'text-primary');

/** Values a pool (Merkl, vfat) or a link can pass in: `/tools?tab=lp&a=…&b=…&fee=…&rewardUsd=…&stable=1&days=…&capital=…&name=…`. */
export interface LpPrefill {
  name?: string;
  a?: string;
  b?: string;
  stable?: boolean;
  feeApr?: number | null;
  rewardUsd?: number | null;
  capital?: number;
  days?: number;
  /** Where feeApr came from; Merkl by default (older links carry no source). */
  source?: 'merkl' | 'vfat';
  /** Network name (e.g. "Robinhood Chain"), for the logo badge. */
  chain?: string;
  /** Trading venue (Uniswap, Fables…). */
  protocol?: string;
  /** The pool's measured 7-day swing (95th percentile, percent): sets the scenarios. */
  move7d?: { down: number; up: number };
  /** Concentrated-liquidity pool: positions take a price range. */
  concentrated?: boolean;
  /** This market's deposit page. */
  url?: string;
  /** The same pool on Revert (automatic range management). */
  revertUrl?: string;
  /** Days of history behind feeApr, the last week's rate (trend), and Aerodrome's unstaked-fee share (already out). Not carried in links. */
  feeDays?: number;
  feeTrendPct?: number | null;
  unstakedFee?: number;
  /** How the pool's real LPs have done (Revert; not carried in links). */
  realLps?: RealLpStats | null;
  /** Logo URLs (not carried in links). */
  logoA?: string | null;
  logoB?: string | null;
}

export function readLpPrefill(q: URLSearchParams): LpPrefill {
  const n = (k: string) => {
    const v = q.get(k);
    const x = v === null ? NaN : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const md = n('md');
  const mu = n('mu');
  return {
    name: q.get('name') ?? undefined,
    a: q.get('a') ?? undefined,
    b: q.get('b') ?? undefined,
    stable: q.get('stable') === '1',
    feeApr: n('fee'),
    rewardUsd: n('rewardUsd'),
    capital: n('capital') ?? undefined,
    days: n('days') ?? undefined,
    source: q.get('src') === 'vfat' ? 'vfat' : undefined,
    chain: q.get('chain') ?? undefined,
    protocol: q.get('dex') ?? undefined,
    move7d: md !== null && mu !== null && md >= 0 && mu >= 0 ? { down: md, up: mu } : undefined,
    concentrated: q.get('cl') === '1',
    // Only a vfat page: a link must not send the user anywhere else.
    url: /^https:\/\/vfat\.io\/farm\?farmId=[^\s"'<>]+$/.test(q.get('go') ?? '') ? (q.get('go') as string) : undefined,
    revertUrl: /^https:\/\/revert\.finance\/#\/discover\?[^\s"'<>]+$/.test(q.get('rv') ?? '') ? (q.get('rv') as string) : undefined,
  };
}

/** Builds the link that opens this analyzer pre-filled. */
export function lpLink(p: LpPrefill): string {
  const q = new URLSearchParams({ tab: 'lp' });
  if (p.name) q.set('name', p.name);
  if (p.a) q.set('a', p.a);
  if (p.b) q.set('b', p.b);
  if (p.stable) q.set('stable', '1');
  if (p.feeApr != null && Number.isFinite(p.feeApr)) q.set('fee', String(Math.round(p.feeApr * 100) / 100));
  if (p.rewardUsd != null && Number.isFinite(p.rewardUsd)) q.set('rewardUsd', String(Math.round(p.rewardUsd * 100) / 100));
  if (p.capital) q.set('capital', String(p.capital));
  if (p.days) q.set('days', String(p.days));
  if (p.source === 'vfat') q.set('src', 'vfat');
  if (p.chain) q.set('chain', p.chain);
  if (p.protocol) q.set('dex', p.protocol);
  if (p.move7d) {
    q.set('md', String(p.move7d.down));
    q.set('mu', String(p.move7d.up));
  }
  if (p.concentrated) q.set('cl', '1');
  if (p.url) q.set('go', p.url);
  if (p.revertUrl) q.set('rv', p.revertUrl);
  return `/tools?${q}`;
}

interface Case {
  move: number;
  label: string;
}

/** Scenarios: from the pool's own measured swing when known, else fixed hypothetical moves. */
function cases(move7d: LpPrefill['move7d'], days: number, stable: boolean, custom: number): Case[] {
  let list: Case[];
  if (move7d) {
    const m = typicalMove({ move7d }, days);
    list = [
      { move: -Math.min(0.9, m.down * 2), label: 'افت شدید' },
      { move: -m.down, label: 'افت معمول' },
      { move: 0, label: 'قیمت ثابت' },
      { move: m.up, label: 'رشد معمول' },
      { move: m.up * 2, label: 'رشد شدید' },
    ];
  } else {
    list = defaultMoves(stable).map((move) => ({ move, label: move === 0 ? 'قیمت ثابت' : move < 0 ? 'افت' : 'رشد' }));
  }
  if (Number.isFinite(custom) && custom > -100) list.push({ move: custom / 100, label: 'سناریوی شما' });
  return list.sort((x, y) => x.move - y.move);
}

function ScenarioCard({ c, r, a, capital }: { c: Case; r: LpScenario; a: string; capital: number }) {
  const total = r.vsCashUsd;
  const flat = c.move === 0;
  return (
    <li className={`rounded-lg border p-3 flex flex-col gap-2 ${flat ? 'border-accent/50 bg-accent/5' : 'border-default bg-surface'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-primary">{c.label}</span>
        <span className="text-xs text-secondary">
          <bdi dir="ltr">{a}</bdi> <Num>{formatPercent(c.move * 100, 1, true)}</Num>
        </span>
      </div>
      {total === null ? (
        <p className="text-sm text-secondary">بدون نرخ کارمزد حساب نمی‌شود.</p>
      ) : (
        <>
          <p className={`text-xl font-semibold ${tone(total)}`}>
            <Num>{signed(total)}</Num>
          </p>
          <p className="text-xs text-secondary">
            سرمایه‌ی <Num>{usd(capital)}</Num> می‌شود <Num>{usd(capital + total)}</Num>
          </p>
          <dl className="text-xs flex flex-col gap-1 border-t border-default pt-2">
            <div className="flex justify-between gap-2">
              <dt className="text-secondary">کارمزد دریافتی</dt>
              <dd className="text-success"><Num>{signed(r.feesUsd ?? 0)}</Num></dd>
            </div>
            {r.rewardsUsd > 0 && (
              <div className="flex justify-between gap-2">
                <dt className="text-secondary">پاداش</dt>
                <dd className="text-success"><Num>{signed(r.rewardsUsd)}</Num></dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-secondary">تغییر ارزش دارایی‌ها</dt>
              <dd className={tone(r.positionUsd - capital)}><Num>{signed(r.positionUsd - capital)}</Num></dd>
            </div>
            {r.vsHodlUsd !== null && (
              <div className="flex justify-between gap-2">
                <dt className="text-secondary">در مقایسه با نگه‌داشتن ساده</dt>
                <dd className={tone(r.vsHodlUsd)}><Num>{signed(r.vsHodlUsd)}</Num></dd>
              </div>
            )}
          </dl>
          {r.inRange < 1 && (
            <p className="text-xs text-warning">
              فقط <Num>{formatPercent(r.inRange * 100, 0)}</Num> مسیر داخل بازه؛ بیرون از بازه کارمزدی نیست.
            </p>
          )}
        </>
      )}
    </li>
  );
}

/**
 * «تحلیل LP»: for an amount and a period, how many dollars the position ends with in
 * each price scenario — fees, the change in the assets' value, and the comparison
 * with simply holding them. Scenarios are hypothetical, never forecasts; LP stays
 * out of the general ranking.
 */
export function LpAnalyzer({ prefill = {} }: { prefill?: LpPrefill }) {
  const [a, setA] = useState(prefill.a ?? 'ETH');
  const [b, setB] = useState(prefill.b ?? 'USDC');
  const [stable, setStable] = useState(prefill.stable ?? false);
  const [capital, setCapital] = useState(prefill.capital ?? 1000);
  const [days, setDays] = useState(prefill.days ?? 30);
  // A concentrated pool opens with the range the pool list assumed: its usual swing over the period.
  const start = prefill.concentrated && prefill.move7d ? typicalMove({ move7d: prefill.move7d }, prefill.days ?? 30) : null;
  const pct = (x: number) => Math.round(Math.max(1, x * 100) * 10) / 10;
  const [kind, setKind] = useState<'full' | 'range'>(start ? 'range' : 'full');
  const [below, setBelow] = useState(start ? pct(start.down) : 10);
  const [above, setAbove] = useState(start ? pct(start.up) : 10);
  const [fee, setFee] = useState<number>(prefill.feeApr ?? NaN);
  const [rewardApr, setRewardApr] = useState<number>(0);
  const [costs, setCosts] = useState(0);
  const [custom, setCustom] = useState<number>(NaN);
  const fromMerkl = prefill.rewardUsd != null;
  const fromPool = !!prefill.name;
  // vfat rates are per full-range dollar; a range earns them times its concentration.
  const feeBasis = prefill.source === 'vfat' ? 'full-range' : 'position';
  const canRange = prefill.source !== 'vfat' || !!prefill.concentrated;

  const shape: PoolShape = kind === 'full' ? { kind: 'full' } : { kind: 'range', low: 1 - Math.min(99, Math.max(0.1, below)) / 100, high: 1 + Math.max(0.1, above) / 100 };
  const input: LpInput = {
    capital: capital > 0 ? capital : 0,
    days: days > 0 ? days : 0,
    shape,
    feeAprPct: Number.isFinite(fee) ? fee : null,
    feeBasis,
    rewardUsd: fromMerkl ? (prefill.rewardUsd as number) : null,
    rewardAprPct: fromMerkl ? null : rewardApr,
    costsUsd: costs > 0 ? costs : 0,
  };
  const list = useMemo(() => cases(prefill.move7d, input.days, stable, custom), [prefill.move7d, input.days, stable, custom]);
  const ready = input.capital > 0 && input.days > 0;
  const rows = ready ? list.map((c) => ({ c, r: scenario(input, c.move) })) : [];
  const be = input.feeAprPct !== null && ready ? breakEven(input) : { down: null, up: null };
  const unitIsDollar = tokenClass({ symbol: b }) === 'usd';
  const inRangeApr = positionFeeApr(input);
  const chain = prefill.chain ?? '';
  // From a vfat link (no logos carried): a symbol outside the token list is one of the verified stocks.
  const logo = (s: string) => tokenInfo(s)?.logo ?? (prefill.source === 'vfat' ? logoOf(s, 'stock') : null);
  const logoA = prefill.logoA ?? logo(a);
  const logoB = prefill.logoB ?? logo(b);

  return (
    <section className="flex flex-col gap-4" aria-label="تحلیل LP">
      <div className="sx-card p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {fromPool ? <PairLogo a={{ symbol: a, logo: logoA }} b={{ symbol: b, logo: logoB }} chain={chain} size={32} /> : <Droplets size={22} className="text-accent shrink-0" aria-hidden />}
          <span className="min-w-0 flex flex-col leading-tight">
            <span className="font-semibold text-primary flex items-center gap-1.5 min-w-0">
              تحلیل LP
              {fromPool && (
                <>
                  <span className="text-secondary font-normal">·</span>
                  <bdi dir="ltr" className="truncate">
                    {a}/{b}
                  </bdi>
                </>
              )}
            </span>
            {fromPool && (
              <span className="text-xs text-secondary mt-0.5">
                {prefill.protocol && <bdi dir="ltr">{prefill.protocol}</bdi>}
                {prefill.protocol && chain && ' · '}
                {chain && networkByName(chain).nameFa}
              </span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField label="چقدر سرمایه می‌گذارید؟" value={capital} onChange={(v) => setCapital(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" />
          <NumberField label="برای چند روز؟" value={days} onChange={(v) => setDays(Number.isFinite(v) ? Math.max(0, Math.min(3650, Math.round(v))) : 0)} suffix="روز" />
        </div>
        {!fromPool && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="دارایی اول" value={a} onChange={setA} ltr />
            <TextField label="دارایی دوم" value={b} onChange={setB} ltr />
          </div>
        )}
        {canRange && (
          <div className="flex flex-col gap-2">
            <Segmented<'full' | 'range'> value={kind} onChange={setKind} label="نوع پوزیشن" size="sm" options={[{ id: 'range', label: 'بازه‌ی قیمت' }, { id: 'full', label: 'تمام‌بازه' }]} />
            {kind === 'range' && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="پایین بازه" value={below} onChange={(v) => setBelow(Number.isFinite(v) ? v : 10)} suffix="٪" note="زیر قیمت فعلی" />
                <NumberField label="بالای بازه" value={above} onChange={(v) => setAbove(Number.isFinite(v) ? v : 10)} suffix="٪" note="بالای قیمت فعلی" />
              </div>
            )}
          </div>
        )}
        <p className="text-sm text-secondary leading-7">
          {inRangeApr === null ? (
            <span className="text-warning">نرخ کارمزد وارد نشده (در «تنظیمات بیشتر»).</span>
          ) : (
            <>
              درآمد کارمزد این پوزیشن: <b className="text-primary"><Num>{formatPercent(inRangeApr, 1)}</Num></b> سالانه{kind === 'range' && ' تا وقتی قیمت داخل بازه است'}
              {prefill.feeApr != null && (
                <span className="text-xs block">
                  {prefill.source === 'vfat' ? (
                    <>
                      از کارمزد واقعی <Num>{formatNumber(prefill.feeDays ?? 30, 0)}</Num> روز گذشته به ازای نقدینگی فعال استخر (vfat){kind === 'range' && <>؛ تمام‌بازه <Num>{formatPercent(fee, 1)}</Num></>}
                      {!!prefill.unstakedFee && <> · سهم <Num>{formatPercent(prefill.unstakedFee * 100, 0)}</Num> استخر از کارمزد LP بدون استیک کسر شده</>}
                      {prefill.feeTrendPct != null && Number.isFinite(fee) && fee > 0 && Math.abs(prefill.feeTrendPct / fee - 1) >= 0.2 && (
                        <span className="block">
                          هفته‌ی اخیر <Num>{formatPercent(Math.abs(prefill.feeTrendPct / fee - 1) * 100, 0)}</Num> {prefill.feeTrendPct > fee ? 'بالاتر' : 'پایین‌تر'} از میانگین ماه.
                        </span>
                      )}
                    </>
                  ) : (
                    'بازده کارمزد استخر (Merkl)'
                  )}
                </span>
              )}
            </>
          )}
        </p>
        {prefill.realLps && (
          <div className="rounded-lg border border-default bg-surface p-3 text-sm text-secondary leading-7">
            <b className="text-primary">LPهای واقعی همین استخر</b> (<bdi dir="ltr">Revert</bdi>، <Num>{formatNumber(prefill.realLps.count, 0)}</Num> پوزیشن باز بالای ۱۰۰ دلار و یک هفته): کارمزد سالانه‌ی میانه <b className="text-primary"><Num>{formatPercent(prefill.realLps.feeApr.median, 0)}</Num></b> (نیمی بین <Num>{formatPercent(prefill.realLps.feeApr.p25, 0)}</Num> و <Num>{formatPercent(prefill.realLps.feeApr.p75, 0)}</Num>)؛ <Num>{formatPercent(prefill.realLps.inRangePct, 0)}</Num> الان داخل بازه‌اند.
            <span className="block text-xs text-muted">بازه و زمان ورود هر کدام فرق دارد؛ برای مقایسه است، نه پیش‌بینی پوزیشن شما.</span>
          </div>
        )}
        {(prefill.url || prefill.revertUrl) && (
          <div className="flex flex-wrap gap-2">
            {prefill.url && (
              <a href={prefill.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1.5 rounded-md border border-strong px-3 min-h-10 text-sm font-medium text-primary hover:bg-raised">
                <ExternalLink size={15} aria-hidden /> ورود به همین بازار در <bdi dir="ltr">vfat</bdi>
              </a>
            )}
            {prefill.revertUrl && (
              <a href={prefill.revertUrl} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-1.5 rounded-md border border-default px-3 min-h-10 text-sm font-medium text-primary hover:bg-raised" title="ساخت پوزیشن با مدیریت خودکار بازه (Auto-Range) و ترکیب خودکار کارمزد">
                <ExternalLink size={15} aria-hidden /> مدیریت خودکار بازه در <bdi dir="ltr">Revert</bdi>
              </a>
            )}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <section className="sx-card p-4 flex flex-col gap-3" aria-label="نتیجه در هر سناریو">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-primary">
              بعد از <Num>{formatNumber(input.days, 0)}</Num> روز، با <Num>{usd(input.capital)}</Num>
            </h3>
            <p className="text-xs text-secondary leading-6">
              هر کارت یعنی «اگر قیمت <bdi dir="ltr">{a}</bdi> این‌قدر تغییر کند». سناریوی فرضی است و پیش‌بینی نیست.
              {prefill.move7d && ' «معمول» یعنی تکانی که قیمت این استخر در ۹۵٪ هفته‌های اخیر از آن بیشتر نشده، برای مدت شما بزرگ‌تر شده؛ «شدید» دو برابر آن. عدد فهرست استخرها میانگین مورد انتظار است؛ این کارت‌ها حالت‌های مشخص‌اند.'}
            </p>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {rows.map(({ c, r }) => (
              <ScenarioCard key={`${c.label}${c.move}`} c={c} r={r} a={a} capital={input.capital} />
            ))}
          </ul>
          {input.feeAprPct !== null && (
            <p className="text-sm text-secondary leading-7">
              {be.down === null && be.up === null ? (
                'کارمزد حتی بدون تغییر قیمت هزینه‌ها را نمی‌پوشاند؛ نگه‌داشتن ساده بهتر است.'
              ) : (
                <>
                  نقطه‌ی سربه‌سر: تا وقتی قیمت <bdi dir="ltr">{a}</bdi> بین {be.down === null ? 'هر افتی' : <Num>{formatPercent(be.down * 100, 1, true)}</Num>} و {be.up === null ? 'هر رشدی' : <Num>{formatPercent(be.up * 100, 1, true)}</Num>} تغییر کند، LP از نگه‌داشتن ساده‌ی همین دو دارایی بهتر است.
                </>
              )}
            </p>
          )}
          <ul className="text-xs text-muted leading-6 list-disc ps-5">
            <li>
              دلارها با فرض ثابت ماندن قیمت دلاری <bdi dir="ltr">{b}</bdi> حساب شده‌اند
              {unitIsDollar ? '.' : <> — اگر <bdi dir="ltr">{b}</bdi> هم تغییر کند، نتیجه فرق می‌کند.</>}
            </li>
            <li>کارمزد با همین نرخ ادامه فرض شده؛ حجم معاملات آینده معلوم نیست. پاداش‌های جدا و گس حساب نشده‌اند مگر در «تنظیمات بیشتر» وارد کنید.</li>
            {kind === 'range' && <li>بیرون از بازه کارمزدی نیست و همه‌ی پوزیشن به یکی از دو دارایی تبدیل می‌شود؛ در سناریوهای شدید همین را می‌بینید.</li>}
          </ul>
        </section>
      )}

      <Collapsible title="تنظیمات بیشتر" icon={<SlidersHorizontal size={18} aria-hidden />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField
            label={feeBasis === 'full-range' ? 'نرخ کارمزد سالانه (تمام‌بازه)' : 'نرخ کارمزد سالانه'}
            value={fee}
            onChange={setFee}
            suffix="٪"
            help="کارمزد معاملاتی که به نقدینگی‌دهنده‌ها می‌رسد، به صورت نرخ سالانه. بهتر است از کارمزد واقعی هفته‌ها یا ماه گذشته باشد."
            warning={Number.isFinite(fee) ? undefined : 'بدون نرخ کارمزد سودی حساب نمی‌شود.'}
          />
          {fromMerkl ? (
            <p className="text-sm text-secondary self-end">
              پاداش در این دوره (Merkl): <Num>{usd(prefill.rewardUsd as number)}</Num>
            </p>
          ) : (
            <NumberField label="نرخ پاداش جدا (سالانه)" value={rewardApr} onChange={(v) => setRewardApr(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="٪" />
          )}
          <NumberField label="هزینه‌ی ورود و خروج" value={costs} onChange={(v) => setCosts(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" help="گس و کارمزد تبدیل" />
          <NumberField label="سناریوی دلخواه" value={custom} onChange={setCustom} suffix="٪" note={<>تغییر قیمت <bdi dir="ltr">{a}</bdi>؛ منفی یعنی افت.</>} />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">هر دو دارایی استیبل‌کوین دلاری‌اند؟</span>
            <Segmented<'no' | 'yes'> value={stable ? 'yes' : 'no'} onChange={(v) => setStable(v === 'yes')} label="جفت استیبل" size="sm" options={[{ id: 'no', label: 'نه' }, { id: 'yes', label: 'بله' }]} />
          </div>
        </div>
      </Collapsible>
    </section>
  );
}
