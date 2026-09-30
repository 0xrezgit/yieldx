import type { Estimate, Opportunity, Placement } from '../../types/opportunity';
import { tokenClass } from '../merkl/vetting';
import { formatNumber } from '../utils/formatting';

/** Short Persian names of the families, as shown in a row. */
export const FAMILY_LABEL: Record<string, string> = {
  lend: 'وام‌دهی',
  vault: 'خزانه',
  'fixed-lend': 'نرخ ثابت',
  pt: 'PT',
  stake: 'نگه‌داری',
  lp: 'LP',
  leverage: 'اهرم',
  yt: 'YT',
  borrow: 'وام',
};

export const PLACEMENT_LABEL: Record<Placement, string> = {
  ranked: 'رتبه‌بندی‌شده',
  unprofitable: 'سود صفر یا منفی',
  'needs-model': 'نیازمند مدل خروج یا داده‌ی بیشتر',
  'no-capacity': 'فاقد ظرفیت یا شرایط ورود',
  stale: 'داده‌ی منقضی',
  insufficient: 'داده‌ی ناکافی',
  inactive: 'متوقف یا سررسیدشده',
  rejected: 'ردشده در اعتبارسنجی',
};

/** How the money comes back, in a word or two. */
export function exitShort(e: Estimate, o: Opportunity): string {
  if (o.family === 'leverage' && o.maturity) return 'در سررسید';
  switch (o.exit.type) {
    case 'maturity':
      return 'در سررسید';
    case 'secondary':
      return 'سررسید یا فروش';
    case 'queue':
      return 'صف برداشت';
    case 'instant': {
      const w = o.capacity.withdrawableNowUsd;
      if (w === null) return o.family === 'leverage' ? 'باز کردن لوپ' : 'فوری';
      return w >= e.allocatable ? 'فوری' : 'فوری، محدود';
    }
    default:
      return 'نامعلوم';
  }
}

/**
 * At most two short tags for what the result depends on most — shown with color
 * and text, never color alone. Data quality and investment risk are separate tags.
 */
export function badgesOf(e: Estimate, o: Opportunity): string[] {
  const out: string[] = [];
  if (e.leverage) out.push(`اهرم ${formatNumber(e.leverage.leverage, 1)}×`);
  if (o.maturity && e.earningDays < e.days) out.push(`سررسید روز ${formatNumber(Math.ceil(e.earningDays), 0)}`);
  const lead = o.assets.deposit[0]?.symbol;
  if (lead && tokenClass({ symbol: lead }) !== 'usd') out.push('وابسته به قیمت');
  if (o.unofficialSource) out.push('منبع غیررسمی');
  if (o.protocol.version === 'vault-v2') out.push('نرخ تاریخی');
  if (e.unallocated > 0.005 * e.capital) out.push('ظرفیت محدود');
  if (e.quality === 'partial') out.push('برآورد ناقص');
  if (e.rewards > 0) out.push('با پاداش');
  return [...new Set(out)].slice(0, 2);
}
