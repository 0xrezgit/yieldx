/**
 * Direct YT purchase. One YT receives the yield of one accounting-asset unit until
 * maturity and is worth zero afterwards, so the capital itself never comes back —
 * only the accrued yield (plus any points) does.
 */
export interface YTPositionInput {
  capital: number;
  underlyingPrice: number;
  ytPrice: number;
  daysToMaturity: number;
}

export interface YTPosition {
  /** YT units bought (= units of underlying whose yield we receive). */
  units: number;
  /** USD value of the underlying the YT tracks. */
  notional: number;
  /** Yield exposure per dollar invested. */
  leverage: number;
  /** Realised APY at which accrued yield exactly repays the capital. */
  breakEvenAPY: number;
}

export function ytPosition({ capital, underlyingPrice, ytPrice, daysToMaturity }: YTPositionInput): YTPosition {
  const units = capital / (ytPrice * underlyingPrice);
  const t = daysToMaturity / 365;
  return {
    units,
    notional: units * underlyingPrice,
    leverage: 1 / ytPrice,
    breakEvenAPY: (Math.pow(1 + ytPrice, 1 / t) - 1) * 100,
  };
}

/** USD yield accrued to maturity if the underlying pays `apy` (compounded) the whole time. */
export function ytYield(notional: number, apy: number, daysToMaturity: number): number {
  return notional * (Math.pow(1 + apy / 100, daysToMaturity / 365) - 1);
}

/** Yield-only PnL of a YT position (capital is spent, yield is what returns). */
export function ytPnL(input: YTPositionInput, apy: number): number {
  const { notional } = ytPosition(input);
  return ytYield(notional, apy, input.daysToMaturity) - input.capital;
}

/** Fixed return of holding PT to maturity, in USD. */
export function ptFixedReturn(capital: number, ptPrice: number): number {
  return capital * (1 / ptPrice - 1);
}
