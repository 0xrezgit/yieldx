'use client';

import { useMemo, useState } from 'react';
import { Droplets } from 'lucide-react';
import { breakEven, defaultMoves, scenario, type LpInput, type PoolShape } from '../../lib/lp/scenarios';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { NumberField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { Segmented } from './parts';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const signed = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);

/** Values a Merkl pool (or a link) can pass in: `/tools?tab=lp&a=…&b=…&fee=…&rewardUsd=…&stable=1&days=…&capital=…&name=…`. */
export interface LpPrefill {
  name?: string;
  a?: string;
  b?: string;
  stable?: boolean;
  feeApr?: number | null;
  rewardUsd?: number | null;
  capital?: number;
  days?: number;
}

export function readLpPrefill(q: URLSearchParams): LpPrefill {
  const n = (k: string) => {
    const v = q.get(k);
    const x = v === null ? NaN : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    name: q.get('name') ?? undefined,
    a: q.get('a') ?? undefined,
    b: q.get('b') ?? undefined,
    stable: q.get('stable') === '1',
    feeApr: n('fee'),
    rewardUsd: n('rewardUsd'),
    capital: n('capital') ?? undefined,
    days: n('days') ?? undefined,
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
  return `/tools?${q}`;
}

/**
 * «تحلیل تخصصی LP»: fees, rewards, value change and HODL comparison per
 * hypothetical price scenario — kept out of the general ranking.
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
  const moves = useMemo(() => [...new Set([...defaultMoves(stable), ...(Number.isFinite(custom) ? [custom / 100] : [])])].sort((x, y) => x - y), [stable, custom]);
  const rows = input.capital > 0 && input.days > 0 ? moves.map((m) => scenario(input, m)) : [];
  const be = input.feeAprPct !== null && input.capital > 0 ? breakEven(input) : { down: null, up: null };

  return (
    <section className="flex flex-col gap-4" aria-label="تحلیل تخصصی LP">
      <div className="sx-card p-4 flex flex-col gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Droplets size={18} aria-hidden /> تحلیل تخصصی LP{prefill.name && <> · <bdi className="text-secondary font-normal">{prefill.name}</bdi></>}
        </h2>
        <p className="text-sm text-secondary leading-7">
          سود LP یک عدد نیست: کارمزد معاملات و پاداش در برابر تغییر ارزش خود پوزیشن نسبت به نگه‌داشتن همان دو دارایی (HODL). جدول زیر همین چهار جزء را برای چند <b className="text-primary">سناریوی فرضی</b> قیمت نشان می‌دهد — پیش‌بینی نیست و به هیچ سناریویی احتمال داده نشده. به همین دلیل LP در رتبه‌بندی عمومی نمی‌آید.
        </p>
      </div>

      <div className="sx-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="دارایی اول (A)" value={a} onChange={setA} ltr />
        <TextField label="دارایی دوم (B، واحد قیمت)" value={b} onChange={setB} ltr />
        <NumberField label="مبلغ" value={capital} onChange={(v) => setCapital(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" />
        <NumberField label="مدت" value={days} onChange={(v) => setDays(Number.isFinite(v) ? Math.max(0, Math.min(3650, Math.round(v))) : 0)} suffix="روز" />
        <NumberField
          label="نرخ کارمزد معاملات (سالانه)"
          value={fee}
          onChange={setFee}
          suffix="٪"
          help="بهتر است کارمزد تحقق‌یافته‌ی ۷ یا ۳۰ روز گذشته باشد. نرخ میانگین استخر برای بازه‌ی باریک کمتر از درآمد واقعی است؛ اینجا همان به کار می‌رود (محافظه‌کارانه)."
          note={prefill.feeApr != null ? 'از Merkl: بازده بومی استخر (کارمزد) به نرخ فعلی' : undefined}
          warning={Number.isFinite(fee) ? undefined : 'بدون نرخ کارمزد.'}
        />
        {fromMerkl ? (
          <p className="text-sm text-secondary self-end">
            پاداش در این دوره (موتور Merkl، هر کمپین تا پایان خودش): <Num>{usd(prefill.rewardUsd as number)}</Num>
          </p>
        ) : (
          <NumberField label="نرخ پاداش (سالانه، ساده)" value={rewardApr} onChange={(v) => setRewardApr(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="٪" />
        )}
        <NumberField label="هزینه‌های ورود و خروج" value={costs} onChange={(v) => setCosts(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" help="گس و کارمزدها" />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-secondary">جفت دو استیبل‌کوین دلاری است؟</span>
          <Segmented<'no' | 'yes'> value={stable ? 'yes' : 'no'} onChange={(v) => setStable(v === 'yes')} label="جفت استیبل" size="sm" options={[{ id: 'no', label: 'نه' }, { id: 'yes', label: 'بله' }]} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm text-secondary">نوع پوزیشن</span>
          <Segmented<'full' | 'range'> value={kind} onChange={setKind} label="نوع پوزیشن" size="sm" options={[{ id: 'full', label: 'تمام‌بازه (x·y=k)' }, { id: 'range', label: 'بازه‌ی متمرکز' }]} />
        </div>
        {kind === 'range' && (
          <>
            <NumberField label="پایین بازه، زیر قیمت فعلی" value={below} onChange={(v) => setBelow(Number.isFinite(v) ? v : 10)} suffix="٪" />
            <NumberField label="بالای بازه، بالای قیمت فعلی" value={above} onChange={(v) => setAbove(Number.isFinite(v) ? v : 10)} suffix="٪" />
          </>
        )}
        <NumberField label="سناریوی دلخواه: تغییر قیمت A نسبت به B" value={custom} onChange={setCustom} suffix="٪" note="مثبت یعنی A گران‌تر شود." />
      </div>

      {rows.length > 0 && (
        <div className="sx-card p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[40rem]">
            <caption className="text-right text-xs text-muted px-4 pt-3 pb-1">سناریوی فرضی — پیش‌بینی نیست. قیمت <bdi dir="ltr">{b}</bdi> ثابت فرض شده؛ مسیر قیمت خط مستقیم فرض شده.</caption>
            <thead>
              <tr className="text-xs text-secondary border-y border-default text-right">
                <th className="py-2 px-4 font-normal">تغییر قیمت <bdi dir="ltr">{a}</bdi></th>
                <th className="py-2 px-2 font-normal">نتیجه در برابر HODL</th>
                <th className="py-2 px-2 font-normal">ارزش پوزیشن</th>
                <th className="py-2 px-2 font-normal">نگه‌داشتن (HODL)</th>
                <th className="py-2 px-2 font-normal">تغییر ارزش نسبت به HODL</th>
                <th className="py-2 px-2 font-normal">کارمزد</th>
                <th className="py-2 px-4 font-normal">پاداش</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.move} className="border-b border-default">
                  <td className="py-2 px-4">
                    <Num>{formatPercent(r.move * 100, 1, true)}</Num>
                    {r.inRange < 1 && (
                      <span className="block text-xs text-warning">
                        <Num>{formatPercent(r.inRange * 100, 0)}</Num> مسیر در بازه
                      </span>
                    )}
                  </td>
                  <td className={`py-2 px-2 font-semibold ${r.vsHodlUsd === null ? '' : r.vsHodlUsd >= 0 ? 'text-success' : 'text-danger'}`}>{r.vsHodlUsd === null ? '—' : <Num>{signed(r.vsHodlUsd)}</Num>}</td>
                  <td className="py-2 px-2"><Num>{usd(r.positionUsd)}</Num></td>
                  <td className="py-2 px-2"><Num>{usd(r.hodlUsd)}</Num></td>
                  <td className="py-2 px-2 text-danger"><Num>{signed(r.ilUsd)}</Num></td>
                  <td className="py-2 px-2">{r.feesUsd === null ? '—' : <Num>{usd(r.feesUsd)}</Num>}</td>
                  <td className="py-2 px-4"><Num>{usd(r.rewardsUsd)}</Num></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {input.feeAprPct !== null && (
        <p className="text-sm text-secondary leading-7">
          {be.down === null && be.up === null ? (
            'کارمزد و پاداش هزینه‌ها را نمی‌پوشاند.'
          ) : (
            <>
              حد سربه‌سر در برابر HODL: کارمزد و پاداش تا وقتی تغییر ارزش را می‌پوشاند که قیمت <bdi dir="ltr">{a}</bdi> نسبت به <bdi dir="ltr">{b}</bdi> بین{' '}
              {be.down === null ? 'هر افتی' : <Num>{formatPercent(be.down * 100, 1, true)}</Num>} و {be.up === null ? 'هر رشدی' : <Num>{formatPercent(be.up * 100, 1, true)}</Num>} تغییر کند.
            </>
          )}
        </p>
      )}

      <ul className="text-xs text-muted leading-6 list-disc ps-5">
        <li>«تغییر ارزش نسبت به HODL» همان زیان ناپایدار است؛ با برگشت قیمت کم می‌شود ولی اگر در همان قیمت خارج شوید قطعی است.</li>
        <li>در بازه‌ی متمرکز، بیرون از بازه کارمزدی نیست و پوزیشن کاملاً به یکی از دو دارایی تبدیل می‌شود.</li>
        <li>خزانه‌های بازتنظیم‌شونده (مثل Kamino Liquidity) به مسیر قیمت وابسته‌اند و فرمول بسته ندارند؛ برای آن‌ها تاریخچه‌ی قیمت سهم در برابر HODL شاهد اصلی است و اینجا مدل نشده‌اند.</li>
        <li>
          کارمزد با نرخ ثابت روی میانگین ارزش پوزیشن حساب شد (<Num>{formatNumber(input.days, 0)}</Num> روز)؛ حجم معاملات آینده معلوم نیست.
        </li>
      </ul>
    </section>
  );
}
