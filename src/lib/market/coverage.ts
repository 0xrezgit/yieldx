/**
 * Coverage of «protocol + product + version + network»: what YieldX actually reads
 * and ranks. A protocol's name here is never a claim that all of its products are
 * covered — each product has its own row, status and reason.
 *
 * `source` is the id of the live source (feed status) when one exists.
 */

export type CoverageStatus = 'supported' | 'partial' | 'insufficient' | 'unavailable';

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  supported: 'پشتیبانی‌شده',
  partial: 'پوشش جزئی',
  insufficient: 'داده‌ی ناکافی',
  unavailable: 'فعلاً در دسترس نیست',
};

export interface CoverageRow {
  protocol: string;
  product: string;
  version: string | null;
  networks: string;
  /** Live source id (see SourceStatus.id), when the product is fetched. */
  source: string | null;
  /** Where the data comes from. */
  endpoint: string | null;
  status: CoverageStatus;
  /** In the dollar ranking? */
  ranked: boolean;
  reason: string;
}

/** Date the statuses below were last reviewed against the sources. */
export const COVERAGE_CHECKED_AT = '2026-09-30';

export const COVERAGE: CoverageRow[] = [
  { protocol: 'Pendle', product: 'PT', version: 'V2', networks: 'همه‌ی شبکه‌های API پندل', source: 'pendle', endpoint: 'api-v2.pendle.finance/core/v1/{chain}/markets', status: 'partial', ranked: true, reason: 'تا سررسید داخل افق؛ بدون quote، فقط مبلغ کوچک نسبت به استخر؛ کارمزد سواپ لحاظ‌نشده.' },
  { protocol: 'Pendle', product: 'YT', version: 'V2', networks: 'همه', source: 'pendle', endpoint: 'همان', status: 'partial', ranked: true, reason: 'تا سررسید داخل افق با بازده پایه‌ی امروز؛ پوینت بدون ارزش دلاری؛ بدون quote.' },
  { protocol: 'Pendle', product: 'LP', version: 'V2', networks: 'همه', source: null, endpoint: null, status: 'unavailable', ranked: false, reason: 'مدل LP پندل ساخته نشده.' },
  { protocol: 'Spectra', product: 'PT', version: null, networks: 'شبکه‌های پیکربندی‌شده', source: 'spectra', endpoint: 'api.spectra.finance/v1/{network}/pools', status: 'partial', ranked: true, reason: 'مثل PT پندل.' },
  { protocol: 'Spectra', product: 'YT', version: null, networks: 'همان', source: 'spectra', endpoint: 'همان', status: 'partial', ranked: true, reason: 'مثل YT پندل؛ بازده پایه به‌صورت APR ساده.' },
  { protocol: 'Exponent', product: 'PT', version: null, networks: 'Solana', source: 'exponent', endpoint: 'api.exponent.finance/markets', status: 'partial', ranked: true, reason: 'اندازه‌ی بازار جای نقدینگی استخر؛ بدون quote.' },
  { protocol: 'Exponent', product: 'YT', version: null, networks: 'Solana', source: 'exponent', endpoint: 'همان', status: 'partial', ranked: true, reason: 'مثل YT پندل.' },
  { protocol: 'Exponent', product: 'CLMM', version: null, networks: 'Solana', source: 'exponent', endpoint: 'همان', status: 'partial', ranked: false, reason: 'فقط ابزار تخصصی.' },
  { protocol: 'Morpho', product: 'Variable (بازارهای Blue)', version: 'Blue', networks: 'Ethereum، Base، Arbitrum، Optimism، Polygon، Unichain، Katana، HyperEVM، Robinhood Chain', source: 'morpho', endpoint: 'api.morpho.org/graphql', status: 'supported', ranked: true, reason: 'نرخ لحظه‌ای و منحنی IRM؛ صفحه‌بندی کامل.' },
  { protocol: 'Morpho', product: 'Vaults', version: 'V1', networks: 'همان', source: 'morpho', endpoint: 'همان', status: 'supported', ranked: true, reason: 'نرخ خالص پس از کارمزد، بدون پاداش.' },
  { protocol: 'Morpho', product: 'Vaults', version: 'V2', networks: 'همان', source: 'morpho', endpoint: 'همان', status: 'partial', ranked: true, reason: 'فقط بازده تحقق‌یافته‌ی ۷ روزه منتشر می‌شود (نرخ تاریخی).' },
  { protocol: 'Morpho', product: 'Fixed (Midnight)', version: 'Midnight', networks: 'Ethereum، Base', source: 'midnight', endpoint: 'api.morpho.org/v0/midnight', status: 'partial', ranked: true, reason: 'پر کردن دفتر برای مبلغ شما؛ کارمزدها با بیشینه‌ی مجاز پروتکل.' },
  { protocol: 'Morpho', product: 'Loop (وام Blue)', version: 'Blue', networks: 'همان', source: 'morpho', endpoint: 'همان', status: 'partial', ranked: true, reason: 'سیاست اهرم نسخه‌دار؛ اسلیپیج باز و بسته کردن لحاظ نشده.' },
  { protocol: 'Morpho + Pendle/Spectra', product: 'Loop PT', version: 'Blue', networks: 'EVM', source: 'morpho', endpoint: 'تطبیق نشانی PT با وثیقه‌ی بازار', status: 'partial', ranked: true, reason: 'فقط با تطبیق دقیق نشانی PT؛ سررسید داخل افق.' },
  { protocol: 'Aave', product: 'Supply', version: 'V4', networks: 'شبکه‌های AaveKit', source: 'aave', endpoint: 'api.aave.com/graphql', status: 'supported', ranked: true, reason: 'نرخ Hub و منحنی دو‌شیبه.' },
  { protocol: 'Aave', product: 'Loop', version: 'V4', networks: 'همان', source: 'aave', endpoint: 'همان', status: 'partial', ranked: true, reason: 'صرف ریسک کاربر (User Risk Premium) معلوم نیست.' },
  { protocol: 'Aave', product: 'Supply', version: 'V3', networks: '—', source: null, endpoint: null, status: 'unavailable', ranked: false, reason: 'آداپتر فقط نسخه‌ی چهارم را می‌خواند.' },
  { protocol: 'Kamino', product: 'Lend', version: 'klend', networks: 'Solana', source: 'kamino', endpoint: 'api.kamino.finance', status: 'partial', ranked: true, reason: 'API عمومی؛ معنای فیلدها از کلاینت شخص ثالث؛ پاداش farmها تاریخ پایان ندارد.' },
  { protocol: 'Kamino', product: 'Borrow و Multiply', version: 'klend', networks: 'Solana', source: null, endpoint: null, status: 'insufficient', ranked: false, reason: 'شرایط وثیقه هر جفت (elevation group) از API عمومی کامل نمی‌آید.' },
  { protocol: 'Kamino', product: 'Liquidity', version: null, networks: 'Solana', source: null, endpoint: null, status: 'unavailable', ranked: false, reason: 'خزانه‌ی بازتنظیم‌شونده؛ مدل مسیر قیمت ندارد.' },
  { protocol: 'Loopscale', product: 'Lend و Earn (خزانه‌ها)', version: null, networks: 'Solana', source: 'loopscale', endpoint: 'tars.loopscale.com/v1/markets/lending_vaults/info', status: 'partial', ranked: true, reason: 'API شرکا؛ معنای فیلدها از کلاینت شخص ثالث.' },
  { protocol: 'Loopscale', product: 'Loops و Borrow', version: null, networks: 'Solana', source: null, endpoint: null, status: 'insufficient', ranked: false, reason: 'نرخ وام به quote هر مبلغ و مدت بستگی دارد.' },
  { protocol: 'Revert', product: 'Lend (خزانه‌ی USDC)', version: 'V3Vault', networks: 'Ethereum، Arbitrum، Base', source: 'revert', endpoint: 'api.revert.finance/v1/lend/daily-rates + قرارداد خزانه', status: 'supported', ranked: true, reason: 'نرخ روزانه‌ی Revert؛ ظرفیت، نقدینگی و منحنی نرخ از خود قرارداد.' },
  { protocol: 'Revert', product: 'Lend (خزانه‌ی Aerodrome)', version: 'V3Vault', networks: 'Base', source: null, endpoint: null, status: 'insufficient', ranked: false, reason: 'سری نرخ جداگانه منتشر نمی‌شود.' },
  { protocol: 'vfat', product: 'LP (استخرهای استیبل، ETH، BTC و سهام توکنیزه)', version: 'v4', networks: 'Robinhood Chain و شبکه‌های vfat', source: null, endpoint: 'api.vfat.io/v4 (yield-opportunities, pool-history)', status: 'partial', ranked: false, reason: 'در ابزار LP، جدا از رتبه‌بندی؛ سود به مسیر قیمت بستگی دارد.' },
  { protocol: 'Revert', product: 'پوزیشن‌های واقعی LP', version: null, networks: 'Ethereum، Arbitrum، Base، Robinhood Chain و…', source: null, endpoint: 'api.revert.finance/v1/positions', status: 'partial', ranked: false, reason: 'در ابزار LP: نتیجه‌ی واقعی LPهای هر استخر، کنار برآورد.' },
  { protocol: 'Raydium', product: 'LP (CPMM و CLMM)', version: 'V3 API', networks: 'Solana', source: null, endpoint: 'api-v3.raydium.io (SDK رسمی)', status: 'unavailable', ranked: false, reason: 'سود LP به مسیر قیمت بستگی دارد؛ آداپتر وصل نشده.' },
  { protocol: 'Orca', product: 'Whirlpools (CLMM)', version: null, networks: 'Solana', source: null, endpoint: null, status: 'unavailable', ranked: false, reason: 'مثل Raydium.' },
  { protocol: 'Jupiter', product: 'Lend / Earn', version: null, networks: 'Solana', source: null, endpoint: null, status: 'unavailable', ranked: false, reason: 'بسته‌ی رسمی endpoint عمومی نرخ ندارد؛ تأیید نشده.' },
  { protocol: 'Merkl', product: 'کشف فرصت و پاداش', version: 'v4', networks: 'همه‌ی شبکه‌های Merkl', source: 'merkl', endpoint: 'api.merkl.xyz/v4', status: 'supported', ranked: true, reason: 'پاداش به استراتژی وصل می‌شود؛ LP، اهرم و پوینت رتبه نمی‌گیرند.' },
];
