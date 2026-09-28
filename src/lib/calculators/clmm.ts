import { ptPriceFromAPY } from './implied-apy';
import { pointsEarned } from './airdrop';
import { assessLiquidityRisk, calculateImpermanentLoss, type LiquidityRisk } from '../risk/impermanent-loss';

/**
 * PT/SY concentrated liquidity whose range is set in implied-APY terms
 * (as on Exponent). A higher implied APY means a lower PT price, so the APY
 * range [lo, hi] maps to the PT price range [pt(hi), pt(lo)].
 */
export interface CLMMInput {
  capital: number;
  underlyingPrice: number;
  impliedAPY: number;
  rangeLowerAPY: number;
  rangeUpperAPY: number;
  feeAPY: number;
  daysToMaturity: number;
  pointsPerDay: number;
  lpMultiplier: number;
  /** Daily std-dev of the implied APY (percentage points), for range risk. */
  apyVolatility: number;
}

export interface CLMMResult extends LiquidityRisk {
  /** Fee income to maturity while in range, USD. */
  feeIncome: number;
  /** IL if implied APY moves to the lower / upper edge of the range, %. */
  ilAtLowerEdge: number;
  ilAtUpperEdge: number;
  points: number;
}

export function calculateCLMM(p: CLMMInput): CLMMResult {
  const d = p.daysToMaturity;
  const priceLower = ptPriceFromAPY(p.rangeUpperAPY, d);
  const priceUpper = ptPriceFromAPY(p.rangeLowerAPY, d);
  const current = ptPriceFromAPY(p.impliedAPY, d);

  const risk = assessLiquidityRisk(p.rangeLowerAPY, p.rangeUpperAPY, p.impliedAPY, p.apyVolatility);
  const t = d / 365;

  return {
    ...risk,
    feeIncome: risk.inRange ? p.capital * (p.feeAPY / 100) * t : 0,
    ilAtLowerEdge: calculateImpermanentLoss(priceLower, priceUpper, priceUpper, current),
    ilAtUpperEdge: calculateImpermanentLoss(priceLower, priceUpper, priceLower, current),
    // Approximation: points accrue on the SY-equivalent value of the deposit.
    points: risk.inRange ? pointsEarned(p.capital / p.underlyingPrice, p.pointsPerDay, p.lpMultiplier, d) : 0,
  };
}
