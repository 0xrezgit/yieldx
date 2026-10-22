import { formatMultiplier, formatPercent, formatUSDCompact } from '../utils/formatting';
import { marketClock, type LongShortAnalysis, type LongShortInput } from './model';
import type { LongShortRow } from './types';

export type ReviewTone = 'good' | 'warn' | 'bad' | 'info';
export interface ReviewItem {
  tone: ReviewTone;
  text: string;
}

const RISK_TONE: Record<string, ReviewTone> = { none: 'good', low: 'good', medium: 'warn', high: 'bad' };
const RISK_FA: Record<string, string> = { none: 'بدون ریسک', low: 'کم', medium: 'متوسط', high: 'زیاد' };
const pct = (x: number, d = 1) => formatPercent(x, d);
const dayTime = (sec: number) => new Date(sec * 1000).toLocaleString('fa-IR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/**
 * The checks one market needs before a price view on it, in plain Persian, worst first:
 * the oracle (Pendle's own rating), stock market hours, the money market's liquidity and
 * rate curve, distance to liquidation, and the same view as a perpetual.
 */
export function reviewLongShort(row: LongShortRow, a: LongShortAnalysis, i: LongShortInput, nowSec = Date.now() / 1000): ReviewItem[] {
  const out: ReviewItem[] = [];
  const debtUsd = i.capital * (row.side === 'long' ? a.leverage - 1 : a.leverage);

  // Distance to liquidation.
  const dist = Math.abs(a.liqMove);
  if (a.healthPct < 0.05) out.push({ tone: 'bad', text: `فاصله تا لیکوییدشدن فقط ${pct(dist * 100)} حرکت قیمت است؛ یک نوسان عادی روزانه کافی است.` });
  else if (a.healthPct < 0.12) out.push({ tone: 'warn', text: `لیکوییدشدن با ${pct(dist * 100)} حرکت ${row.side === 'long' ? 'پایین' : 'بالا'}ی قیمت؛ اهرم کمتر فاصله را بیشتر می‌کند.` });

  // Liquidity of the money market.
  if (row.liquidityUsd !== null && row.liquidityUsd < debtUsd) out.push({ tone: 'bad', text: `نقدینگی قابل وام بازار (${formatUSDCompact(row.liquidityUsd)}) کمتر از وام این موقعیت (${formatUSDCompact(debtUsd)}) است؛ باز نمی‌شود.` });
  else if (row.liquidityUsd !== null && row.liquidityUsd < 250_000) out.push({ tone: 'warn', text: `نقدینگی قابل وام کم است (${formatUSDCompact(row.liquidityUsd)}): هم بستن و افزایش موقعیت سخت‌تر است، هم نرخ وام با وام دیگران زود بالا می‌رود.` });

  // Stock oracle hours.
  const clock = marketClock(row.marketHours, nowSec);
  if (row.category === 'stocks')
    out.push({
      tone: 'warn',
      text: `قیمت این سهم فقط وقتی بازار سهام باز است به‌روز می‌شود، ولی موقعیت ۲۴/۷ باز است. وقتی بازار بسته است قیمت ثابت می‌ماند و در باز شدن ممکن است با جهش حرکت کند و موقعیت یک‌باره لیکویید شود.${clock ? ` الان ${clock.open ? 'باز است' : 'بسته است'}${clock.next ? `؛ ${clock.open ? 'بسته می‌شود' : 'باز می‌شود'}: ${dayTime(clock.next)} (UTC)` : ''}.` : ''}`,
    });

  // Rate curve.
  if (row.utilization !== null && row.optimalUtilization !== null && row.utilization >= row.optimalUtilization - 0.02)
    out.push({ tone: 'warn', text: `استفاده از بازار وام ${pct(row.utilization * 100, 0)} است، نزدیک نقطه‌ی پیچ منحنی (${pct(row.optimalUtilization * 100, 0)}): بعد از آن نرخ وام تند بالا می‌رود و هزینه‌ی نگه‌داری می‌پرد.` });
  if (row.borrow7dPct !== null && Math.abs(row.borrowNowPct - row.borrow7dPct) > 1)
    out.push({ tone: 'info', text: `نرخ وام امروز ${pct(row.borrowNowPct, 2)} و میانگین ۷ روز ${pct(row.borrow7dPct, 2)} است؛ حساب با بیشترِ این دو انجام شد.` });

  // Oracle, as Pendle rates it.
  if (row.risk) {
    const tone = RISK_TONE[row.risk.level] ?? 'info';
    out.push({ tone, text: `ریسک اوراکل به ارزیابی پندل: ${RISK_FA[row.risk.level] ?? row.risk.level}.${row.risk.summary ? ` ${row.risk.summary}` : ''}` });
    for (const it of row.risk.items) if ((RISK_TONE[it.level] ?? 'info') !== 'good') out.push({ tone: RISK_TONE[it.level] ?? 'info', text: `${it.name} (${it.label}): ${it.text}` });
  }

  // Liquidation penalty.
  if (a.liqPenalty !== null) out.push({ tone: 'info', text: `لیکوییدکننده در Morpho ${pct(a.liqPenalty * 100)} پاداش روی وامی که می‌پردازد برمی‌دارد و می‌تواند کل موقعیت را یک‌جا ببندد.` });
  else out.push({ tone: 'info', text: `پاداش لیکوییدکننده‌ی ${row.protocol} برای این دارایی در API نیامده؛ در لیکوییدشدن، بیش از فاصله‌ی قیمت از دست می‌رود.` });

  // Holding.
  if (a.holdingPct >= 0) out.push({ tone: 'good', text: `با قیمت ثابت سالی ${pct(a.holdingPct, 2)} روی سرمایه درآمد دارد: سود وثیقه از بهره‌ی وام بیشتر است.` });
  else out.push({ tone: 'info', text: `هزینه‌ی نگه‌داری سالی ${pct(-a.holdingPct, 2)} روی سرمایه است؛ برای سربه‌سر شدن در این مدت، قیمت باید ${pct(Math.abs(a.breakEvenMove) * 100, 2)} ${row.side === 'long' ? 'بالا' : 'پایین'} برود.` });

  // The perp beside it.
  if (a.perp) {
    const p = a.perp;
    const cheaper = p.costGapUsd < 0 ? 'PendleLoop' : `پرپ ${p.ref.venue}`;
    out.push({ tone: 'info', text: `همین موقعیت روی ${p.ref.venue} (${p.ref.coin}): فاندینگ میانگین ۷ روز ${formatPercent(p.fundingPct, 1, true)} در سال (مثبت یعنی Long می‌پردازد). در این مدت ${cheaper} حدود ${formatUSDCompact(Math.abs(p.costGapUsd))} ارزان‌تر است.` });
    if (p.liqMove !== null && Math.abs(p.liqMove) > dist + 0.02)
      out.push({ tone: 'info', text: `با همین اهرم ${formatMultiplier(a.leverage, 1)}، پرپ حدود ${pct(Math.abs(p.liqMove) * 100)} حرکت تحمل می‌کند و اینجا ${pct(dist * 100)}: حد LLTV بازار وام زودتر از حاشیه‌ی نگه‌داری پرپ می‌رسد.` });
    if (p.liqMove === null) out.push({ tone: 'info', text: `اهرم ${formatMultiplier(a.leverage, 1)} از سقف ${p.ref.venue} (${formatMultiplier(p.ref.maxLeverage, 0)}) بیشتر است.` });
    if (row.base.symbol !== p.ref.coin.replace(/^.*:/, '') && /steth|weeth|wbtc|cbbtc/i.test(row.base.symbol)) out.push({ tone: 'info', text: `${row.base.symbol} با ${p.ref.coin} مقایسه شد؛ قیمتشان نزدیک ولی یکی نیست.` });
  }

  if (row.feeRate === 0) out.push({ tone: 'good', text: 'کارمزد PendleLoop برای Long/Short تا ۳۱ دسامبر صفر است.' });
  const order: ReviewTone[] = ['bad', 'warn', 'info', 'good'];
  return out.sort((x, y) => order.indexOf(x.tone) - order.indexOf(y.tone));
}
