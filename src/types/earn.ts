import type { Fee, TokenAmount } from './position';
import type { OpportunityFamily } from './opportunity';

/**
 * Positions of the families the PT/YT portfolio does not cover: lending supply,
 * vault shares, fixed-rate loans (Midnight units), loops, LP and plain borrowing.
 * Same rules as the PT/YT ledger — the user's own records, never read from a
 * wallet; every USD rate says where it came from; a fee marked `included` is
 * listed but never subtracted again.
 */
export type EarnFamily = Exclude<OpportunityFamily, 'pt' | 'yt' | 'stake'>;

export type EarnEventType =
  /** Money put in (deposit asset). */
  | 'deposit'
  /** Money taken out, principal and interest together (deposit asset). */
  | 'withdraw'
  /** Incentives claimed (any token). */
  | 'claim_reward'
  /** Borrowed (debt asset) — loops and borrowing. */
  | 'borrow'
  /** Repaid (debt asset). */
  | 'repay';

export interface EarnEvent {
  id: string;
  type: EarnEventType;
  at: string;
  cash: TokenAmount;
  fees: Fee[];
  note: string;
}

/** A value read by the user from the protocol (balance with interest, debt with interest). */
export interface Mark {
  /** In deposit-asset units (balance) or debt-asset units (debt). */
  amount: number;
  at: string;
}

export interface EarnPosition {
  id: string;
  createdAt: string;
  updatedAt: string;
  family: EarnFamily;
  protocol: { id: string; name: string; version: string | null };
  /** Network key, e.g. "eip155:1". */
  chain: string;
  market: { id: string; name: string; address: string | null };
  /** Stable key of the live opportunity, to read today's rate; null when entered by hand. */
  opportunityKey: string | null;
  /** Deposit asset (for loops: the collateral). */
  asset: { symbol: string; address: string | null };
  /** Debt asset, for loops and borrowing. */
  debtAsset: { symbol: string; address: string | null } | null;
  /** Fixed-rate loans: maturity (ISO); null when none. */
  maturity: string | null;
  /** The user's own rate assumptions (%/year, APY) when no live rate is linked. */
  manualRate: number | null;
  manualBorrowRate: number | null;
  /** Liquidation limit for loops/borrowing (LLTV or collateral factor), 0…1. */
  maxLtv: number | null;
  /** Latest balance and debt the user read from the protocol. */
  balance: Mark | null;
  debt: Mark | null;
  /** Today's USD price of the deposit / debt asset when entered by hand. */
  assetUsd: number | null;
  debtUsd: number | null;
  /** Estimated cost to exit now (gas, withdrawal fee, unwind slippage), USD; null → unknown. */
  exitCostUsd: number | null;
  events: EarnEvent[];
  note: string;
}
