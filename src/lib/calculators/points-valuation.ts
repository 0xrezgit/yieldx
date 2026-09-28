import thresholds from '../../config/thresholds.json';
import { valuePerPoint } from './airdrop';

export type PointsRecommendation = 'buy' | 'wait' | 'avoid';

export interface PointsValuation {
  /** Net USD cost of the position (capital − yield returned). Negative means yield alone is profitable. */
  burn: number;
  /** USD paid per 1M points; 0 when the yield covers the capital. */
  costPerMillion: number;
  /** USD value of 1M points at the assumed FDV/allocation. */
  valuePerMillion: number;
  /** FDV at which the airdrop exactly repays the burn. */
  breakEvenFDV: number;
  recommendation: PointsRecommendation;
}

export interface PointsValuationInput {
  capital: number;
  yieldReturn: number;
  points: number;
  fdv: number;
  /** % of FDV allocated to points holders. */
  allocation: number;
  totalPointsSupply: number;
}

/**
 * The airdrop pays  points/totalSupply × FDV × allocation, so the FDV that repays a
 * burn B is  B × totalSupply / (points × allocation).
 */
export function calculatePointsValuation(input: PointsValuationInput): PointsValuation {
  const { capital, yieldReturn, points, fdv, allocation, totalPointsSupply } = input;
  const burn = capital - yieldReturn;
  const valuePerMillion = valuePerPoint({ fdv, allocation, totalPointsSupply }) * 1_000_000;

  if (burn <= 0) {
    return { burn, costPerMillion: 0, valuePerMillion, breakEvenFDV: 0, recommendation: 'buy' };
  }

  if (!(points > 0) || !(allocation > 0)) {
    return { burn, costPerMillion: Infinity, valuePerMillion, breakEvenFDV: Infinity, recommendation: 'avoid' };
  }

  const costPerMillion = (burn / points) * 1_000_000;
  const breakEvenFDV = (burn * totalPointsSupply) / (points * (allocation / 100));

  let recommendation: PointsRecommendation;
  if (fdv >= breakEvenFDV * thresholds.points.buyMargin) recommendation = 'buy';
  else if (fdv >= breakEvenFDV) recommendation = 'wait';
  else recommendation = 'avoid';

  return { burn, costPerMillion, valuePerMillion, breakEvenFDV, recommendation };
}
