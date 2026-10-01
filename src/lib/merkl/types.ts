/**
 * Merkl incentive opportunities, as YieldX uses them. Deliberately separate from
 * the PT/YT market types: a Merkl opportunity has no maturity, only campaigns that
 * end on their own dates, and its APR is an incentive paid on top of whatever the
 * activity itself earns.
 *
 * Relations (Merkl API v4): a Program (e.g. «Ethena Liquid Leverage») sponsors
 * Opportunities; a Protocol (e.g. Aave) hosts them; each Opportunity carries one or
 * more Campaigns, each with its own reward token, rate rule and end date.
 *
 * Units: every APR is a percentage (5 means 5%), USD values are plain dollars,
 * timestamps are unix seconds unless named `…Ms`.
 */

export type MerklAction = 'LEND' | 'POOL' | 'HOLD' | 'BORROW' | 'DROP' | 'SWAP' | 'STAKE' | 'LONG' | 'SHORT' | 'OTHER';

/** TOKEN: transferable, market-priced. POINT: no price. PRETGE: not launched; any price is an assumption. */
export type MerklTokenType = 'TOKEN' | 'POINT' | 'PRETGE';

export interface MerklToken {
  symbol: string;
  name: string;
  address: string;
  chainId: number;
  icon: string | null;
  /** USD price as Merkl reports it; null when absent, zero, or the token is a point. */
  price: number | null;
  /** When the price was last updated (seconds). */
  priceAt: number | null;
  /** Merkl's price source label; null when Merkl has none. */
  priceSource: string | null;
  verified: boolean;
  type: MerklTokenType;
  /** Token decimals (for a sell quote); null when Merkl sends none. */
  decimals?: number | null;
  /** A Merkl wrapper («… (wrapped)»): Merkl's id of the token it turns into when claimed. */
  underlyingId?: string | null;
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
 * - target: tops up a native yield to a target — its APR includes that yield
 * - airdrop: computed outside Merkl (off-chain data, cashback…)
 * - other: a mechanism YieldX does not model
 */
export type MerklRateKind = 'pool' | 'capped' | 'fixedValue' | 'fixedAmount' | 'fixedPerUnit' | 'target' | 'airdrop' | 'other';

export interface MerklCampaign {
  id: string;
  /** On-chain campaign id, as used in Merkl's APR/reward records. */
  campaignId: string;
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
  /** Campaign APR as observed now, %. For target campaigns this includes the native yield. */
  apr: number;
  /** USD distributed per day to everyone, at today's price (0 for unpriced tokens). */
  dailyUsd: number;
  /** Reward-token units distributed per day to everyone. */
  dailyUnits: number | null;
  /** Whole campaign budget in reward-token units. */
  budget: number | null;
  rewardToken: MerklToken;
  /** Chain where rewards are claimed (can differ from where the position lives). */
  distributionChainId: number;
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

/** A Merkl program (a sponsor's umbrella over several opportunities). */
export interface MerklProgramRef {
  slug: string;
  name: string;
  icon: string | null;
}

export interface MerklProgram extends MerklProgramRef {
  description: string | null;
}

export interface MerklOpportunity {
  id: string;
  name: string;
  action: MerklAction;
  /** Merkl opportunity type, e.g. "UNISWAP_V4", "ERC20LOGPROCESSOR". */
  type: string;
  identifier: string;
  /** Contract behind the opportunity when Merkl gives one (explorer link). */
  explorerAddress: string | null;
  chain: MerklChain;
  protocol: MerklProtocol | null;
  programs: MerklProgramRef[];
  tags: string[];
  /** Tokens the user deposits or holds. */
  tokens: MerklToken[];
  /** Sum of live campaign APRs, %. */
  apr: number;
  /** Merkl's combined APR (incentive + native where they add up), %; null when absent. */
  totalApr: number | null;
  /** Native yield of the activity as Merkl reports it, %; null when absent. */
  nativeApr: number | null;
  /** When Merkl measured that native yield (seconds); null when unknown. */
  nativeAt: number | null;
  /** How Merkl measured it («Supply APR of 1 targeted Morpho market…»); null for a bare, protocol-declared figure. */
  nativeSource: string | null;
  /** Largest eligible TVL across campaigns, USD. */
  tvl: number;
  dailyUsd: number;
  /** When Merkl recorded the APR / TVL snapshot (seconds); null when unknown. */
  aprAt: number | null;
  tvlAt: number | null;
  depositUrl: string | null;
  howTo: string[];
  /** Live campaigns only (started and not ended when fetched). */
  campaigns: MerklCampaign[];
}

/** DEX market data for a token, from DexScreener (independent of Merkl). */
export interface TokenMarket {
  /** Sum of USD liquidity across the token's pairs on its chain. */
  liquidityUsd: number;
  /** Price in the deepest pair where the token is the base asset; null when none. */
  dexPrice: number | null;
  volume24h: number;
  pairs: number;
  url: string | null;
}

/**
 * Whether a reward token can actually be sold: a KyberSwap quote selling about
 * $1,000 of it (or of the token a Merkl wrapper turns into when claimed) into the
 * chain's dollar stablecoin.
 */
export interface SellQuote {
  /** USD the sale returns ÷ the same amount at Merkl's price, % (impact and price gap together). */
  keptPct: number;
  /** Merkl's price implied by the quote: USD out per token. */
  usdPerToken: number;
  /** Symbol of the underlying when the reward is a Merkl wrapper; null otherwise. */
  via: string | null;
  source: 'KyberSwap';
}

/** Network cost measured on the server. */
export interface GasQuote {
  chainId: number;
  /** Gas price in gwei. */
  gwei: number;
  /** Native token price in USD (from Merkl's own price feed). */
  nativeUsd: number;
  at: number;
}

export interface MerklFeed {
  opportunities: MerklOpportunity[];
  programs: MerklProgram[];
  /** Keyed by `tokenKey(chainId, address)`. Absent key: not looked up or chain not covered. */
  markets: Record<string, TokenMarket | null>;
  /** Chains DexScreener covers — a missing market on these means «no DEX pair found». */
  marketChains: number[];
  /** Sell quotes by `tokenKey`; null = no route (cannot be sold); absent = not checked (chain unsupported). */
  sells?: Record<string, SellQuote | null>;
  gas: GasQuote[];
  /** When the server received the data from Merkl (ms). */
  fetchedAt: number;
  /** True when the latest refresh failed and this is the last good copy. */
  stale: boolean;
}

export const tokenKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
