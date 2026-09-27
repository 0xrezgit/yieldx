import type { MarketData, MarketSummary } from './market';
import type { ValidationResult } from '../lib/utils/validation';

export type ProtocolId = 'exponent' | 'pendle' | 'spectra' | 'sense';

export interface PointsParams {
  /** Units of underlying exposure (YT units, or SY units held in an LP). */
  exposureUnits: number;
  pointsPerDay: number;
  multiplier: number;
  days: number;
}

export interface PositionParams {
  capital: number;
  underlyingPrice: number;
  ptPrice: number;
  ytPrice: number;
  daysToMaturity: number;
}

export interface ProtocolAdapter {
  id: ProtocolId;
  name: string;
  /** True when the adapter can fetch market data from the protocol API. */
  liveData: boolean;
  listMarkets(): Promise<MarketSummary[]>;
  fetchMarketData(marketId: string): Promise<MarketData>;
  /** Daily underlying (base) APY history in %, oldest first. */
  getHistoricalAPY(marketId: string, days: number): Promise<number[]>;
  calculateImpliedAPY(ytPrice: number, daysToMaturity: number): number;
  calculatePointsEarning(params: PointsParams): number;
  validatePosition(params: PositionParams): ValidationResult;
}
