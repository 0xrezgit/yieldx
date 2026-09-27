import thresholds from '../../config/thresholds.json';
import { impliedAPYFromPT } from '../calculators/implied-apy';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface LiquidationRisk {
  /** Liquidation threshold / aggregate LTV. Below 1 means liquidatable. */
  healthFactor: number;
  /** PT price (accounting-asset units) at which the position is liquidated. */
  liquidationPTPrice: number;
  /** How far PT can fall before liquidation, %. */
  priceDropToLiquidation: number;
  /** Market implied APY at which the position is liquidated, %. */
  liquidationImpliedAPY: number;
  risk: RiskLevel;
}

/**
 * Assumes the money market prices PT collateral at its market price and the debt
 * is in the accounting asset. A rising implied APY lowers PT price and pushes LTV up.
 */
export function assessLiquidation(
  aggregateLTV: number,
  liquidationThreshold: number,
  ptPrice: number,
  daysToMaturity: number,
): LiquidationRisk {
  if (!(aggregateLTV > 0)) {
    return {
      healthFactor: Infinity,
      liquidationPTPrice: 0,
      priceDropToLiquidation: 100,
      liquidationImpliedAPY: Infinity,
      risk: 'low',
    };
  }

  const healthFactor = liquidationThreshold / aggregateLTV;
  const liquidationPTPrice = ptPrice / healthFactor;
  const priceDropToLiquidation = (1 - 1 / healthFactor) * 100;
  const liquidationImpliedAPY = liquidationPTPrice < 1 ? impliedAPYFromPT(liquidationPTPrice, daysToMaturity) : -Infinity;

  let risk: RiskLevel;
  if (healthFactor < thresholds.liquidation.healthHigh) risk = 'high';
  else if (healthFactor < thresholds.liquidation.healthMedium) risk = 'medium';
  else risk = 'low';

  return { healthFactor, liquidationPTPrice, priceDropToLiquidation, liquidationImpliedAPY, risk };
}
