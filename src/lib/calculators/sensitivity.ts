import { ytPosition, ytYield, type YTPositionInput } from './pt-yt';
import { airdropValue, pointsEarned } from './airdrop';

export interface SensitivityInput extends YTPositionInput {
  baseAPY: number;
  pointsPerDay: number;
  ytMultiplier: number;
  fdv: number;
  allocation: number;
  totalPointsSupply: number;
}

export interface SensitivityCell {
  apy: number;
  multiplier: number;
  fdv: number;
  pnl: number;
  roi: number;
}

export const APY_SHIFTS = [-0.5, -0.25, 0, 0.25, 0.5];
export const MULTIPLIER_FACTORS = [0.5, 1, 1.5, 2];
export const FDV_FACTORS = [0.25, 0.5, 1, 2, 4];

/**
 * Net PnL (yield + airdrop − capital) of a YT position across three axes:
 * base APY change × points multiplier × FDV. Returned as cube[fdv][apy][multiplier].
 */
export function sensitivityCube(input: SensitivityInput): SensitivityCell[][][] {
  const { units, notional } = ytPosition(input);
  return FDV_FACTORS.map((ff) =>
    APY_SHIFTS.map((as) =>
      MULTIPLIER_FACTORS.map((mf) => {
        const apy = input.baseAPY * (1 + as);
        const multiplier = input.ytMultiplier * mf;
        const fdv = input.fdv * ff;
        const points = pointsEarned(units, input.pointsPerDay, multiplier, input.daysToMaturity);
        const drop = airdropValue(points, { fdv, allocation: input.allocation, totalPointsSupply: input.totalPointsSupply });
        const pnl = ytYield(notional, apy, input.daysToMaturity) + drop - input.capital;
        return { apy, multiplier, fdv, pnl, roi: (pnl / input.capital) * 100 };
      }),
    ),
  );
}
