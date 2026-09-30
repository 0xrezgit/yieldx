import type { Opportunity } from '../../types/opportunity';
import { tokenClass } from '../merkl/vetting';
import { formatNumber } from '../utils/formatting';
import { settlementFeeAt } from './book';
import { rateAfterBorrow } from './curve';
import { periodGrowth } from './rates';

/**
 * «هزینه‌ی تأمین سرمایه» — what borrowing an amount for a period costs, per
 * market. Kept apart from the profit ranking: a loan is a cost, not a yield (it
 * enters the ranking only inside a loop, where the money has a destination).
 *
 * - Variable (Morpho Blue, Aave V4): rate after the user's own borrow (utilization
 *   rises), held for the period; cost = amount × growth(rate, days).
 * - Fixed (Morpho Midnight): the borrower sells units into the bids — receives
 *   price − settlement fee per unit — and owes one loan token per unit at
 *   maturity. The price is fixed only until that maturity.
 */

export type BorrowClass = 'usd' | 'eth' | 'btc' | 'all';

export interface BorrowRow {
  key: string;
  o: Opportunity;
  kind: 'variable' | 'fixed';
  /** Yearly rate: after the user's borrow (variable) or implied by the fill (fixed), %. */
  ratePct: number | null;
  /** Interest for the amount over the days counted, USD. */
  costUsd: number | null;
  /** Days the cost covers (a fixed loan only until its maturity). */
  days: number;
  collateral: { symbol: string | null; maxLtv: number }[];
  notes: string[];
  /** Why it cannot serve this amount / period, when it cannot. */
  blocked: string | null;
}

const classOf = (o: Opportunity) => {
  const s = o.assets.deposit[0]?.symbol;
  return s ? tokenClass({ symbol: s }) : 'other';
};

export function borrowQuotes(opps: Opportunity[], amountUsd: number, days: number, cls: BorrowClass, now = Date.now()): { rows: BorrowRow[]; blocked: BorrowRow[] } {
  const rows: BorrowRow[] = [];
  const blocked: BorrowRow[] = [];
  for (const o of opps) {
    const side = o.borrow;
    if (!side || o.family === 'leverage') continue;
    if (cls !== 'all' && classOf(o) !== cls) continue;
    const collateral = side.collateral.map((c) => ({ symbol: c.token.symbol, maxLtv: c.maxLtv }));
    const base = { key: `${o.key}:borrow`, o, collateral, notes: [] as string[], blocked: null as string | null };

    if (o.book) {
      const b = o.book;
      const ms = o.maturity ? new Date(o.maturity).getTime() - now : NaN;
      const daysLeft = ms / 86_400_000;
      if (!(daysLeft > 0) || !(b.unitUsd > 0)) continue;
      const sf = settlementFeeAt(b.settlementFee, ms / 1000);
      // Sell units into bids until `amount` loan tokens are received.
      let need = amountUsd / b.unitUsd;
      let units = 0;
      for (const l of [...b.bids].sort((x, y) => y.price - x.price)) {
        if (need <= 0) break;
        const p = l.price - sf;
        if (!(p > 0)) continue;
        const u = Math.min(l.units, need / p);
        units += u;
        need -= u * p;
      }
      const row: BorrowRow = { ...base, kind: 'fixed', days: Math.min(days, daysLeft), ratePct: null, costUsd: null };
      if (need > 1e-9) {
        blocked.push({ ...row, blocked: 'عمق دفتر خرید برای این مبلغ کافی نیست.' });
        continue;
      }
      const received = amountUsd / b.unitUsd;
      row.costUsd = (units - received) * b.unitUsd;
      row.ratePct = (Math.pow(units / received, 365 / daysLeft) - 1) * 100;
      row.days = daysLeft;
      row.notes.push(`نرخ ثابت تا سررسید (${formatNumber(daysLeft, 0)} روز)؛ کارمزد تسویه ${b.settlementFee.basis === 'max' ? 'با بیشینه‌ی مجاز' : ''} در قیمت فروش لحاظ شده.`);
      if (daysLeft < days) row.notes.push(`افق کوتاه‌تر از درخواست: هزینه فقط تا سررسید است؛ تمدید با نرخ امروز فرض نشده.`);
      if (daysLeft > days) row.notes.push('بازپرداخت زودتر یعنی خرید واحدها از دفتر فروش به قیمت آن روز؛ هزینه‌ی آن مدل نشده.');
      rows.push(row);
      continue;
    }

    const r0 = side.ratePct;
    if (r0 === null) continue;
    let r = r0;
    if (side.curve) {
      const after = rateAfterBorrow(side.curve, amountUsd, r0);
      if (after === null) {
        blocked.push({ ...base, kind: 'variable', ratePct: r0, costUsd: null, days, blocked: 'این مبلغ از نقدینگی بازار بیشتر است.' });
        continue;
      }
      r = after;
    } else base.notes.push('اثر وام شما بر نرخ مدل نشده است.');
    if (side.availableUsd !== null && side.availableUsd < amountUsd) {
      blocked.push({ ...base, kind: 'variable', ratePct: r, costUsd: null, days, blocked: 'نقدینگی قابل وام کمتر از مبلغ شماست.' });
      continue;
    }
    if (!collateral.length) {
      blocked.push({ ...base, kind: 'variable', ratePct: r, costUsd: null, days, blocked: 'وثیقه‌ی قابل قبولی گزارش نشده است.' });
      continue;
    }
    const g = periodGrowth({ value: r, kind: 'apy' }, days);
    if (side.premiumUnknown) base.notes.push('Aave V4: صرف ریسک کاربر که به وثیقه‌ی شما بستگی دارد اضافه نشده؛ هزینه‌ی واقعی می‌تواند بیشتر باشد.');
    base.notes.push('نرخ متغیر؛ برای کل دوره ثابت فرض شد.');
    rows.push({ ...base, kind: 'variable', ratePct: r, costUsd: g === null ? null : amountUsd * g, days });
  }
  rows.sort((a, b) => (a.costUsd ?? Infinity) / a.days - (b.costUsd ?? Infinity) / b.days);
  return { rows, blocked };
}
