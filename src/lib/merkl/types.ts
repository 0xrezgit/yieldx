/**
 * Merkl incentive opportunities, as YieldX uses them. Deliberately separate from
 * the PT/YT market types: a Merkl opportunity has no maturity, only campaigns that
 * end on their own dates, and its APR is an incentive paid on top of whatever the
 * activity itself earns.
 *
 * Units: every APR is a percentage (5 means 5%), USD values are plain dollars,
 * timestamps are unix seconds.
 */

export type MerklAction = 'LEND' | 'POOL' | 'HOLD' | 'BORROW' | 'DROP' | 'SWAP' | 'STAKE' | 'LONG' | 'SHORT' | 'OTHER';

/** TOKEN: transferable, market-priced. POINT: no price. PRETGE: priced by Merkl from a valuation, not a market. */
export type MerklTokenType = 'TOKEN' | 'POINT' | 'PRETGE';

export interface MerklToken {
  symbol: string;
  name: string;
  address: string;
  chainId: number;
  icon: string | null;
  /** USD price as Merkl reports it; null when absent or zero. For PRETGE this is an assumption. */
  price: number | null;
  /** When the price was last updated (seconds). */
  priceAt: number | null;
  verified: boolean;
  type: MerklTokenType;
}

export interface MerklHook {
  /** Merkl HookType enum value. */
  type: number;
  /** Health-factor threshold for HEALTH_FACTOR hooks. */
  threshold?: number;
}

/**
 * How a campaign's reward rate is set — what decides whether a personal estimate
 * is possible:
 * - pool: fixed budget shared by everyone (dilutes as TVL grows)
 * - capped: shared budget, but the APR never exceeds `capApr`
 * - fixedValue: fixed USD per USD per year (`rate` as a fraction)
 * - fixedAmount: fixed reward-token units per USD per year (`rate`)
 * - fixedPerUnit: fixed reward-token units per deposited token unit per year (`rate`)
 * - target: tops up a native yield to a target — depends on that yield
 * - airdrop: computed outside Merkl (off-chain data, cashback…)
 * - other: a mechanism YieldX does not model
 */
export type MerklRateKind = 'pool' | 'capped' | 'fixedValue' | 'fixedAmount' | 'fixedPerUnit' | 'target' | 'airdrop' | 'other';

export interface MerklCampaign {
  id: string;
  start: number;
  end: number;
  /** Merkl `distributionType` and the underlying method, as given. */
  distributionType: string;
  method: string | null;
  rateKind: MerklRateKind;
  /** fixedValue: fraction; fixedAmount / fixedPerUnit: tokens per year. */
  rate: number | null;
  /** capped: the APR ceiling, %. */
  capApr: number | null;
  /** Campaign APR as observed now, %. */
  apr: number;
  /** USD distributed per day to everyone, at today's price (0 for unpriced tokens). */
  dailyUsd: number;
  /** Reward-token units distributed per day to everyone. */
  dailyUnits: number | null;
  /** Whole campaign budget in reward-token units. */
  budget: number | null;
  rewardToken: MerklToken;
  hooks: MerklHook[];
  whitelistCount: number;
  blacklistCount: number;
  /** Concentrated liquidity: rewards depend on range and fees, not on capital alone. */
  clmm: boolean;
}

export interface MerklProtocol {
  id: string;
  name: string;
  icon: string | null;
  url: string | null;
  /** Number of audits reported by Merkl's trust data; null when unknown. */
  audits: number | null;
  hacks: number;
}

export interface MerklChain {
  id: number;
  name: string;
  icon: string | null;
}

export interface MerklOpportunity {
  id: string;
  name: string;
  action: MerklAction;
  /** Merkl opportunity type, e.g. "UNISWAP_V4", "ERC20LOGPROCESSOR". */
  type: string;
  identifier: string;
  chain: MerklChain;
  protocol: MerklProtocol | null;
  /** Tokens the user deposits or holds. */
  tokens: MerklToken[];
  /** Sum of live campaign APRs, %. */
  apr: number;
  /** Native yield of the activity as Merkl reports it, %; null when absent. */
  nativeApr: number | null;
  /** Largest eligible TVL across campaigns, USD. */
  tvl: number;
  dailyUsd: number;
  /** When Merkl recorded the APR (seconds); null when unknown. */
  aprAt: number | null;
  depositUrl: string | null;
  howTo: string[];
  /** Live campaigns only (started and not ended when fetched). */
  campaigns: MerklCampaign[];
}

export interface MerklFeed {
  opportunities: MerklOpportunity[];
  /** When the server received the data from Merkl (ms). */
  fetchedAt: number;
  /** True when the latest refresh failed and this is the last good copy. */
  stale: boolean;
}
