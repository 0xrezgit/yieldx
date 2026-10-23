'use client';

import { AlertTriangle } from 'lucide-react';
import config from '../../config/lp-pools.json';
import { CAP_TARGET, capFactor, chainNotice, positionRewardApr, rewardToRevenue, type PoolReward } from '../../lib/lp/rewards';
import { expectedDaysInRange, stayInRange, symmetricRange } from '../../lib/lp/range-time';
import { concentration, type PoolShape } from '../../lib/lp/scenarios';
import { networkByChainId } from '../../lib/registry/networks';
import { formatDate, formatGregorian, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Segmented } from './parts';

/**
 * The LP analyzer's Aero parts and range odds: what a staked position's AERO rate
 * rests on (and why the sites' numbers are higher), how long a range holds, and
 * what to know before entering or leaving.
 */

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);

/** «۳ ساعت», «۴ روز», «بیش از یک سال». */
export function formatSpan(days: number): string {
  if (!Number.isFinite(days)) return days === Infinity ? 'همیشه' : '—';
  if (days < 1 / 24) return 'کمتر از یک ساعت';
  if (days < 1) return `${formatNumber(Math.round(days * 24), 0)} ساعت`;
  if (days > 365) return 'بیش از یک سال';
  return `${formatNumber(days, days < 10 ? 1 : 0)} روز`;
}

/** The staked position's AERO rate, what it rests on, and Aero's cap. */
export function RewardSummary({ reward, shape, capital, capped, onCapped }: { reward: PoolReward; shape: PoolShape; capital: number; capped: boolean; onCapped: (v: boolean) => void }) {
  const apr = positionRewardApr(reward, shape, capital, capped);
  const alone = positionRewardApr(reward, shape, 0, capped);
  const ratio = rewardToRevenue(reward);
  const over = ratio !== null && ratio > CAP_TARGET;
  const ranged = shape.kind === 'range';
  return (
    <div className="flex flex-col gap-2 text-sm text-secondary leading-7">
      <p>
        پاداش <bdi dir="ltr">{reward.token}</bdi> این پوزیشن: <b className="text-primary"><Num>{formatPercent(apr, 1)}</Num></b> سالانه{ranged && ' تا وقتی قیمت داخل بازه است'}
        <span className="text-xs block">
          از پاداش هفتگی همین حالای استخر (<Num>{usd(reward.weeklyUsd)}</Num>) به ازای نقدینگی stake‌شده‌ی داخل بازه؛ تمام‌بازه <Num>{formatPercent(reward.aprPct * (capped ? capFactor(reward) : 1), 2)}</Num>.
          {alone > 0 && apr / alone < 0.99 && (
            <>
              {' '}سرمایه‌ی خود شما سهم هر دلار را کم می‌کند: بدون آن <Num>{formatPercent(alone, 1)}</Num> بود.
            </>
          )}{' '}
          اگر نقدینگی stake‌شده‌ی داخل بازه دو برابر شود، این نرخ تقریباً نصف می‌شود.
        </span>
      </p>
      {ratio === null ? (
        <p className="text-xs">درآمد کارمزد استخر هنوز معلوم نیست؛ سقف پاداش Aero (حدود {formatNumber(CAP_TARGET, 1)} برابر درآمد) حساب نشده.</p>
      ) : over ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex flex-col gap-2">
          <p className="text-warning flex gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-1.5" aria-hidden />
            <span>
              پاداش این استخر <Num>{formatNumber(ratio, 1)}</Num> برابر درآمد کارمزد آن است (<Num>{usd(reward.revenueWeeklyUsd!)}</Num> در هفته، از <Num>{formatNumber(reward.revenueDays, 0)}</Num> روز اخیر). Aero پاداش هر استخر را به مضربی از درآمدش محدود می‌کند، به‌طور میانگین حدود <Num>{formatNumber(CAP_TARGET, 1)}</Num> برابر؛ پس این نرخ احتمالاً پایین می‌آید.
            </span>
          </p>
          <Segmented<'cap' | 'now'>
            value={capped ? 'cap' : 'now'}
            onChange={(v) => onCapped(v === 'cap')}
            label="نرخ پاداش"
            size="sm"
            options={[
              { id: 'cap', label: <>با سقف <Num>{formatNumber(CAP_TARGET, 1)}</Num> برابر درآمد</> },
              { id: 'now', label: 'نرخ همین حالا' },
            ]}
          />
          <p className="text-xs text-muted">درآمد اینجا فقط کارمزد معاملات است؛ پرداخت‌های پروژه‌ها به استخر (Liquidity Payments) دیده نمی‌شود، پس سقف واقعی می‌تواند بالاتر باشد.</p>
        </div>
      ) : (
        <p className="text-xs">
          پاداش <Num>{formatNumber(ratio, 1)}</Num> برابر درآمد کارمزد استخر است؛ در حد سقف Aero (حدود <Num>{formatNumber(CAP_TARGET, 1)}</Num> برابر)، پس پایدارتر از استخرهایی است که چند برابر درآمدشان پاداش می‌دهند.
        </p>
      )}
    </div>
  );
}

/** The chance the price stays in this range, and how long it does on average. */
export function RangeOdds({ shape, vol, days }: { shape: PoolShape; vol: number; days: number }) {
  if (shape.kind !== 'range' || !(vol > 0)) return null;
  const at = (d: number) => stayInRange(shape, vol, d);
  const mean = expectedDaysInRange(shape, vol);
  const horizons = [...new Set([1, 7, days].filter((d) => d > 0))].sort((x, y) => x - y);
  return (
    <p className="text-sm text-secondary leading-7">
      احتمال ماندن قیمت در این بازه:{' '}
      {horizons.map((d, i) => (
        <span key={d} className="whitespace-nowrap">
          {i > 0 && '، '}
          <Num>{formatNumber(d, 0)}</Num> روز <b className={at(d) < 0.5 ? 'text-warning' : 'text-primary'}><Num>{formatPercent(at(d) * 100, 0)}</Num></b>
        </span>
      ))}
      ؛ به‌طور میانگین پس از <b className="text-primary">{formatSpan(mean)}</b> بیرون می‌رود.
      <span className="text-xs block">با نوسان سالانه‌ی <Num>{formatPercent(vol, 1)}</Num> همین جفت؛ قیمت واقعی جهش و روند دارد، پس تقریبی است. بیرون از بازه نه کارمزد هست نه پاداش.</span>
    </p>
  );
}

/**
 * Narrow to wide ranges side by side: the rate while in range against how long the
 * range lasts. Rates for fees (full-range basis) or the staked AERO rate.
 */
export function RangeLadder({ vol, days, capital, reward, capped, feeFullRangePct }: { vol: number; days: number; capital: number; reward: PoolReward | null; capped: boolean; feeFullRangePct: number | null }) {
  if (!(vol > 0) || (!reward && feeFullRangePct === null)) return null;
  const steps = vol < 15 ? [0.05, 0.1, 0.25, 0.5, 1, 2] : vol < 60 ? [0.5, 1, 2, 5, 10, 20] : [2, 5, 10, 20, 40, 80];
  const rows = steps.map((pct) => {
    const shape = symmetricRange(pct);
    const rate = reward ? positionRewardApr(reward, shape, capital, capped) : (feeFullRangePct as number) * concentration(shape);
    return { pct, rate, mean: expectedDaysInRange(shape, vol), stay: stayInRange(shape, vol, days) };
  });
  return (
    <section className="sx-card p-4 flex flex-col gap-3" aria-label="بازه‌ی باریک یا پهن">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-primary">بازه‌ی باریک‌تر: نرخ بیشتر روی کاغذ، خروج زودتر</h3>
        <p className="text-xs text-secondary leading-6">
          عددهای چند هزار درصدی سایت‌ها نرخ باریک‌ترین بازه‌اند، به شرط آنکه قیمت هیچ‌وقت بیرون نرود. این جدول همان نرخ را کنار مدت ماندن قیمت در بازه می‌گذارد ({reward ? <>پاداش <bdi dir="ltr">{reward.token}</bdi> با stake</> : 'کارمزد'}، با سرمایه‌ی شما).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted text-right">
              <th className="font-normal py-1.5">بازه</th>
              <th className="font-normal py-1.5">نرخ سالانه در بازه</th>
              <th className="font-normal py-1.5">میانگین ماندن</th>
              <th className="font-normal py-1.5">
                ماندن تا <Num>{formatNumber(days, 0)}</Num> روز
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {rows.map((r) => (
              <tr key={r.pct}>
                <td className="py-1.5">
                  <Num>±{formatPercent(r.pct, 2)}</Num>
                </td>
                <td className="py-1.5 text-primary">
                  <Num>{formatPercent(r.rate, r.rate >= 100 ? 0 : 1)}</Num>
                </td>
                <td className={`py-1.5 ${r.mean < 1 ? 'text-warning' : ''}`}>{formatSpan(r.mean)}</td>
                <td className={`py-1.5 ${r.stay < 0.5 ? 'text-warning' : ''}`}>
                  <Num>{formatPercent(r.stay * 100, 0)}</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted leading-6">هر بار که قیمت بیرون برود، باید بازه را دوباره بچینید: گس و معاوضه و گاهی پاداش از دست‌رفته. بازه‌ای کوتاه‌تر از چند روز، مگر با مدیریت خودکار، معمولاً روی کاغذ می‌ماند.</p>
    </section>
  );
}

/** What to know before entering an Aero pool, or about an old Aerodrome / Velodrome one. */
export function AeroNotes({ staked, aero, unstakedFee, legacyGauge, chainId }: { staked: boolean; aero: boolean; unstakedFee: number; legacyGauge: boolean; chainId?: number }) {
  const notice = chainId != null ? chainNotice(chainId) : null;
  const chain = chainId != null ? networkByChainId(chainId).nameFa : '';
  if (!aero && !legacyGauge && !notice) return null;
  return (
    <div className="rounded-lg border border-default bg-surface p-3 text-sm text-secondary leading-7 flex flex-col gap-1">
      <b className="text-primary">پیش از ورود بدانید</b>
      <ul className="list-disc ps-5 flex flex-col gap-1">
        {notice?.kind === 'withdraw' && (
          <li className="text-warning">
            سپرده‌های {chain} باید تا {formatDate(notice.by)} (<Num>{formatGregorian(notice.by)}</Num>) برداشته شوند.
          </li>
        )}
        {notice?.kind === 'sunset' && <li className="text-warning">در {chain} دیگر پاداشی داده نمی‌شود؛ معامله و برداشت ادامه دارد.</li>}
        {legacyGauge && (
          <li className="text-warning">
            این استخر قدیمی Aerodrome یا Velodrome است و از راه‌اندازی Aero ({formatDate(config.aero.launch)}) پاداشی نمی‌دهد. پوزیشنی که هنوز در gauge قدیمی stake است نه پاداش می‌گیرد نه کارمزد: unstake کنید تا کارمزد بگیرید، یا به استخر Aero همین جفت ببرید.
          </li>
        )}
        {aero && staked && (
          <>
            <li>با stake، کارمزد معاملات پوزیشن شما به دارندگان sAERO می‌رسد و شما فقط AERO می‌گیرید.</li>
            <li>اگر پیش از حداقل دوره‌ی stake برداشت کنید، پاداش انباشته‌ی آن پوزیشن سوزانده می‌شود. مدتش را Aero بسته به نوع دارایی و شرایط بازار تعیین می‌کند؛ پیش از ورود در صفحه‌ی استخر ببینید.</li>
            <li>AERO هنگام claim ساخته و پرداخت می‌شود؛ ارزش دلاری‌اش با قیمت AERO بالا و پایین می‌رود.</li>
            <li>پاداش‌ها پیوسته بین استخرها جابه‌جا می‌شوند (دارندگان sAERO چند بار در هفته تخصیص را عوض می‌کنند)؛ نرخ امروز برای فردا تضمینی نیست.</li>
          </>
        )}
        {aero && !staked && (
          <li>
            بدون stake کارمزد معاملات را می‌گیرید
            {unstakedFee > 0 ? (
              <>
                ، منهای سهم <Num>{formatPercent(unstakedFee * 100, 0)}</Num> پلتفرم (در نرخ کسر شده)
              </>
            ) : (
              '؛ در این شبکه سهم پلتفرم صفر است'
            )}
            ، ولی AERO نمی‌گیرید.
          </li>
        )}
      </ul>
    </div>
  );
}
