import config from '../../config/lp-pools.json';
import { concentration, type PoolShape } from './scenarios';

/**
 * AERO rewards of an Aero pool (Aerodrome + Velodrome, merged 2026-10-22).
 *
 * A staked position earns AERO instead of swap fees: its fees go to sAERO holders.
 * In a concentrated pool the gauge pays the staked liquidity inside the current
 * price, per unit of liquidity — the same way fees are paid. So the rate is taken
 * per unit of liquidity too: the week's rewards over the staked in-range liquidity
 * (`stakedLiquidity()`, read on-chain), expressed for one dollar placed over the
 * full range. A range position earns that times its concentration, and shares the
 * rewards with what is already staked: a large deposit lowers its own rate.
 *
 * In a plain pool every staked dollar earns the same, so «rewards ÷ staked TVL» is
 * the rate.
 *
 * The sites' big numbers (thousands of percent) are this rate for the narrowest
 * range, as long as the price never leaves it.
 *
 * Gauge Caps: Aero holds each pool's AERO to a multiple of its revenue, about 1.2×
 * across the exchange. A pool paying far more than its swap fees is likely to be
 * paid less soon. Revenue here is the pool's swap fees only (Liquidity Payments are
 * not public), so the cap read from it is a cautious one.
 */

const AERO = config.aero;

export interface PoolReward {
  /** Reward token symbol(s), e.g. "AERO". */
  token: string;
  /** Rewards the gauge pays per week, USD (vfat, at today's token price). */
  weeklyUsd: number;
  /** Yearly rate of one staked full-range dollar, % (see the module note). */
  aprPct: number;
  /** Liquidity staked and earning now, in full-range dollars. */
  stakedFullRangeUsd: number;
  /** The pool's swap fees per week, USD, from its last days; null when not known yet. */
  revenueWeeklyUsd: number | null;
  /** Days behind `revenueWeeklyUsd`. */
  revenueDays: number;
  /** vfat page that deposits and stakes in one go. */
  url: string;
}

/** Aero's own page for a pool. */
export const aeroPoolUrl = (chainId: number, address: string) => `${AERO.poolUrl}${chainId}-${address}`;

export const isAeroVenue = (protocolId: string | undefined) => protocolId === AERO.venue;
/** Aerodrome and Velodrome: their gauges stopped paying at the Aero launch. */
export const isLegacyVenue = (protocolId: string | undefined) => !!protocolId && AERO.legacyVenues.includes(protocolId);

/** Rate per full-range dollar from rewards per week and the staked liquidity, in full-range dollars. */
export const rewardAprPct = (weeklyUsd: number, stakedFullRangeUsd: number) => (weeklyUsd * (365 / 7)) / stakedFullRangeUsd * 100;

/**
 * The full-range dollar value of liquidity `L` (raw units) at the pool's current
 * price: 2·L·√P token1 base units. `sqrtPriceX96` is the pool's own (Q64.96).
 */
export function fullRangeUsd(L: number, sqrtPriceX96: number, decimals1: number, price1Usd: number): number {
  return (2 * L * (sqrtPriceX96 / 2 ** 96) * price1Usd) / 10 ** decimals1;
}

/**
 * Swap fees per week from daily history (all of them: staked liquidity's fees are
 * the pool's revenue too). Leading days without trades (the pool not live yet) are
 * skipped; the last seven days that remain are averaged.
 */
export function weeklyRevenue(points: { volumeUsd?: number | null; feePercent?: number | null }[]): { usd: number; days: number } | null {
  const days: number[] = [];
  for (const p of points) {
    const v = typeof p.volumeUsd === 'number' && Number.isFinite(p.volumeUsd) ? p.volumeUsd : null;
    const f = typeof p.feePercent === 'number' && Number.isFinite(p.feePercent) ? p.feePercent : null;
    if (v === null || f === null || v < 0 || f < 0) continue;
    if (!days.length && v === 0) continue;
    days.push(v * (f / 100));
  }
  const last = days.slice(-7);
  if (!last.length) return null;
  return { usd: (last.reduce((a, b) => a + b, 0) / last.length) * 7, days: last.length };
}

/** Rewards per week ÷ revenue per week; null when revenue is unknown or zero. */
export const rewardToRevenue = (r: Pick<PoolReward, 'weeklyUsd' | 'revenueWeeklyUsd'>) => (r.revenueWeeklyUsd && r.revenueWeeklyUsd > 0 ? r.weeklyUsd / r.revenueWeeklyUsd : null);

/**
 * Share of today's rewards left if the pool were paid at the cap target (≈1.2× its
 * revenue): 1 when within it or when revenue is unknown.
 */
export function capFactor(r: Pick<PoolReward, 'weeklyUsd' | 'revenueWeeklyUsd'>): number {
  const k = rewardToRevenue(r);
  return k === null ? 1 : Math.min(1, AERO.capTarget / k);
}

export const CAP_TARGET = AERO.capTarget;

/**
 * The yearly AERO rate this position earns while in range, %: the full-range rate
 * times its concentration, shared with what is already staked. `capped` applies
 * the cap target.
 */
export function positionRewardApr(r: Pick<PoolReward, 'aprPct' | 'stakedFullRangeUsd' | 'weeklyUsd' | 'revenueWeeklyUsd'>, shape: PoolShape, capital: number, capped: boolean): number {
  const k = concentration(shape);
  if (!Number.isFinite(k)) return NaN;
  const own = Math.max(0, capital) * k;
  const share = r.stakedFullRangeUsd / (r.stakedFullRangeUsd + own);
  return r.aprPct * k * share * (capped ? capFactor(r) : 1);
}

/** Chain-wide notices from the Aero launch: no more incentives, or a withdrawal deadline. */
export function chainNotice(chainId: number): { kind: 'sunset' } | { kind: 'withdraw'; by: string } | null {
  const by = (AERO.withdrawBy as Record<string, string>)[String(chainId)];
  if (by) return { kind: 'withdraw', by };
  return String(chainId) in AERO.sunsetChains ? { kind: 'sunset' } : null;
}
