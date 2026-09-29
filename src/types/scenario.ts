import type { ProtocolId } from './protocol';
import type { PointsBasis, PointsStatus, TokenRef } from './market';

/**
 * Everything the user enters (or a protocol adapter fills in) for one analysis.
 * Prices of PT/YT are in accounting-asset units, APYs are percentages.
 */
/**
 * Where the market numbers came from — kept separate from the numbers themselves.
 * Origin: API or manual; freshness is derived from `fetchedAt` at render time;
 * `sourceUpdatedAt` is the protocol's own timestamp (fetched now ≠ produced now).
 */
export interface DataMeta {
  source: 'api' | 'manual';
  /** When YieldX received the data. */
  fetchedAt: string | null;
  /** When the protocol last updated it, when the API says so. */
  sourceUpdatedAt: string | null;
  /** Market fields the API did not provide (shown as «—», never as 0). */
  missing: string[];
  /** Market fields the user typed over (kept on refresh, labelled «دستی»). */
  manual: string[];
  /** Unit PT redeems into / PT and YT prices are quoted in. */
  accountingSymbol: string | null;
  asset: TokenRef | null;
  historySource: 'api' | 'manual' | 'none';
}

export interface ScenarioParams {
  // Market
  protocol: ProtocolId;
  marketId: string;
  marketName: string;
  /** Project behind the underlying, when known. */
  platform: string;
  /** Token logo URL ('' when unknown). */
  marketIcon: string;
  /** Network name ('' when unknown). */
  chain: string;
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
  /** Market size in asset units, when known (see MarketData.marketSizeUnits). */
  marketSizeUnits: number | null;

  // Points program
  pointsStatus: PointsStatus;
  pointsName: string;
  pointsSeason: number | null;
  /** Points per day for one unit (or one USD, see pointsBasis) of exposure. */
  pointsPerDay: number;
  pointsBasis: PointsBasis;
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
  /** Airdrop snapshot date (yyyy-mm-dd); '' when unknown. Points after it are worth nothing. */
  snapshotDate: string;
  /** Largest cash loss (% of capital) accepted when exiting YT early. */
  maxExitLoss: number;

  // PT looping
  ltv: number;
  loops: number;
  borrowAPY: number;
  liquidationThreshold: number;

  // CLMM (range expressed in implied APY %)
  rangeLowerAPY: number;
  rangeUpperAPY: number;
  feeAPY: number;

  /** Provenance of the market numbers (absent in data saved by older versions). */
  dataMeta?: DataMeta;
  /** The user chose to enter a market by hand (no market picked). */
  manualEntry?: boolean;
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
  platform: '',
  marketIcon: '',
  chain: '',
  capital: 10_000,
  underlyingPrice: 1,
  ptPrice: 0.97,
  ytPrice: 0.03,
  baseAPY: 8,
  maturity: inDays(120),
  apyHistory: [],
  liquidity: null,
  marketSizeUnits: null,

  pointsStatus: 'unknown',
  pointsName: 'Points',
  pointsSeason: null,
  pointsPerDay: 1,
  pointsBasis: 'unit',
  ytMultiplier: 5,
  lpMultiplier: 2,

  fdv: 100_000_000,
  airdropAllocation: 10,
  totalPointsSupply: 5_000_000_000,
  existingPoints: 0,
  snapshotDate: '',
  maxExitLoss: 10,

  ltv: 75,
  loops: 3,
  borrowAPY: 5,
  liquidationThreshold: 85,

  rangeLowerAPY: 5,
  rangeUpperAPY: 15,
  feeAPY: 12,
});
