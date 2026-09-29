import type { FeeKind, PositionEventType, PositionKind, RateSource } from '../../types/position';
import type { ProtocolId } from '../../types/protocol';
import type { PositionStatus, Quality } from './valuation';

/** Persian labels and logos for the portfolio section. Token symbols stay official (Latin). */

import { NETWORKS, networkByName } from '../registry/networks';
import { protocolIdentity } from '../registry/identity';

/** Persian network names, from the shared registry. */
export const CHAIN_FA: Record<string, string> = Object.fromEntries(NETWORKS.map((n) => [n.name, n.nameFa]));

export const chainFa = (chain: string) => networkByName(chain).nameFa;

/** Local network logo (null → monogram). */
export const chainLogo = (chain: string) => networkByName(chain).logo;

export const protocolLogo = (id: ProtocolId) => protocolIdentity(id).logo;

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
