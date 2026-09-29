import { networkByChainId } from '../registry/networks';
import type { MerklAction, MerklCampaign, MerklHook, MerklRateKind, MerklTokenType } from './types';

/** What the user does to earn — in Persian, with a one-line meaning. */
export const ACTION: Record<MerklAction, { label: string; hint: string }> = {
  LEND: { label: 'وام‌دهی', hint: 'سپرده در بازار وام یا vault' },
  POOL: { label: 'تأمین نقدینگی', hint: 'افزودن نقدینگی به استخر' },
  HOLD: { label: 'نگه‌داری', hint: 'نگه‌داشتن توکن در کیف‌پول' },
  BORROW: { label: 'وام‌گیری', hint: 'پاداش روی مبلغ وام، نه سرمایه' },
  DROP: { label: 'توزیع خارجی', hint: 'محاسبه بیرون از Merkl؛ شرایط شفاف نیست' },
  SWAP: { label: 'سواپ', hint: 'پاداش بر حسب حجم معامله، نه سرمایه' },
  STAKE: { label: 'استیک', hint: 'استیک توکن یا LP در gauge' },
  LONG: { label: 'لانگ', hint: 'موقعیت اهرمی خرید' },
  SHORT: { label: 'شورت', hint: 'موقعیت اهرمی فروش' },
  OTHER: { label: 'سایر', hint: '' },
};

export const TOKEN_TYPE: Record<MerklTokenType, string> = { TOKEN: 'توکن', POINT: 'پوینت', PRETGE: 'پیش از TGE' };

export const RATE_KIND: Record<MerklRateKind, string> = {
  pool: 'بودجه‌ی ثابت، تقسیم بین همه',
  capped: 'بودجه‌ی مشترک با سقف APR',
  fixedValue: 'نرخ دلاری ثابت برای هر نفر',
  fixedAmount: 'تعداد ثابت توکن به ازای هر دلار',
  fixedPerUnit: 'تعداد ثابت توکن به ازای هر واحد سپرده',
  target: 'تکمیل تا بازده هدف (وابسته به بازده بومی)',
  airdrop: 'محاسبه بیرون از Merkl',
  other: 'سازوکار ویژه',
};

/**
 * Hook effect for a plain wallet:
 * - restrict: may earn nothing without extra conditions (whitelists, identity, leverage)
 * - boost: others can earn more, so a plain wallet's share is lower than the average
 * - info: shown, does not change the estimate
 */
export type HookEffect = 'restrict' | 'boost' | 'info';

const HOOKS: Record<number, { effect: HookEffect; label: string }> = {
  0: { effect: 'restrict', label: 'فقط سپرده‌ی پل‌شده از شبکه‌ی دیگر' },
  1: { effect: 'boost', label: 'ضریب برای دارندگان یک توکن' },
  2: { effect: 'restrict', label: 'حداقل موجودی و مدت نگه‌داری' },
  3: { effect: 'boost', label: 'ضریب برای دارندگان توکن یا NFT' },
  4: { effect: 'info', label: 'حذف آدرس‌های تحریمی' },
  5: { effect: 'restrict', label: 'قرعه‌کشی' },
  6: { effect: 'info', label: 'توزیع دوره‌ای' },
  7: { effect: 'boost', label: 'ضریب بر اساس امتیاز بیرونی' },
  8: { effect: 'info', label: 'vault' },
  9: { effect: 'info', label: 'برنامه‌ی ارجاع' },
  10: { effect: 'restrict', label: 'فقط تأییدشده با World ID' },
  11: { effect: 'boost', label: 'ضریب برای فهرستی از آدرس‌ها' },
  12: { effect: 'restrict', label: 'حداقل موجودی در یک تاریخ' },
  13: { effect: 'boost', label: 'ضریب بر اساس سواپ' },
  14: { effect: 'info', label: 'حذف وام‌گیرندگان بازارهای مشخص' },
  15: { effect: 'restrict', label: 'فقط یک ذی‌نفع' },
  16: { effect: 'restrict', label: 'فقط تأییدشده با Coinbase' },
  17: { effect: 'restrict', label: 'نیاز به اهرم (health factor پایین)' },
  18: { effect: 'restrict', label: 'فقط شرکت‌کنندگان کمپین دیگر' },
  19: { effect: 'info', label: 'تعدیل بر اساس وام با وثیقه' },
  20: { effect: 'restrict', label: 'فقط تأییدشده با Self' },
  21: { effect: 'restrict', label: 'سقف موجودی در یک تاریخ' },
  22: { effect: 'restrict', label: 'فقط آدرس‌های فهرست‌شده' },
  23: { effect: 'restrict', label: 'فقط کاربران پروتکل‌های مشخص' },
  24: { effect: 'restrict', label: 'فقط موقعیت‌های مشخص' },
  25: { effect: 'restrict', label: 'حد موجودی یک توکن' },
  26: { effect: 'restrict', label: 'فقط آدرس‌های فهرست‌شده' },
  27: { effect: 'info', label: 'فهرست سیاه' },
  28: { effect: 'info', label: 'حذف کاربران پروتکل‌های مشخص' },
  29: { effect: 'restrict', label: 'پرداخت به یک آدرس واحد' },
  30: { effect: 'info', label: 'برنامه‌ی ارجاع' },
  31: { effect: 'info', label: 'ارسال پاداش به مقصد دیگر' },
  32: { effect: 'boost', label: 'ضریب بر اساس فهرست امتیاز' },
};

export function hookInfo(h: MerklHook): { effect: HookEffect; label: string } {
  // Unknown hook types are treated as restrictions: never assume a plain wallet qualifies.
  const info = HOOKS[h.type] ?? { effect: 'restrict' as const, label: `شرط ویژه (${h.type})` };
  if (h.type === 17 && h.threshold !== undefined) return { ...info, label: `نیاز به اهرم (health factor ≤ ${h.threshold})` };
  return info;
}

/** Conditions that can make a plain wallet earn nothing. */
export function restrictions(c: MerklCampaign): string[] {
  const out = c.hooks.map(hookInfo).filter((h) => h.effect === 'restrict').map((h) => h.label);
  if (c.whitelistCount > 0) out.push('فقط آدرس‌های فهرست سفید');
  return [...new Set(out)];
}

export const hasBoost = (c: MerklCampaign) => c.hooks.some((h) => hookInfo(h).effect === 'boost');

/** Persian names for chains that are not in the app's network registry. */
const CHAIN_FA: Record<number, string> = {
  4: 'استلار',
  30: 'روت‌استاک',
  50: 'اکس‌دی‌سی',
  100: 'نوسیس',
  122: 'فیوز',
  130: 'یونی‌چین',
  137: 'پالیگان',
  151: 'ردبلی',
  169: 'مانتا',
  239: 'تک',
  250: 'فانتوم',
  252: 'فرکس‌تال',
  324: 'زی‌کی‌سینک',
  480: 'ورلد چین',
  592: 'استار',
  747: 'فلو',
  988: 'استیبل',
  1101: 'پالیگان zkEVM',
  1135: 'لیسک',
  1284: 'مون‌بیم',
  1329: 'سی',
  1440000: 'XRPL EVM',
  1672: 'فاروس',
  1868: 'سونیوم',
  1923: 'سوئل',
  2020: 'رونین',
  2818: 'مورف',
  4114: 'سیتریا',
  4217: 'تمپو',
  4326: 'مگا‌اث',
  5042: 'آرک',
  5064014: 'اتریال',
  5464: 'ساگا',
  6900: 'نیبیرو',
  8217: 'کایا',
  13371: 'ایمیوتبل',
  16661: 'زیروجی',
  21000000: 'کورن',
  25363: 'فلوئنت',
  31612: 'مزو',
  34443: 'مود',
  42220: 'سلو',
  42793: 'اترلینک',
  48900: 'زیرکیت',
  57073: 'اینک',
  59144: 'لینیا',
  60808: 'باب',
  81457: 'بلست',
  98866: 'پلوم',
  167000: 'تایکو',
  534352: 'اسکرول',
  685689: 'جنسین',
  2046399126: 'اسکیل',
};

/**
 * Network identity for a Merkl chain: the app's own name and local logo when the
 * chain is in the registry, otherwise a Persian name from CHAIN_FA and Merkl's logo.
 */
export function merklNetwork(chain: { id: number; name: string; icon: string | null }): { nameFa: string; name: string; logo: string | null } {
  const known = chain.id === 4 ? null : networkByChainId(chain.id);
  if (known && known.logo) return { nameFa: known.nameFa, name: known.name, logo: known.logo };
  return { nameFa: CHAIN_FA[chain.id] ?? known?.nameFa ?? chain.name, name: chain.name, logo: chain.icon };
}

/** Link to the opportunity on Merkl's own app. */
export const merklUrl = (o: { chain: { name: string }; type: string; identifier: string }) =>
  `https://app.merkl.xyz/opportunities/${encodeURIComponent(o.chain.name.toLowerCase().replace(/\s+/g, ''))}/${encodeURIComponent(o.type)}/${encodeURIComponent(o.identifier)}`;
