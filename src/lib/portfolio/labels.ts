import type { FeeKind, PositionEventType, PositionKind, RateSource } from '../../types/position';
import type { ProtocolId } from '../../types/protocol';
import type { PositionStatus, Quality } from './valuation';

/** Persian labels and logos for the portfolio section. Token symbols stay official (Latin). */

export const CHAIN_FA: Record<string, string> = {
  Ethereum: 'اتریوم',
  Arbitrum: 'آربیتروم',
  Base: 'بیس',
  Optimism: 'آپتیمیزم',
  'BNB Chain': 'زنجیره‌ی BNB',
  Sonic: 'سونیک',
  Mantle: 'منتل',
  Berachain: 'براچین',
  HyperEVM: 'هایپر EVM',
  Plasma: 'پلاسما',
  Monad: 'موناد',
  Solana: 'سولانا',
  Avalanche: 'اولانچ',
  Katana: 'کاتانا',
  Flare: 'فلر',
  Hemi: 'همی',
  'X Layer': 'ایکس لیر',
  'Robinhood Chain': 'زنجیره‌ی رابین‌هود',
};

export const chainFa = (chain: string) => CHAIN_FA[chain] ?? chain;

/** DefiLlama chain icon slugs (TokenLogo falls back to a monogram if one fails). */
const CHAIN_SLUG: Record<string, string> = {
  Ethereum: 'ethereum',
  Arbitrum: 'arbitrum',
  Base: 'base',
  Optimism: 'optimism',
  'BNB Chain': 'binance',
  Sonic: 'sonic',
  Mantle: 'mantle',
  Berachain: 'berachain',
  HyperEVM: 'hyperliquid',
  Plasma: 'plasma',
  Monad: 'monad',
  Solana: 'solana',
  Avalanche: 'avalanche',
  Katana: 'katana',
  Flare: 'flare',
  Hemi: 'hemi',
  'X Layer': 'xlayer',
};

export const chainLogo = (chain: string) =>
  CHAIN_SLUG[chain] ? `https://icons.llamao.fi/icons/chains/rsz_${CHAIN_SLUG[chain]}.jpg` : null;

const PROTOCOL_SLUG: Record<ProtocolId, string> = { pendle: 'pendle', exponent: 'exponent', spectra: 'spectra' };
export const protocolLogo = (id: ProtocolId) => `https://icons.llamao.fi/icons/protocols/${PROTOCOL_SLUG[id]}?w=64&h=64`;

export const KIND_LABEL: Record<PositionKind, string> = { pt: 'PT', yt: 'YT', loop: 'PT Loop' };
export const KIND_FA: Record<PositionKind, string> = {
  pt: 'PT — بازده ثابت تا سررسید',
  yt: 'YT — سود متغیر و پوینت',
  loop: 'PT Loop — PT اهرمی با وام',
};

export const EVENT_FA: Record<PositionEventType, string> = {
  buy: 'خرید',
  sell: 'فروش',
  redeem: 'بازخرید در سررسید',
  claim_yield: 'دریافت سود',
  claim_reward: 'دریافت پاداش',
  borrow: 'وام گرفتن',
  repay: 'بازپرداخت بدهی',
};

export const FEE_FA: Record<FeeKind, string> = { network: 'کارمزد شبکه', trade: 'کارمزد معامله', other: 'هزینه‌ی جانبی' };

export const RATE_FA: Record<RateSource, string> = { market: 'نرخ لحظه‌ای بازار', historical: 'نرخ تاریخی بازار', manual: 'ورود دستی', unknown: 'نامعلوم' };

export const QUALITY_FA: Record<Quality, string> = {
  market: 'به‌روز',
  stale: 'قدیمی',
  manual: 'دستی',
  rule: 'طبق قاعده‌ی بازار',
  historical: 'بر اساس سابقه',
  estimate: 'تخمینی',
  missing: 'ناموجود',
};

export const QUALITY_TONE: Record<Quality, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
  market: 'success',
  stale: 'warning',
  manual: 'info',
  rule: 'success',
  historical: 'info',
  estimate: 'warning',
  missing: 'danger',
};

export const STATUS_FA: Record<PositionStatus, string> = { open: 'باز', matured: 'سررسیدشده', closed: 'بسته' };
