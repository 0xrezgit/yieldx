/**
 * The protocol-independent model of an opportunity: anything that turns the
 * user's capital into income over a period — a PT held to maturity, a lending
 * supply, a vault share, a fixed-rate loan, a leveraged loop, an LP position.
 *
 * Unlike MarketData (PT/YT only), nothing here assumes a PT price, a YT price or
 * a maturity. Every number that a source did not give is null — never 0.
 *
 * Units: rates are % per year (8 means 8%); money is plain US dollars.
 */
import type { TokenRef } from './market';

export type OpportunityFamily = 'lend' | 'vault' | 'fixed-lend' | 'pt' | 'yt' | 'leverage' | 'lp' | 'borrow' | 'stake';

/**
 * How the published rate compounds:
 * - apy: already compounded — growth = (1 + r)^(d/365) − 1
 * - apr: simple unless `compoundsPerYear` is known — growth = r × d/365
 * - unknown: the source doesn't say; the lower (simple) reading is used and labelled
 * - quote: income comes from an executable price for the user's amount (order
 *   book, AMM), not from a yearly rate — computed by that family's own model.
 */
export type RateKind = 'apr' | 'apy' | 'unknown' | 'quote';

export interface RateQuote {
  /** % per year; null when the source gave none. */
  value: number | null;
  kind: RateKind;
  /** For `apr`: compounding periods per year when the protocol states it; null → simple interest. */
  compoundsPerYear?: number | null;
  /** Are the protocol / curator fees already out of this rate? 'unknown' lowers data quality. */
  feesIncluded: boolean | 'unknown';
  /** Does this rate already contain incentive rewards? Then reward streams are not added on top. */
  rewardsIncluded: boolean | 'unknown';
  /** Fees still to deduct when `feesIncluded` is false. */
  fees?: { performancePct?: number | null; managementPct?: number | null };
  /** When the source measured this rate (ISO); null when not reported. */
  at: string | null;
}

/** An incentive paid on top of the base rate. The key identifies the campaign across sources. */
export interface RewardStream {
  /** `${distributionChainId}:${campaignId}` — the same campaign from two sources has one key. */
  key: string;
  source: 'merkl' | 'protocol';
  kind: 'token' | 'points';
  /** Reward token (network + address), when a token. */
  token: (TokenRef & { chain: string }) | null;
  /** Dollar APR on the deposited capital at today's reward price, simple (not compounded). Null → not priced. */
  aprUsd: number | null;
  /**
   * Campaign budget per day in USD and the TVL sharing it. When both are known the
   * user's own capital dilutes the reward (share = A ÷ (TVL + A)) instead of
   * assuming today's APR holds for any amount.
   */
  dailyUsd?: number | null;
  eligibleTvlUsd?: number | null;
  /** Campaign end (ISO). Null → unknown; not counted rather than assumed to run forever. */
  endsAt: string | null;
  /** Eligibility needs more than depositing (hooks, whitelists, a minimum). */
  conditional: boolean;
  /** Paid out over time after the campaign (not modelled yet). */
  vesting: boolean;
}

export interface Capacity {
  /** Room left under the deposit cap, USD; null → not reported (not «zero room»). */
  depositRemainingUsd: number | null;
  /** The product has no deposit cap at all (e.g. a Morpho Blue market). */
  uncapped?: boolean;
  /** What could be withdrawn right now, USD (TVL is not exit liquidity). */
  withdrawableNowUsd: number | null;
}

export interface ExitTerms {
  type: 'instant' | 'queue' | 'secondary' | 'maturity' | 'unknown';
  /** Fee or penalty on exit, % of the amount, when known. */
  feePct?: number | null;
  note?: string | null;
}

export interface DebtTerm {
  /** Fixed rate until (ISO); null for a variable-rate loan. */
  fixedUntil: string | null;
  autoRollover: boolean | null;
  /** Days before liquidation when a rollover fails. */
  graceDays: number | null;
}

export interface HealthInfo {
  /** Each protocol's own measure — never translated into another's. */
  metric: 'hf' | 'ltv' | 'health-ratio';
  current: number | null;
  liquidationAt: number | null;
}

/**
 * How the supply rate moves with utilization, for the rate after the user's own
 * deposit: utilization falls to borrowed ÷ (supplied + A) and the rate follows
 * the curve. Rates on the curve only need to be consistent with each other —
 * the estimate scales the published rate by curve(u′) ÷ curve(u).
 */
export interface SupplyCurve {
  suppliedUsd: number;
  borrowedUsd: number;
  /** utilization 0…1 → supply rate (any consistent unit), sorted by utilization. */
  points: { u: number; rate: number }[];
  /** Where the curve comes from, shown with the result. */
  source: string;
}

/** One price level of a fixed-rate order book, in loan-token terms. */
export interface BookLevel {
  /** Maker price per unit, 0…1 (1 unit redeems 1 loan token at maturity). */
  price: number;
  /** Units available at this level, in loan-token units (decimals applied). */
  units: number;
}

/**
 * A fixed-rate market's order book (Morpho Midnight): the lender buys units from
 * `asks` and could sell them back into `bids` before maturity.
 * - Buying pays `price + settlementFee` per unit; selling receives `price − settlementFee`.
 * - The continuous fee is charged on the lender's units until maturity.
 */
export interface OrderBook {
  asks: BookLevel[];
  bids: BookLevel[];
  /** USD value of one loan-token unit (today's reference price). */
  unitUsd: number;
  loanSymbol: string | null;
  /**
   * Settlement fee (fraction of one unit) at each time-to-maturity breakpoint
   * (seconds); interpolated linearly. `basis: 'max'` = the protocol's maximum,
   * used when the market's own value cannot be read.
   */
  settlementFee: { breakpointsSec: number[]; values: number[]; basis: 'market' | 'max' };
  /** Continuous fee per year (fraction of units); `basis` as above. */
  continuousFeePerYear: { value: number; basis: 'market' | 'max' };
  /** Entry may be restricted to allowed addresses. */
  gated: boolean;
}

/**
 * The borrow side of a lending market: what it costs to borrow its asset and
 * against what. Used for loops and for «هزینه‌ی تأمین سرمایه».
 */
export interface BorrowSide {
  /** Variable borrow rate, % per year (APY), without incentives. */
  ratePct: number | null;
  /** Borrow rate by utilization, for the rate after the user's own borrow. */
  curve: SupplyCurve | null;
  /** What can be borrowed now, USD. */
  availableUsd: number | null;
  /** Accepted collateral and its liquidation limit (LLTV, or V4 collateral factor), 0…1. */
  collateral: { token: TokenRef; maxLtv: number; yield?: AssetYield | null; supplyPct?: number | null }[];
  /** Each protocol's own health measure. */
  metric: 'ltv' | 'hf';
  /** Aave V4: a user risk premium depending on the collateral mix is not included. */
  premiumUnknown?: boolean;
}

/** A yield-bearing asset's own yield (staking, savings rate), separate from any lending rate. */
export interface AssetYield {
  pct: number;
  kind: RateKind;
  source: string;
}

/**
 * A loop: deposit collateral, borrow the debt asset, swap back into collateral,
 * repeat. Only pairs that move together (USD/USD, ETH/ETH, BTC/BTC) — with prices
 * held constant a volatile pair's «profit» would mean nothing.
 */
export interface LoopSpec {
  collateral: { token: TokenRef; yield: AssetYield; supplyPct?: number | null };
  debt: { token: TokenRef; side: BorrowSide };
  maxLtv: number;
  pairClass: 'usd' | 'eth' | 'btc';
}

export type DataQuality = 'current' | 'stale' | 'partial' | 'insufficient';

export interface SourceRef {
  name: string;
  url: string | null;
  fetchedAt: string;
  /** When the source itself last updated the numbers (not when we fetched them). */
  sourceUpdatedAt: string | null;
}

export interface Opportunity {
  /** `protocol:chainKey:market:side` — stable across refreshes. */
  key: string;
  family: OpportunityFamily;
  protocol: { id: string; version: string | null; name: string };
  /** Network key from the registry, e.g. "eip155:1", "solana:mainnet". */
  chain: string;
  market: { id: string; address: string | null; name: string };
  assets: { deposit: TokenRef[]; collateral?: TokenRef[]; debt?: TokenRef[] };
  rate: RateQuote;
  /** ISO date; null for products without a maturity (lending, vaults). */
  maturity: string | null;
  capacity: Capacity;
  exit: ExitTerms;
  rewards: RewardStream[];
  supplyCurve?: SupplyCurve | null;
  book?: OrderBook | null;
  /** Borrowing this market's asset (lending markets). */
  borrow?: BorrowSide | null;
  /** The deposit asset's own yield, when it has one. */
  assetYield?: AssetYield | null;
  /** This deposit used as collateral (Aave V4 reserves): its limit and what it earns meanwhile. */
  asCollateral?: { maxLtv: number; supplyPct: number | null } | null;
  /** Leverage family: the loop it describes. */
  loop?: LoopSpec | null;
  debtTerm?: DebtTerm | null;
  health?: HealthInfo | null;
  risk?: { oracle?: string | null; curator?: string | null; paused?: boolean; incidents?: string[] };
  quality: DataQuality;
  sources: SourceRef[];
  /** Facts about the data that the estimate repeats as assumptions (e.g. how a rate was derived). */
  notes?: string[];
  /** Official app page for this opportunity. */
  url?: string | null;
  /** Logo of the deposit asset, when the source gives one. */
  icon?: string | null;
}

/** One cost line. measured: from live data; assumed: the user's setting; model: computed from live data with a stated model. */
export interface CostItem {
  key: string;
  label: string;
  usd: number;
  basis: 'measured' | 'assumed' | 'model';
}

/** Where an estimate lands in the ranking — only 'ranked' competes for the top list. */
export type Placement =
  | 'ranked'
  /** Less than half of the capital fits. */
  | 'low-capacity'
  /** Net ≤ 0 for this amount and period. */
  | 'unprofitable'
  /** Matures after the horizon and the user needs to exit before it. */
  | 'beyond-horizon'
  /** LP, leverage, YT-for-points: no defensible dollar estimate in the general list. */
  | 'specialist'
  /** Source data older than the freshness limit. */
  | 'stale'
  /** Not enough data to estimate. */
  | 'insufficient';

export interface Estimate {
  key: string;
  capital: number;
  /** Days asked for, and days that actually earn (shorter when the product matures first). */
  days: number;
  earningDays: number;
  allocatable: number;
  unallocated: number;
  unallocatedReason: string | null;
  /** Published base rate, % per year, and the rate after the user's deposit moves utilization (ranked on). */
  rateNow: number | null;
  rateAfterEntry: number | null;
  /** Income from the base rate, USD; null when it could not be computed. */
  baseIncome: number | null;
  /** Priced token rewards, USD (points never). */
  rewards: number;
  rewardLines: { key: string; label: string; usd: number; days: number; source?: 'merkl' | 'protocol' }[];
  debtCost: number;
  costs: CostItem[];
  /** Costs or inputs that exist but could not be measured — listed, never set to 0. */
  unknown: string[];
  net: number | null;
  /** net ÷ capital, %; for this period (not annualised). */
  netPct: number | null;
  /**
   * Fixed-rate only: what the filled units would fetch if sold into today's bids —
   * a reference beside the result, never added to it.
   */
  exitToday?: { usd: number | null; complete: boolean } | null;
  /** Leverage family: the position on the user's own money. */
  leverage?: LeverageResult | null;
  assumptions: string[];
  quality: DataQuality;
  placement: Placement;
}

export interface LeverageResult {
  /** Leverage applied, and the highest that keeps health at the user's minimum. */
  leverage: number;
  maxSafe: number;
  /** Own money in, total collateral and debt, USD. */
  equity: number;
  gross: number;
  debt: number;
  /** Collateral yield and borrow rate used (after the user's own borrow), % per year. */
  yieldPct: number;
  borrowPct: number;
  /** LTV now and at liquidation; the protocol's own health value. */
  ltv: number;
  maxLtv: number;
  health: { metric: 'ltv' | 'hf'; value: number; min: number };
  /** Relative fall of collateral against debt that reaches liquidation, 0…1. */
  liquidationDrop: number;
  /** Yield minus borrow rate × debt share: below zero the loop loses money at today's rates. */
  carryPct: number;
}
