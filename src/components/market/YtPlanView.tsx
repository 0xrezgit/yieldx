'use client';

import { useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Flame, Gift, Receipt, Timer } from 'lucide-react';
import type { Cheapness, YtPlan } from '../../lib/calculators/yt-plan';
import { formatCompact, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';
import { Pill, signedPct } from '../opportunities/parts';

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const plain = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);
const tone = (x: number) => (x >= 0 ? 'text-success' : 'text-danger');
const LABEL = { low: 'بدبینانه', likely: 'محتمل', high: 'خوش‌بینانه' } as const;
const FEE_SOURCE: Record<YtPlan['feeSource'], string> = {
  'pendle-amm': 'کارمزد AMM پندل (روی کل اکسپوژر)',
  'exponent-book': 'دفتر سفارش Exponent (حدود ۰٫۰۵٪)',
  quote: 'از قیمت اجرایی همین مبلغ',
  assumed: 'فرضی (کارمزد این پروتکل معلوم نیست)',
};
export const CHEAP: Record<Cheapness, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' }> = {
  free: { label: 'پوینت رایگان', tone: 'success' },
  cheap: { label: 'پوینت ارزان‌تر از بقیه', tone: 'info' },
  fair: { label: 'قیمت پوینت در حد میانه', tone: 'warning' },
  dear: { label: 'پوینت گران‌تر از بقیه', tone: 'danger' },
};

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
        <span className="text-accent">{icon}</span> {title}
      </h4>
      {children}
    </section>
  );
}

const cell = 'py-2 px-2 sm:px-2.5 text-right whitespace-nowrap';

/**
 * «کارنامه‌ی YT» for one market and one amount: what is paid and what burns, the yield
 * received in three base-yield readings, an early exit day by day, every fee, and the
 * points with their cost — and whether they are cheap next to the other points markets.
 */
export function YtPlanView({ plan, name, days, cheap }: { plan: YtPlan; name: string; days: number; cheap?: { level: Cheapness; rank: number; of: number; basis: 'program' | 'exposure' } | null }) {
  const [valuePerM, setValuePerM] = useState(0);
  const likely = plan.maturity.find((x) => x.kind === 'likely')!;
  const prog = plan.program;
  const withPoints = prog && likely.points !== null && valuePerM > 0 ? likely.cashUsd + (likely.points * valuePerM) / 1e6 : null;
  const fees = plan.entry.feeUsd + plan.entry.gasUsd + plan.gasUsd.claim + likely.yieldFeeUsd;
  return (
    <div className="flex flex-col gap-5 text-sm">
      <p className="text-[15px] text-primary leading-7">
        با <b><Num>{plain(plan.capital)}</Num></b> YT <bdi dir="ltr">{name}</bdi> می‌خرید: حق بازده <b><Num>{plain(plan.entry.notionalUsd)}</Num></b> تا سررسید (<Num>{formatNumber(plan.entry.leverage, 1)}×</Num>)، <Num>{formatNumber(days, 0)}</Num> روز.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { k: 'می‌پردازید', v: <Num>{plain(plan.capital)}</Num>, t: 'text-primary' },
          { k: 'می‌سوزد (YT در سررسید صفر)', v: <Num>{plain(plan.burnedUsd)}</Num>, t: 'text-danger' },
          { k: 'بازده دریافتی (محتمل)', v: <Num>{plain(likely.yieldUsd)}</Num>, t: 'text-success' },
          { k: 'نتیجه‌ی نقدی تا سررسید', v: <Num>{usd(likely.cashUsd)}</Num>, t: tone(likely.cashUsd) },
        ].map((x) => (
          <div key={x.k} className="rounded-lg border border-default bg-surface px-3 py-2">
            <div className="text-[11px] text-muted leading-snug">{x.k}</div>
            <div className={`text-base font-semibold ${x.t}`}>{x.v}</div>
          </div>
        ))}
      </div>

      <Section icon={<Flame size={15} aria-hidden />} title={`نگه‌داری تا سررسید (${formatNumber(days, 0)} روز)`}>
        <div className="overflow-x-auto rounded-lg border border-default">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-canvas text-[11px] sm:text-xs text-muted">
              <tr>
                <th className={`${cell} font-medium`}>حالت</th>
                <th className={`${cell} font-medium`}>بازده پایه</th>
                <th className={`${cell} font-medium`}>بازده دریافتی</th>
                <th className={`${cell} font-medium`}>نتیجه‌ی نقدی</th>
                {prog && <th className={`${cell} font-medium`}>پوینت</th>}
                {prog && <th className={`${cell} font-medium`}>هزینه‌ی هر ۱M پوینت</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {plan.maturity.map((r) => (
                <tr key={r.kind} className={r.kind === 'likely' ? 'bg-brand/[0.06]' : ''}>
                  <td className={`${cell} ${r.kind === 'likely' ? 'font-semibold text-primary' : 'text-secondary'}`}>{LABEL[r.kind]}</td>
                  <td className={cell}><Num>{formatPercent(r.basePct, 2)}</Num></td>
                  <td className={cell}><Num>{plain(r.yieldUsd)}</Num></td>
                  <td className={`${cell} font-medium ${tone(r.cashUsd)}`}>
                    <span className="flex flex-col leading-tight">
                      <Num>{usd(r.cashUsd)}</Num>
                      <span className="text-[11px] opacity-80"><Num>{signedPct((r.cashUsd / plan.capital) * 100, 1)}</Num></span>
                    </span>
                  </td>
                  {prog && <td className={cell}>{r.points === null ? '—' : <Num>{formatCompact(r.points)}</Num>}</td>}
                  {prog && <td className={cell}>{r.costPerMillion === null ? '—' : r.costPerMillion === 0 ? <span className="text-success">رایگان</span> : <Num>{plain(r.costPerMillion)}</Num>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section icon={<Timer size={15} aria-hidden />} title="خروج زودتر">
        <p className={`flex items-center gap-1.5 ${plan.freeUntil !== null ? 'text-success' : 'text-warning'}`}>
          {plan.freeUntil !== null ? <CircleCheck size={15} aria-hidden /> : <CircleX size={15} aria-hidden />}
          {plan.freeUntil !== null ? (
            plan.freeUntil >= days ? 'تا سررسید هم بی‌ضرر است (با بازده پایه‌ی محتمل).' : <>اگر نرخ بازار تغییر نکند، خروج تا روز <Num>{formatNumber(plan.freeUntil, 0)}</Num> بی‌ضرر است.</>
          ) : (
            'با نرخ بازار ثابت هیچ روزی بی‌ضرر نیست؛ هر روز ماندن هزینه دارد.'
          )}
        </p>
        {plan.exits.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-canvas text-[11px] sm:text-xs text-muted">
                <tr>
                  <th className={`${cell} font-medium`}>فروش در روز</th>
                  <th className={`${cell} font-medium whitespace-normal`}>نتیجه با نرخ بازار ثابت</th>
                  <th className={`${cell} font-medium whitespace-normal`}>بی‌ضرر اگر نرخ ضمنی آن روز</th>
                  {prog && <th className={`${cell} font-medium`}>پوینت تا آن روز</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {plan.exits.map((x) => (
                  <tr key={x.day}>
                    <td className={cell}><Num>{formatNumber(x.day, 0)}</Num></td>
                    <td className={`${cell} ${tone(x.cashUsd)}`}><Num>{usd(x.cashUsd)}</Num></td>
                    <td className={cell}>
                      {x.breakEvenPct === -Infinity ? <span className="text-success">با هر نرخی</span> : x.breakEvenPct === Infinity ? <span className="text-danger">ممکن نیست</span> : <>≥ <Num>{formatPercent(x.breakEvenPct, 2)}</Num></>}
                    </td>
                    {prog && <td className={cell}>{x.points === null ? '—' : <Num>{formatCompact(x.points)}</Num>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted leading-6">نرخ ضمنی روز فروش قیمت YT را تعیین می‌کند؛ با اهرم <Num>{formatNumber(plan.entry.leverage, 0)}×</Num>، چند واحد تغییر آن از بقیه‌ی عددها مهم‌تر است.</p>
      </Section>

      <Section icon={<Receipt size={15} aria-hidden />} title="کارمزدها (تا سررسید)">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {[
            [plan.feeSource === 'quote' ? 'کارمزد و اثر قیمت خرید' : `کارمزد خرید (${formatPercent(plan.entry.feePct, 2)} سرمایه)`, plan.feeSource === 'quote' ? null : plan.entry.feeUsd],
            ['سهم پروتکل از بازده', likely.yieldFeeUsd],
            ['گس خرید (تأیید + خرید)', plan.entry.gasUsd],
            ['گس دریافت بازده', plan.gasUsd.claim],
          ].map(([k, v]) => (
            <div key={k as string} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-default">
              <dt className="text-secondary">{k}</dt>
              <dd className={v === null ? 'text-muted text-xs' : 'text-danger'}>{v === null ? 'داخل قیمت خرید' : <Num>{plain(v as number)}</Num>}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 py-1.5 sm:col-span-2">
            <dt className="text-primary font-medium">جمع کارمزدها</dt>
            <dd className="text-danger font-semibold"><Num>{plain(fees)}</Num></dd>
          </div>
        </dl>
        <p className="text-xs text-muted">منبع کارمزد خرید: {FEE_SOURCE[plan.feeSource]}. فروش پیش از سررسید کارمزد دوباره دارد و در جدول «خروج زودتر» حساب شده است.</p>
      </Section>

      <Section icon={<Gift size={15} aria-hidden />} title="پوینت">
        {cheap && (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={CHEAP[cheap.level].tone}>{CHEAP[cheap.level].label}</Pill>
            <span className="text-xs text-muted">
              رتبه‌ی <Num>{formatNumber(cheap.rank, 0)}</Num> از <Num>{formatNumber(cheap.of, 0)}</Num> {cheap.basis === 'program' ? `بازار همین برنامه (${prog?.name ?? ''})` : 'بازار پوینتی، به ازای هر دلار-روز اکسپوژر'} — ارزان‌ترین اول
            </span>
          </div>
        )}
        {prog && likely.points !== null ? (
          <>
            <p className="text-secondary leading-7">
              <bdi dir="ltr">{prog.name}</bdi>: روزانه حدود <b className="text-primary"><Num>{formatCompact(plan.pointsPerDay ?? 0)}</Num></b> پوینت (ضریب YT <Num>{formatNumber(prog.ytMultiplier, 0)}×</Num>)، تا سررسید <b className="text-primary"><Num>{formatCompact(likely.points)}</Num></b>.{' '}
              {likely.costPerMillion === 0 ? (
                <span className="text-success">پوینت‌ها رایگان‌اند: نتیجه‌ی نقدی ضرر ندارد.</span>
              ) : likely.costPerMillion !== null ? (
                <>هر ۱M پوینت برایتان <b className="text-primary"><Num>{plain(likely.costPerMillion)}</Num></b> تمام می‌شود؛ اگر ایردراپ بیشتر از این بیرزد، سودده است.</>
              ) : null}
            </p>
            <label className="flex flex-wrap items-center gap-2 text-secondary">
              اگر هر ۱M پوینت بیرزد
              <input type="number" min={0} value={valuePerM} onChange={(e) => setValuePerM(Math.max(0, e.target.valueAsNumber || 0))} className="w-24 px-2 text-sm !min-h-9" aria-label="ارزش فرضی هر یک میلیون پوینت به دلار" />
              دلار
              {withPoints !== null && (
                <span>
                  ← نتیجه با پوینت: <b className={tone(withPoints)}><Num>{usd(withPoints)}</Num></b>
                </span>
              )}
            </label>
          </>
        ) : (
          <p className="text-secondary leading-7">
            {prog ? '' : 'این پروتکل تعداد پوینت را منتشر نمی‌کند. '}
            مبنای بیشتر برنامه‌ها اکسپوژر دلاری در روز است: <b className="text-primary"><Num>{formatCompact(plan.exposureDollarDays)}</Num></b> دلار-روز تا سررسید؛ هزینه‌ی هر ۱۰۰۰ دلار-روز{' '}
            {plan.costPerKDollarDay === 0 ? <span className="text-success">صفر (رایگان)</span> : <b className="text-primary"><Num>{formatUSD(plan.costPerKDollarDay, 3)}</Num></b>}.
          </p>
        )}
      </Section>
    </div>
  );
}
