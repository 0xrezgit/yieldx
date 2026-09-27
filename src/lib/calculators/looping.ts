/**
 * PT looping on a money market: deposit PT, borrow `ltv`% of its value, buy more PT,
 * repeat `loops` times. PT earns its fixed (implied) rate; debt pays `borrowAPY`.
 * PT earns no points, so this strategy is purely a fixed-yield carry trade.
 */
export interface LoopingInput {
  capital: number;
  ptPrice: number;
  ltv: number;
  loops: number;
  borrowAPY: number;
  daysToMaturity: number;
}

export interface LoopingResult {
  /** Total PT collateral value, USD. */
  collateral: number;
  debt: number;
  /** Collateral / capital. */
  leverage: number;
  /** Debt / collateral, %. */
  aggregateLTV: number;
  /** Net USD profit if held to maturity. */
  profitToMaturity: number;
  /** Annualised net return on capital, %. */
  netAPY: number;
  /** Borrow APY at which the loop stops being profitable, %. */
  breakEvenBorrowAPY: number;
}

export function calculateLooping({ capital, ptPrice, ltv, loops, borrowAPY, daysToMaturity }: LoopingInput): LoopingResult {
  const l = ltv / 100;
  const n = Math.max(0, Math.floor(loops));
  // Geometric series: capital × (1 + l + l² + … + lⁿ)
  const collateral = l === 1 ? capital * (n + 1) : (capital * (1 - Math.pow(l, n + 1))) / (1 - l);
  const debt = collateral - capital;
  const t = daysToMaturity / 365;

  const ptGain = collateral * (1 / ptPrice - 1);
  const borrowCost = debt * (Math.pow(1 + borrowAPY / 100, t) - 1);
  const profitToMaturity = ptGain - borrowCost;
  const growth = 1 + profitToMaturity / capital;
  const netAPY = growth > 0 ? (Math.pow(growth, 1 / t) - 1) * 100 : -100;

  const breakEvenBorrowAPY = debt > 0 ? (Math.pow(1 + ptGain / debt, 1 / t) - 1) * 100 : Infinity;

  return {
    collateral,
    debt,
    leverage: collateral / capital,
    aggregateLTV: collateral > 0 ? (debt / collateral) * 100 : 0,
    profitToMaturity,
    netAPY,
    breakEvenBorrowAPY,
  };
}
