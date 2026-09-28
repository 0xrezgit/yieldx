/** Points earned by holding `exposureUnits` of underlying exposure for `days`. */
export function pointsEarned(exposureUnits: number, pointsPerDay: number, multiplier: number, days: number): number {
  return Math.max(0, exposureUnits * pointsPerDay * multiplier * days);
}

export interface AirdropInput {
  fdv: number;
  /** % of FDV going to points holders. */
  allocation: number;
  totalPointsSupply: number;
}

/** USD value of one point if the airdrop happens at these assumptions. */
export function valuePerPoint({ fdv, allocation, totalPointsSupply }: AirdropInput): number {
  if (!(totalPointsSupply > 0)) return 0;
  return (fdv * (allocation / 100)) / totalPointsSupply;
}

export function airdropValue(points: number, input: AirdropInput): number {
  return points * valuePerPoint(input);
}

/** Share of the whole points supply these points represent. */
export function pointsShare(points: number, totalPointsSupply: number): number {
  return totalPointsSupply > 0 ? points / totalPointsSupply : 0;
}
