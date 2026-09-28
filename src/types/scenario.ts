import type { ProtocolId } from './protocol';

/**
 * Everything the user enters (or a protocol adapter fills in) for one analysis.
 * Prices of PT/YT are in accounting-asset units, APYs are percentages.
 */
export interface ScenarioParams {
  // Market
  protocol: ProtocolId;
  marketId: string;
  marketName: string;
  capital: number;
  underlyingPrice: number;
  ptPrice: number;
  ytPrice: number;
  baseAPY: number;
  /** ISO date (yyyy-mm-dd). */
  maturity: string;
  /** Daily base APY history in %, oldest first. */
  apyHistory: number[];
  /** Market liquidity in USD, when known. */
  liquidity: number | null;

  // Points program
  pointsName: string;
  /** Points per day for one unit of underlying exposure. */
  pointsPerDay: number;
  ytMultiplier: number;
  lpMultiplier: number;

  // Airdrop assumptions
  fdv: number;
  /** % of FDV allocated to points holders. */
  airdropAllocation: number;
  /** Expected total points supply at snapshot. */
  totalPointsSupply: number;
  /** Points already earned before this position. */
  existingPoints: number;

  // PT looping
  ltv: number;
  loops: number;
  borrowAPY: number;
  liquidationThreshold: number;

  // CLMM (range expressed in implied APY %)
  rangeLowerAPY: number;
  rangeUpperAPY: number;
  feeAPY: number;
}

export type ScenarioKey = keyof ScenarioParams;
export type ScenarioSetter = <K extends ScenarioKey>(key: K, value: ScenarioParams[K]) => void;

export interface SavedScenario {
  id: string;
  name: string;
  data: ScenarioParams;
  createdAt: string;
  updatedAt: string;
}

const inDays = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/** Sample values only — replace with real market data before deciding anything. */
export const defaultScenario = (): ScenarioParams => ({
  protocol: 'exponent',
  marketId: '',
  marketName: '',
  capital: 10_000,
  underlyingPrice: 1,
  ptPrice: 0.97,
  ytPrice: 0.03,
  baseAPY: 8,
  maturity: inDays(120),
  apyHistory: [],
  liquidity: null,

  pointsName: 'Points',
  pointsPerDay: 1,
  ytMultiplier: 5,
  lpMultiplier: 2,

  fdv: 100_000_000,
  airdropAllocation: 10,
  totalPointsSupply: 5_000_000_000,
  existingPoints: 0,

  ltv: 75,
  loops: 3,
  borrowAPY: 5,
  liquidationThreshold: 85,

  rangeLowerAPY: 5,
  rangeUpperAPY: 15,
  feeAPY: 12,
});
