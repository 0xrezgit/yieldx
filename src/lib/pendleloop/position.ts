/**
 * A PendleLoop position as PendleLoop opens it, so its APY and dollar profit match the
 * figures on PendleLoop's own screen.
 *
 * Leverage is PendleLoop's: L = 1 ÷ (1 − LTV), the LTV read with the money market's
 * oracle price of the collateral — not exposure ÷ capital. Its «Health Factor» is
 * 1 − LTV ÷ LLTV. With the capital C (USD), PendleLoop's service fee f on the position,
 * k collateral units bought per dollar (an executable quote when there is one) and the
 * oracle's price p_o of one unit:
 *
 *   debt  D = a · N · p_o,   a = 1 − 1/L
 *   units N = (C + D) · (1 − f) · k   ⇒   N = C·(1−f)·k ÷ (1 − a·p_o·(1−f)·k)
 *
 * At the end the PT redeems for its mid price grown at the market's fixed rate (what one
 * PT is worth at maturity in dollars — not always the accounting asset's listed price),
 * a yield-bearing asset grows at its own yield, and the debt at the borrow rate after this
 * position's own borrow.
 *
 * Checked against PendleLoop's screen (PT-USD3/USDT, Morpho, 2026-11-07, $5,000 at 5×,
 * 39 days): it showed 24,458 PT, 19,284 USDT borrowed, 47.76 % and $214; this model with
 * that day's quote gives about 24,430 PT, 19,240 USDT, 49.7 % and $221. Before, the app
 * showed 69 % and $289 (no entry cost, dollar leverage).
 */

export interface LoopEntry {
  /** Collateral units one dollar buys, before PendleLoop's fee (an executable quote, else the mid price). */
  unitsPerUsd: number;
  /** One unit's mid price in USD (what the oracle and the redemption are measured from). */
  midUsd: number;
  /** True when `unitsPerUsd` comes from an executable quote (price impact and conversion included). */
  quoted: boolean;
}

export interface LoopPositionInput {
  kind: 'pt' | 'vanilla';
  capital: number;
  /** PendleLoop's leverage, 1 ÷ (1 − LTV). */
  leverage: number;
  days: number;
  /** PT: the market's fixed APY; vanilla: the asset's own yield (+ supply rate), %. */
  yieldPct: number;
  /** Borrow APY over the period, % (after this position's own borrow). */
  borrowPct: number;
  /** Liquidation LTV, 0…1. */
  lltv: number;
  /** The oracle's price of the collateral ÷ its market price (Morpho's fixed curves read PT under the market). */
  oracleFactor: number;
  /** PendleLoop's service fee on the position, fraction. */
  feeRate: number;
  entry: LoopEntry;
}

export interface LoopPosition {
  /** Collateral units held (PT, or dollars' worth of the asset for a vanilla box at mid). */
  units: number;
  collateralUsd: number;
  debtUsd: number;
  /** Fee and price impact paid to open, USD: what went in minus the collateral's worth at mid. */
  entryCostUsd: number;
  ltv: number;
  /** PendleLoop's «Health Factor»: 1 − LTV ÷ LLTV. */
  healthPct: number;
  /** LLTV ÷ LTV. */
  health: number;
  payoutUsd: number;
  profit: number;
  apy: number;
  /** Borrow APY at which the period earns nothing, %; null without debt. */
  breakEvenBorrowPct: number | null;
  /** The leverage cannot be opened (the loop would not converge). */
  infeasible: boolean;
}

const year = (days: number) => Math.max(1, days) / 365;

/** The mid-price entry for a box without a quote: a PT at its fixed rate, an asset at par. */
export function midEntry(kind: LoopPositionInput['kind'], yieldPct: number, days: number): LoopEntry {
  const midUsd = kind === 'pt' ? Math.pow(1 + yieldPct / 100, -year(days)) : 1;
  return { unitsPerUsd: 1 / midUsd, midUsd, quoted: false };
}

export function loopPosition(i: LoopPositionInput): LoopPosition {
  const t = year(i.days);
  const C = Math.max(0, i.capital);
  const L = Math.max(1, i.leverage);
  const a = 1 - 1 / L;
  const k = Math.max(0, i.entry.unitsPerUsd) * (1 - Math.max(0, i.feeRate));
  const po = i.entry.midUsd * Math.min(1, Math.max(0, i.oracleFactor || 1));
  const denom = 1 - a * po * k;
  const infeasible = !(denom > 1e-9);
  const N = infeasible ? 0 : (C * k) / denom;
  const D = a * N * po;
  // A PT redeems for its mid price grown at the fixed rate; an asset grows at its yield.
  const endUnitUsd = i.entry.midUsd * Math.pow(1 + i.yieldPct / 100, t);
  const growDebt = Math.pow(1 + i.borrowPct / 100, t);
  const payoutUsd = N * endUnitUsd - D * growDebt;
  const profit = payoutUsd - C;
  const ltv = N * po > 0 ? D / (N * po) : 0;
  const breakEven = D > 0 && N * endUnitUsd > C ? (Math.pow((N * endUnitUsd - C) / D, 1 / t) - 1) * 100 : null;
  return {
    units: N,
    collateralUsd: N * i.entry.midUsd,
    debtUsd: D,
    entryCostUsd: C + D - N * i.entry.midUsd,
    ltv,
    healthPct: ltv > 0 ? 1 - ltv / i.lltv : 1,
    health: ltv > 0 ? i.lltv / ltv : Infinity,
    payoutUsd,
    profit,
    apy: payoutUsd > 0 && C > 0 ? (Math.pow(payoutUsd / C, 1 / t) - 1) * 100 : -100,
    breakEvenBorrowPct: breakEven,
    infeasible,
  };
}

/** PendleLoop's highest leverage for an LLTV, keeping its minimum health margin (3 % of the LLTV). */
export const pendleMaxLeverage = (lltv: number, minHealthPct = 0.03) => 1 / (1 - lltv * (1 - minHealthPct));

/** The highest leverage whose LLTV ÷ LTV stays at `minHealth` or above. */
export const leverageForHealth = (lltv: number, minHealth: number) => (minHealth > lltv ? 1 / (1 - lltv / minHealth) : Infinity);

/**
 * The borrow APY (%) after this position borrows `debtUsd`. Up to PendleLoop's reference
 * position, a straight line from today's rate to the reference's (what Pendle itself
 * expects: PT-strUSD/USDC on Morpho, 2026-11-07, 9.51 % → 9.73 % for $41k, where the raw
 * curve said 24 %). Past the reference (Pendle sizes it small where liquidity is thin) the
 * market's curve, never below the reference's rate — a straight line out there gave 297 %.
 * Without a reference, the curve; else today's rate.
 */
export function borrowAfter(spotPct: number, debtUsd: number, ref: { debtUsd: number; borrowPct: number } | null, curve: number | null): { pct: number; source: 'pendle' | 'curve' | 'spot' } {
  const hasCurve = curve !== null && Number.isFinite(curve);
  if (ref && ref.debtUsd > 0 && debtUsd >= 0) {
    if (debtUsd <= ref.debtUsd) return { pct: Math.max(spotPct, spotPct + (ref.borrowPct - spotPct) * (debtUsd / ref.debtUsd)), source: 'pendle' };
    return hasCurve && curve > ref.borrowPct ? { pct: curve, source: 'curve' } : { pct: Math.max(spotPct, ref.borrowPct), source: 'pendle' };
  }
  if (hasCurve) return { pct: curve, source: 'curve' };
  return { pct: spotPct, source: 'spot' };
}
