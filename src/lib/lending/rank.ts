import type { CostItem, Estimate, Opportunity } from '../../types/opportunity';
import type { GasQuote, MerklOpportunity } from '../merkl/types';
import type { VetContext } from '../merkl/vetting';
import { estimate } from '../opportunity/estimate';
import { dedupeOpportunities, rankEstimates, type Ranking } from '../opportunity/rank';
import { PT_UNKNOWN_COSTS } from '../opportunity/from-market';
import { addMerklRewards, COVERED_BY_ADAPTER, linkMerkl, merklAsOpportunity, merklEstimateShared, withoutMerklDuplicates } from '../opportunity/merkl-link';
import { formatNumber } from '../utils/formatting';
import { buildLoops } from '../opportunity/leverage';

/**
 * The unified ranking: every family in one list, ranked by the estimated net
 * dollars for the same amount and the same period.
 *
 * Sources: protocol adapters (PT markets, Morpho, Aave V4, Midnight) for the
 * base rate; Merkl for incentives — linked to the protocol opportunity when the
 * addresses match (counted once), or listed on its own when YieldX has no adapter
 * for that protocol. Merkl markets of protocols YieldX covers are not listed a
 * second time (they stay on the Merkl page).
 */

/** fixed: fixed-rate lending and PT; rewards: anything whose estimate counts a priced reward. */
export type FamilyView = 'all' | 'fixed' | 'lend' | 'vault' | 'rewards' | 'leverage';

export interface LendingSettings {
  capital: number;
  /** Any whole number of days, 1–365. */
  days: number;
  /** USD per transaction on Ethereum mainnet (the user's assumption). */
  txEthereum: number;
  /** USD per transaction on every other EVM network (the user's assumption). */
  txOther: number;
  view: FamilyView;
  /**
   * The user may need the money back before a maturity that falls after the period.
   * Then such fixed-rate markets leave the ranking (their early exit has no valid
   * model); otherwise they are compared held to maturity, labelled «different period».
   */
  needsEarlyExit: boolean;
  /** Loops enter the ranking only when the user allows leverage. */
  allowLeverage: boolean;
  /** Lowest health accepted (HF on Aave, LLTV ÷ LTV on Morpho). */
  minHealth: number;
  /** A chosen leverage; 0 → the highest that keeps `minHealth`. */
  leverageTarget: number;
}

export const defaultLendingSettings: LendingSettings = { capital: 1000, days: 30, txEthereum: 1, txOther: 0.05, view: 'all', needsEarlyExit: true, allowLeverage: false, minHealth: 1.3, leverageTarget: 0 };
export const MIN_HEALTH_FLOOR = 1.05;

export const MIN_DAYS = 1;
export const MAX_DAYS = 365;
export const clampDays = (d: number) => (Number.isFinite(d) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(d))) : defaultLendingSettings.days);

/** Transactions per round trip: approve + deposit (or swap) in, withdraw (or swap / redeem) out. */
export const TX_ENTRY = 2;
export const TX_EXIT = 1;

const perTx = (s: LendingSettings) => (chainId: number) => (chainId === 1 ? s.txEthereum : s.txOther);

function gas(o: Opportunity, s: LendingSettings): { entry: CostItem[]; exit: CostItem[] } {
  const tx = o.chain === 'eip155:1' ? s.txEthereum : s.txOther;
  const where = o.chain === 'eip155:1' ? 'اتریوم' : 'شبکه';
  return {
    entry: [{ key: 'gas-entry', label: `گس ورود (${formatNumber(TX_ENTRY, 0)} تراکنش در ${where})`, usd: tx * TX_ENTRY, basis: 'assumed' }],
    exit: [{ key: 'gas-exit', label: `گس خروج (${formatNumber(TX_EXIT, 0)} تراکنش در ${where})`, usd: tx * TX_EXIT, basis: 'assumed' }],
  };
}

const inView = (v: FamilyView, o: Opportunity, e: Estimate) =>
  v === 'all' ||
  (v === 'fixed' && (o.family === 'fixed-lend' || o.family === 'pt')) ||
  (v === 'lend' && o.family === 'lend') ||
  (v === 'vault' && o.family === 'vault') ||
  (v === 'rewards' && e.rewards > 0) ||
  (v === 'leverage' && o.family === 'leverage');

export interface MerklInput {
  /** Live Merkl opportunities (campaigns already cut to those running now). */
  list: MerklOpportunity[];
  ctx: VetContext;
  gas: GasQuote[];
  stale: boolean;
  fetchedAt: string;
}

export interface LendingResult {
  ranking: Ranking;
  byKey: Map<string, Opportunity>;
  total: number;
  /** How many protocol opportunities got Merkl rewards linked. */
  linked: number;
}

/** The whole list re-estimated for this amount and period: capacity, dilution, maturities and fixed gas all depend on both. */
export function rankLending(list: Opportunity[], s: LendingSettings, now = Date.now(), merkl: MerklInput | null = null): LendingResult {
  const days = clampDays(s.days);
  // Borrow-only reserves feed loops and the borrow comparison, not the earn list.
  const base = dedupeOpportunities(list);
  const opps = [...base.filter((o) => o.family !== 'borrow'), ...buildLoops(base)];
  const leverage = { allow: s.allowLeverage, minHealth: Math.max(MIN_HEALTH_FLOOR, s.minHealth), target: s.leverageTarget >= 1 ? s.leverageTarget : null };
  const links = merkl ? linkMerkl(opps, merkl.list) : new Map<string, MerklOpportunity[]>();

  const rows: { o: Opportunity; e: Estimate }[] = opps.map((raw) => {
    const linked = links.get(raw.key);
    const o = linked ? withoutMerklDuplicates(raw, linked) : raw;
    const g = gas(o, s);
    let e = estimate(o, {
      capital: s.capital,
      days,
      needsEarlyExit: s.needsEarlyExit,
      entryCosts: g.entry,
      exitCosts: g.exit,
      unknownCosts: o.family === 'pt' ? [...PT_UNKNOWN_COSTS] : ['گس دریافت پاداش (claim)'],
      now,
      leverage,
    });
    if (linked && merkl) e = addMerklRewards(e, linked, merkl.ctx, perTx(s));
    return { o, e };
  });

  if (merkl) {
    const linkedIds = new Set([...links.values()].flat().map((m) => m.id));
    for (const m of merkl.list) {
      if (linkedIds.has(m.id) || COVERED_BY_ADAPTER[m.protocol?.id?.toLowerCase() ?? '']) continue;
      const o = merklAsOpportunity(m, merkl.fetchedAt);
      rows.push({ o, e: merklEstimateShared(m, o, { capital: s.capital, horizon: days, txEthereum: s.txEthereum, txOther: s.txOther }, merkl.ctx, merkl.gas, merkl.stale) });
    }
  }

  const shown = rows.filter((r) => inView(s.view, r.o, r.e));
  return { ranking: rankEstimates(shown.map((r) => r.e)), byKey: new Map(shown.map((r) => [r.o.key, r.o])), total: shown.length, linked: links.size };
}
