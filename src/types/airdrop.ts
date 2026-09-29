import type { TokenAmount } from './position';

/**
 * Points → airdrop, recorded by hand after the fact. One record per points program
 * and season (points belong to the wallet, not to one position), linked to the YT
 * positions that earned them. Nothing here is a what-if: every number is what the
 * user read on the project's site or received. Stored with the portfolio (browser only).
 */
export interface AirdropToken {
  symbol: string;
  /** Network name as used across the app (e.g. "Ethereum", "Solana"). */
  chain: string;
  /** Contract address or Solana mint, exactly as typed; enables automatic pricing. */
  address: string | null;
}

export interface AirdropClaim {
  id: string;
  at: string;
  /** Tokens received (claimed). */
  amount: number;
  /** USD per token at the claim time; null when unknown. */
  usdRate: number | null;
  /** Claim transaction cost, USD. */
  feeUsd: number;
  /** Part of `amount` still locked (vesting), and when it unlocks. */
  lockedAmount: number;
  unlockAt: string | null;
}

export interface AirdropSale {
  id: string;
  at: string;
  /** Airdrop tokens sold. */
  amount: number;
  /** What was received for them. */
  received: TokenAmount;
  feeUsd: number;
}

export interface AirdropProgram {
  id: string;
  /** Points program name, e.g. "Hylo XP". */
  name: string;
  season: number | null;
  /** YT positions that earned these points. */
  positionIds: string[];
  /** Manual split between linked positions (0–1 each); null → pro rata by estimated points. */
  shares: Record<string, number> | null;
  /** Final points balance read on the project's site. */
  finalPoints: { amount: number; at: string } | null;
  token: AirdropToken | null;
  claims: AirdropClaim[];
  sales: AirdropSale[];
  /** The project gave no airdrop for these points. */
  noAirdrop: boolean;
  /** Current token price typed by hand (used when no automatic price). */
  manualPrice: { usd: number; at: string } | null;
  createdAt: string;
  updatedAt: string;
}
