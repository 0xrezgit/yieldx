/**
 * The leverage comparison: one leveraged long or short, the same amount, leverage and
 * period, on every venue that offers it — a Kamino Multiply pair, a PendleLoop
 * Long/Short market (Aave or Morpho), or a Hyperliquid perp.
 *
 * The price result is the same everywhere (same exposure), so venues differ in what
 * holding the position costs over the period, and in how far the price can go against
 * it. The list ranks by the first; the second and the venue's limits sit beside it.
 *
 *   Loop (Kamino, PendleLoop) — collateral c and debt d per unit of equity:
 *     long  c = L (the asset), d = L − 1 (dollars);  short c = 1 + L (dollars), d = L (the asset).
 *     interest = E·d·(g(borrow) − 1), yield = E·c·(g(collateral yield) − 1),
 *     swaps = both ways on what is swapped (long: the borrowed L − 1; short: the borrowed L).
 *   Perp — funding on the whole position (L × funding), the trading fee both ways.
 *
 * Rates are held for the whole period (the higher of today's and the 7-day average for
 * a borrow rate; the 7-day average for funding). PendleLoop's numbers come from the
 * same model the Long/Short page uses, Kamino's from Multiply's.
 */

import { borrowPctOf, liqRatioOf, maxLeverageOf as loopMaxOf, perpHoldingPctOf, perpLiqMoveOf } from '../longshort/model';
import type { LongShortRow, PerpRef } from '../longshort/types';
import { maxLeverageOf as kaminoMaxOf } from '../multiply/model';
import type { MultiplyRow } from '../multiply/types';
import { underlyingOf, type AssetKind } from './assets';
import type { LeverageFeed } from './types';

export type Side = 'long' | 'short';
export type Venue = 'kamino' | 'pendleloop' | 'perp';

export interface LeverageInput {
  side: Side;
  capital: number;
  leverage: number;
  days: number;
  /** Swap cost (fee + price impact) when a loop buys or sells the asset, % each way. */
  swapPct: number;
  /** Perp trading fee, % of the position each way. */
  perpFeePct: number;
}

export const LEVERAGE_STEPS = [1.5, 2, 2.5, 3, 4, 5] as const;
export const PERIODS = [7, 30, 90, 180] as const;
/** Hyperliquid's base taker fee; PendleLoop's own slippage default. */
export const DEFAULT_INPUT: LeverageInput = { side: 'long', capital: 1000, leverage: 2, days: 30, swapPct: 0.1, perpFeePct: 0.045 };
/** What a loop swaps, in dollars, from which a thin market (a stock token, a small coin) may cost more than the slippage entered. */
export const THIN_SWAP_USD = 10_000;
/** Borrowing more than this share of what a market can still lend moves its rate: the cost shown is too low. */
export const RATE_JUMP_SHARE = 0.2;

export interface CostBreakdown {
  /** Interest paid on the debt over the period, USD. */
  interestUsd: number;
  /** What the collateral earns over the period (staking, supply), USD. */
  yieldUsd: number;
  /** Funding paid (positive) or received (negative) on a perp, USD. */
  fundingUsd: number;
  /** Opening and closing swaps (loops) — the slippage entered, plus Kamino's flash-loan fee. */
  swapUsd: number;
  /** Venue fee: PendleLoop's service fee, the perp's trading fee. */
  feeUsd: number;
  /** Everything together; negative is income. */
  totalUsd: number;
}

export type Blocked = { reason: 'leverage'; max: number } | { reason: 'liquidity'; availableUsd: number };

export interface Offer {
  /** The source row's key, or `perp:<coin>`. */
  key: string;
  venue: Venue;
  asset: string;
  kind: AssetKind;
  side: Side;
  /** The token held or shorted (TSLAx, WBTC, «TSLA» for a perp). */
  token: string;
  tokenIcon: string | null;
  /** The dollar side of a loop (USDC…); null for a perp. */
  debt: string | null;
  protocol: string;
  protocolIcon: string | null;
  /** Network key (`solana:mainnet`, `eip155:8453`), «hyperliquid» for a perp. */
  chain: string;
  /** Kamino's market («JLP Market»); null elsewhere. */
  market: string | null;
  /** A perp's funding held for the period (7-day average), % a year; null for a loop. */
  fundingPct: number | null;
  url: string;
  leverage: number;
  maxLeverage: number;
  exposureUsd: number;
  blocked: Blocked | null;
  cost: CostBreakdown;
  /** Price move that pays the period's cost, fraction: positive means it must go your way. */
  breakEvenMove: number;
  /** Price move to liquidation from today, fraction (negative for a long); null without one. */
  liqMove: number | null;
  flags: {
    /** A tokenised stock in a loop: its oracle stands still while the stock market is shut. */
    weekend: boolean;
    /** A loop swapping a large amount of a thin asset: the real slippage may exceed what was entered. */
    thinSwap: boolean;
    /** A loop borrowing a large share of what its market can lend: the rate rises once it does. */
    rateJump: boolean;
    /** The token follows the perp's price without being it (wstETH ↔ ETH, SPY ↔ S&P 500). */
    inexact: boolean;
  };
}

const growth = (pct: number, t: number) => Math.pow(1 + (Number.isFinite(pct) ? pct : 0) / 100, t);
const kaminoChain = 'solana:mainnet';
const jumps = (debtUsd: number, availableUsd: number | null) => availableUsd !== null && debtUsd > 0 && debtUsd <= availableUsd && debtUsd > RATE_JUMP_SHARE * availableUsd;

function finish(o: Omit<Offer, 'cost' | 'breakEvenMove'>, parts: Omit<CostBreakdown, 'totalUsd'>): Offer {
  const totalUsd = parts.interestUsd - parts.yieldUsd + parts.fundingUsd + parts.swapUsd + parts.feeUsd;
  return { ...o, cost: { ...parts, totalUsd }, breakEvenMove: o.exposureUsd > 0 ? totalUsd / o.exposureUsd : 0 };
}

export function kaminoOffer(row: MultiplyRow, i: LeverageInput): Offer | null {
  const u = underlyingOf(row.collateral.symbol);
  if (!u || i.side !== 'long') return null;
  const L = Math.max(1, i.leverage);
  const E = Math.max(0, i.capital);
  const t = Math.max(0, i.days) / 365;
  const max = kaminoMaxOf(row.maxLtv);
  const debtUsd = E * (L - 1);
  const blocked: Blocked | null = L > max + 1e-9 ? { reason: 'leverage', max } : row.availableUsd !== null && row.availableUsd < debtUsd ? { reason: 'liquidity', availableUsd: row.availableUsd } : null;
  const liqRatio = L > 1 ? (L - 1) / (L * row.liqLtv) : 0;
  return finish(
    {
      key: row.key,
      venue: 'kamino',
      asset: u.asset,
      kind: u.kind,
      side: 'long',
      token: row.collateral.symbol,
      tokenIcon: row.collateral.icon,
      debt: row.debt.symbol,
      protocol: 'Kamino',
      protocolIcon: null,
      chain: kaminoChain,
      market: row.market.name,
      fundingPct: null,
      url: row.url,
      leverage: L,
      maxLeverage: max,
      exposureUsd: E * L,
      blocked,
      liqMove: L > 1 ? liqRatio - 1 : null,
      flags: { weekend: u.kind === 'stocks', thinSwap: !u.major && debtUsd >= THIN_SWAP_USD, rateJump: jumps(debtUsd, row.availableUsd), inexact: !u.exact },
    },
    {
      interestUsd: debtUsd * (growth(row.borrowPct, t) - 1),
      yieldUsd: E * L * (growth(row.collateralYieldPct, t) - 1),
      fundingUsd: 0,
      swapUsd: 2 * debtUsd * (Math.max(0, i.swapPct) / 100 + Math.max(0, row.flashFee ?? 0)),
      feeUsd: 0,
    },
  );
}

export function pendleOffer(row: LongShortRow, i: LeverageInput): Offer | null {
  const u = underlyingOf(row.base.symbol, row.category);
  if (!u || row.side !== i.side) return null;
  const L = Math.max(1, i.leverage);
  const E = Math.max(0, i.capital);
  const t = Math.max(0, i.days) / 365;
  const max = loopMaxOf(row);
  const c =row.side === 'long' ? L : 1 + L;
  const d = row.side === 'long' ? L - 1 : L;
  const swapped = E * d;
  const blocked: Blocked | null = L > max + 1e-9 ? { reason: 'leverage', max } : row.liquidityUsd !== null && row.liquidityUsd < swapped ? { reason: 'liquidity', availableUsd: row.liquidityUsd } : null;
  return finish(
    {
      key: row.key,
      venue: 'pendleloop',
      asset: u.asset,
      kind: u.kind,
      side: row.side,
      token: row.base.symbol,
      tokenIcon: null,
      debt: row.side === 'long' ? row.debt.symbol : row.collateral.symbol,
      protocol: row.protocol,
      protocolIcon: row.protocolIcon,
      chain: `eip155:${row.chainId}`,
      market: null,
      fundingPct: null,
      url: row.url,
      leverage: L,
      maxLeverage: max,
      exposureUsd: E * L,
      blocked,
      liqMove: liqRatioOf(row.side, L, row.lltv) - 1,
      flags: { weekend: row.category === 'stocks', thinSwap: !u.major && swapped >= THIN_SWAP_USD, rateJump: jumps(swapped, row.liquidityUsd), inexact: !u.exact },
    },
    {
      interestUsd: E * d * (growth(borrowPctOf(row), t) - 1),
      yieldUsd: E * c * (growth(row.collateralYieldPct, t) - 1),
      fundingUsd: 0,
      swapUsd: 2 * swapped * (Math.max(0, i.swapPct) / 100),
      feeUsd: E * L * row.feeRate,
    },
  );
}

export function perpOffer(ref: PerpRef, asset: string, kind: AssetKind, i: LeverageInput): Offer {
  const L = Math.max(1, i.leverage);
  const E = Math.max(0, i.capital);
  const t = Math.max(0, i.days) / 365;
  const fundingPct = ref.funding7dPct ?? ref.fundingNowPct;
  // What the position earns from funding over the period (a long pays positive funding).
  const earned = E * (growth(perpHoldingPctOf(i.side, L, fundingPct), t) - 1);
  return finish(
    {
      key: `perp:${ref.coin}`,
      venue: 'perp',
      asset,
      kind,
      side: i.side,
      token: ref.coin.replace(/^.*:/, ''),
      tokenIcon: null,
      debt: null,
      protocol: ref.venue,
      protocolIcon: null,
      chain: 'hyperliquid',
      market: null,
      fundingPct,
      url: ref.url,
      leverage: L,
      maxLeverage: ref.maxLeverage,
      exposureUsd: E * L,
      blocked: L > ref.maxLeverage + 1e-9 ? { reason: 'leverage', max: ref.maxLeverage } : null,
      liqMove: perpLiqMoveOf(i.side, L, ref.maxLeverage),
      flags: { weekend: false, thinSwap: false, rateJump: false, inexact: false },
    },
    { interestUsd: 0, yieldUsd: 0, fundingUsd: -earned, swapUsd: 0, feeUsd: 2 * E * L * (Math.max(0, i.perpFeePct) / 100) },
  );
}

export interface AssetGroup {
  asset: string;
  kind: AssetKind;
  /** A logo for the chip: the first token that has one. */
  icon: string | null;
  /** The perp coin, when Hyperliquid lists one. */
  perp: string | null;
  /** Loop markets (Kamino, PendleLoop) per side. */
  loops: Record<Side, number>;
}

/**
 * The underlyings with at least one loop market on this side, majors first, then crypto
 * before stocks, then by number of markets. An asset only a perp offers is left out: there
 * is nothing to compare it with.
 */
export function assetsOf(feed: LeverageFeed, side?: Side): AssetGroup[] {
  const map = new Map<string, AssetGroup>();
  const add = (symbol: string, kind: AssetKind | undefined, icon: string | null, s: Side) => {
    const u = underlyingOf(symbol, kind);
    if (!u) return;
    const g = map.get(u.asset) ?? { asset: u.asset, kind: u.kind, icon: null, perp: u.perp && feed.perps[u.perp] ? u.perp : null, loops: { long: 0, short: 0 } };
    g.loops[s]++;
    g.icon ??= icon;
    map.set(u.asset, g);
  };
  for (const r of feed.kamino) add(r.collateral.symbol, undefined, r.collateral.icon, 'long');
  for (const r of feed.pendle) add(r.base.symbol, r.category, null, r.side);
  const major = ['BTC', 'ETH', 'SOL'];
  const count = (g: AssetGroup) => (side ? g.loops[side] : g.loops.long + g.loops.short);
  return [...map.values()]
    .filter((g) => count(g) > 0)
    .sort((a, b) => {
      const ma = major.indexOf(a.asset);
      const mb = major.indexOf(b.asset);
      if (ma !== mb) return (ma < 0 ? 99 : ma) - (mb < 0 ? 99 : mb);
      if (a.kind !== b.kind) return a.kind === 'crypto' ? -1 : 1;
      return count(b) - count(a) || a.asset.localeCompare(b.asset);
    });
}

/** Every offer for one underlying on the side asked: its loop markets, and the perp when there is one. */
export function offersFor(feed: LeverageFeed, asset: string, i: LeverageInput): Offer[] {
  const out: Offer[] = [];
  let kind: AssetKind | null = null;
  let perp: string | null = null;
  for (const r of feed.kamino) {
    const u = underlyingOf(r.collateral.symbol);
    if (u?.asset !== asset) continue;
    kind = u.kind;
    perp ??= u.perp;
    const o = kaminoOffer(r, i);
    if (o) out.push(o);
  }
  for (const r of feed.pendle) {
    const u = underlyingOf(r.base.symbol, r.category);
    if (u?.asset !== asset) continue;
    kind = u.kind;
    perp ??= u.perp;
    const o = pendleOffer(r, i);
    if (o) out.push(o);
  }
  const ref = perp ? feed.perps[perp] : undefined;
  if (ref && kind) out.push(perpOffer(ref, asset, kind, i));
  return out;
}

export type Verdict =
  /** The starred offers are cheaper than the rest by a margin worth naming. */
  | 'best'
  /** Every usable offer is within a dollar or 0.1 % of the capital of the cheapest: no winner. */
  | 'tie'
  /** The cheapest is a loop whose real cost is not known (a thin swap, or a rate that will jump). */
  | 'uncertain'
  /** Only one usable offer. */
  | 'single'
  /** None usable at this leverage and amount. */
  | 'none';

export interface Ranking {
  /** Usable offers cheapest first, then the blocked ones. */
  offers: Offer[];
  usable: number;
  verdict: Verdict;
  /** The starred offers (verdict «best» only): the cheapest and any within the tie margin of it. */
  best: string[];
}

export const tieUsd = (capital: number) => Math.max(1, capital * 0.001);
export const uncertain = (o: Offer) => o.flags.thinSwap || o.flags.rateJump;

export function rank(offers: Offer[], capital: number): Ranking {
  const byCost = (a: Offer, b: Offer) => a.cost.totalUsd - b.cost.totalUsd;
  const usable = offers.filter((o) => !o.blocked).sort(byCost);
  const blocked = offers.filter((o) => o.blocked).sort(byCost);
  const [first] = usable;
  const near = first ? usable.filter((o) => o.cost.totalUsd - first.cost.totalUsd < tieUsd(capital)) : [];
  const verdict: Verdict = !first ? 'none' : usable.length === 1 ? 'single' : uncertain(first) ? 'uncertain' : near.length === usable.length ? 'tie' : 'best';
  return { offers: [...usable, ...blocked], usable: usable.length, verdict, best: verdict === 'best' ? near.filter((o) => !uncertain(o)).map((o) => o.key) : [] };
}
