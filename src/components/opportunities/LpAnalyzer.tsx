'use client';

import { useMemo, useState } from 'react';
import { Droplets, SlidersHorizontal } from 'lucide-react';
import { breakEven, defaultMoves, scenario, type LpInput, type LpScenario, type PoolShape } from '../../lib/lp/scenarios';
import { typicalMove } from '../../lib/lp/estimate';
import { logoOf } from '../../lib/lp/pools';
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
  const [kind, setKind] = useState<'full' | 'range'>('full');
  const [below, setBelow] = useState(10);
  const [above, setAbove] = useState(10);
  const [fee, setFee] = useState<number>(prefill.feeApr ?? NaN);
  const [rewardApr, setRewardApr] = useState<number>(0);
  const [costs, setCosts] = useState(0);
  const [custom, setCustom] = useState<number>(NaN);
  const fromMerkl = prefill.rewardUsd != null;
  const fromPool = !!prefill.name;

  const shape: PoolShape = kind === 'full' ? { kind: 'full' } : { kind: 'range', low: 1 - Math.min(99, Math.max(0.1, below)) / 100, high: 1 + Math.max(0.1, above) / 100 };
  const input: LpInput = {
    capital: capital > 0 ? capital : 0,
    days: days > 0 ? days : 0,
    shape,
    feeAprPct: Number.isFinite(fee) ? fee : null,
    rewardUsd: fromMerkl ? (prefill.rewardUsd as number) : null,
    rewardAprPct: fromMerkl ? null : rewardApr,
    costsUsd: costs > 0 ? costs : 0,
  };
  const list = useMemo(() => cases(prefill.move7d, input.days, stable, custom), [prefill.move7d, input.days, stable, custom]);
  const ready = input.capital > 0 && input.days > 0;
  const rows = ready ? list.map((c) => ({ c, r: scenario(input, c.move) })) : [];
  const be = input.feeAprPct !== null && ready ? breakEven(input) : { down: null, up: null };
  const unitIsDollar = tokenClass({ symbol: b }) === 'usd';
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
        <p className="text-sm text-secondary">
          نرخ کارمزد سالانه: {Number.isFinite(fee) ? <b className="text-primary"><Num>{formatPercent(fee, 1)}</Num></b> : <span className="text-warning">وارد نشده (در «تنظیمات بیشتر»)</span>}
          {Number.isFinite(fee) && prefill.feeApr != null && <span className="text-xs"> · {prefill.source === 'vfat' ? 'کارمزد واقعی ۷ روز گذشته‌ی استخر (vfat)' : 'بازده کارمزد استخر (Merkl)'}</span>}
        </p>
      </div>

      {rows.length > 0 && (
        <section className="sx-card p-4 flex flex-col gap-3" aria-label="نتیجه در هر سناریو">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-primary">
              بعد از <Num>{formatNumber(input.days, 0)}</Num> روز، با <Num>{usd(input.capital)}</Num>
            </h3>
            <p className="text-xs text-secondary leading-6">
              هر کارت یعنی «اگر قیمت <bdi dir="ltr">{a}</bdi> این‌قدر تغییر کند». سناریوی فرضی است و پیش‌بینی نیست.
              {prefill.move7d && ' «معمول» یعنی تکانی که قیمت این استخر در ۹۵٪ هفته‌های اخیر از آن بیشتر نشده، برای مدت شما بزرگ‌تر شده؛ «شدید» دو برابر آن.'}
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
          </ul>
        </section>
      )}

      <Collapsible title="تنظیمات بیشتر" icon={<SlidersHorizontal size={18} aria-hidden />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField
            label="نرخ کارمزد سالانه"
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
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">نوع پوزیشن</span>
            <Segmented<'full' | 'range'> value={kind} onChange={setKind} label="نوع پوزیشن" size="sm" options={[{ id: 'full', label: 'تمام‌بازه (ساده)' }, { id: 'range', label: 'بازه‌ی متمرکز' }]} />
          </div>
          {kind === 'range' && (
            <>
              <NumberField label="پایین بازه، زیر قیمت فعلی" value={below} onChange={(v) => setBelow(Number.isFinite(v) ? v : 10)} suffix="٪" />
              <NumberField label="بالای بازه، بالای قیمت فعلی" value={above} onChange={(v) => setAbove(Number.isFinite(v) ? v : 10)} suffix="٪" />
              <p className="text-xs text-muted sm:col-span-2 leading-6">نرخ کارمزد میانگین کل استخر است؛ بازه‌ی باریک تا وقتی قیمت داخلش است بیشتر از این درآمد دارد و اینجا محافظه‌کارانه همان نرخ به کار رفته.</p>
            </>
          )}
        </div>
      </Collapsible>
    </section>
  );
}
