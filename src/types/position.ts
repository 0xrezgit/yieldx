import type { ProtocolId } from './protocol';

/**
 * Real positions the user has actually entered (or plans to enter), recorded as
 * an append-only list of trade events. Independent of ScenarioParams: nothing
 * here is a what-if assumption — every number is what the user typed, and every
 * historical USD rate carries where it came from.
 *
 * There is no wallet connection: balances and events are the user's own records
 * and are never verified on-chain.
 */
export type PositionKind = 'pt' | 'yt' | 'loop';

/**
 * Where a USD rate came from. 'market' = live price read at (about) the event time,
 * 'historical' = price-history lookup for the event time (DefiLlama, ±4h).
 */
export type RateSource = 'market' | 'historical' | 'manual' | 'unknown';

/** An amount of one token plus its USD rate at the time of the event. */
export interface TokenAmount {
  amount: number;
  /** Official token symbol, as typed or suggested (e.g. "USDC", "ETH"). */
  token: string;
  /** USD price of one token at the event time; null when unknown. */
  usdRate: number | null;
  rateSource: RateSource;
}

export type FeeKind = 'network' | 'trade' | 'other';

export interface Fee extends TokenAmount {
  kind: FeeKind;
  /**
   * True when the fee is already reflected in the event's amounts (e.g. a swap fee
   * that reduced the tokens received). Such fees are shown but never subtracted
   * again, so they cannot be counted twice.
   */
  included: boolean;
}

export type PositionEventType =
  /** Bought (more) PT/YT. `units` > 0, `cash` = what was paid. */
  | 'buy'
  /** Sold part or all of the tokens. `units` > 0 = tokens sold, `cash` = what was received. */
  | 'sell'
  /** Redeemed PT at/after maturity. Same shape as sell. */
  | 'redeem'
  /** Claimed YT yield (interest). `cash` = what was received. */
  | 'claim_yield'
  /** Claimed incentive rewards / airdrop tokens. `cash` = what was received. */
  | 'claim_reward'
  /** Borrowed against the PT (loops). `cash` = borrowed amount in the debt asset. */
  | 'borrow'
  /** Repaid debt (loops). `cash` = amount repaid in the debt asset. */
  | 'repay';

export interface PositionEvent {
  id: string;
  type: PositionEventType;
  /** ISO date-time of the transaction. */
  at: string;
  /** PT/YT token units moved (always ≥ 0; the type says the direction). */
  units: number;
  cash: TokenAmount;
  /** USD price of one accounting-asset unit at the event time (for asset-denominated returns). */
  assetUsd: number | null;
  assetUsdSource: RateSource;
  fees: Fee[];
  note: string;
}

/** How the money market values PT collateral when checking health. */
export type OracleMode = 'market' | 'manual' | 'unknown';

export interface LoopInfo {
  lendingPlatform: string;
  lendingMarket: string;
  /** Debt token symbol. */
  debtAsset: string;
  /** True when the debt asset is the market's accounting asset (so its USD price follows the market). */
  debtIsAccountingAsset: boolean;
  /** Current USD price of the debt asset when it is not the accounting asset. */
  debtAssetUsd: number | null;
  /** Borrow APY, % — as shown by the lending platform. */
  borrowAPY: number;
  /** Liquidation threshold (LLTV), %. */
  lltv: number;
  oracle: OracleMode;
  /** Oracle PT price in accounting-asset units when oracle = 'manual'. */
  oraclePtPrice: number | null;
  /** Debt balance read from the lending platform (debt-asset units), overriding the interest estimate. */
  debtOverride: { amount: number; at: string } | null;
}

/** Values entered by hand when live data is missing or the user reads them elsewhere. */
export interface ManualMarks {
  /** Token price in accounting-asset units. */
  tokenPrice: { value: number; at: string } | null;
  assetUsd: { value: number; at: string } | null;
  /** YT: unclaimed yield shown by the protocol, in accounting-asset units. */
  unclaimedYield: { value: number; at: string } | null;
}

export interface PositionTargets {
  /** Alert when total P&L reaches this % (null = off). */
  takeProfitPct: number | null;
  /** Alert when total P&L falls to −this % (null = off). */
  stopLossPct: number | null;
  /** Alert when the loop health factor falls below this. */
  minHealth: number | null;
}

/** Valuation recorded by the app from real data — the only source of the performance chart. */
export interface ValueSnapshot {
  at: string;
  valueUsd: number;
  pnlUsd: number;
}

export interface Position {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: PositionKind;
  protocol: ProtocolId;
  chain: string;
  marketId: string;
  marketName: string;
  platform: string;
  icon: string;
  /** ISO date of maturity. */
  maturity: string;
  /** Accounting asset symbol PT redeems into (e.g. "USDe", "ETH"). */
  assetSymbol: string;
  events: PositionEvent[];
  loop: LoopInfo | null;
  manual: ManualMarks;
  targets: PositionTargets;
  /** Points program assumptions (YT) — only for the separate points scenario, never P&L. */
  points: { perDay: number; multiplier: number; basis: 'unit' | 'usd'; valuePerPoint: number };
  snapshots: ValueSnapshot[];
  note: string;
}

export interface PortfolioSnapshot {
  at: string;
  netValueUsd: number;
  investedUsd: number;
  pnlUsd: number;
}

export interface PortfolioFile {
  version: 1;
  exportedAt: string;
  positions: Position[];
  history: PortfolioSnapshot[];
}

export const emptyManual = (): ManualMarks => ({ tokenPrice: null, assetUsd: null, unclaimedYield: null });
export const emptyTargets = (): PositionTargets => ({ takeProfitPct: null, stopLossPct: null, minHealth: null });
