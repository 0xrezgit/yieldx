import thresholds from '../../config/thresholds.json';
import type { MarketData } from '../../types/market';
import type { Position } from '../../types/position';
import { DAY_MS } from '../utils/math';
import { buildLedger, EPS, ownCapitalUsd, type Ledger } from './ledger';

/**
 * Values a recorded position against live market data. Everything that is not a
 * recorded fact carries a quality label so the UI never presents an estimate as
 * a measured value:
 *   market   – read from the protocol API recently
 *   stale    – from the API, but older than FRESH_MS (or the API is failing)
 *   manual   – typed in by the user
 *   rule     – follows from the market's rules (PT = 1 asset at maturity, YT = 0)
 *   historical – computed from the protocol's own daily history
 *   estimate – modelled (current rate carried forward, AMM slippage guess…)
 *   missing  – not available
 */
export type Quality = 'market' | 'stale' | 'manual' | 'rule' | 'historical' | 'estimate' | 'missing';

export const FRESH_MS = 15 * 60_000;

/** What the valuation needs from the market (a subset of MarketData, plus history). */
export interface MarketQuote {
  ptPrice: number;
  ytPrice: number;
  /** USD per accounting-asset unit. */
  assetUsd: number | null;
  impliedAPY: number;
  baseAPY: number;
  liquidity: number | null;
  fetchedAt: string;
  /** Daily base APY %, oldest first, ending today; null when the protocol has none. */
  history: number[] | null;
  /** True when the last refresh failed and this is an older copy. */
  failed?: boolean;
}

export const quoteFromMarket = (m: MarketData, history: number[] | null): MarketQuote => ({
  ptPrice: m.ptPrice,
  ytPrice: m.ytPrice,
  assetUsd: m.underlyingPrice,
  impliedAPY: m.impliedAPY,
  baseAPY: m.baseAPY,
  liquidity: m.liquidity,
  fetchedAt: m.fetchedAt,
  history,
});

export interface ExitSettings {
  /** Swap fee + minimum slippage per trade, %. */
  feePct: number;
  /** Network fee for one exit transaction, USD. */
  networkUsd: number;
}

export const defaultExitSettings: ExitSettings = { feePct: thresholds.exit.costPercent, networkUsd: 1 };

export type PositionStatus = 'open' | 'matured' | 'closed';

export interface Valued<T> {
  value: T;
  quality: Quality;
}

export interface LoopHealth {
  collateralUsd: number;
  debtUsd: number;
  /** Collateral market value / equity. */
  leverage: number;
  healthFactor: number;
  /** PT price (asset units) at which the position can be liquidated. */
  liquidationPtPrice: number;
  /** How far the oracle PT price can fall before liquidation, %. */
  dropToLiquidation: number;
  /** Implied APY at which the PT price reaches the liquidation price, %. */
  liquidationAPY: number;
  quality: Quality;
  debtQuality: Quality;
}

export interface Valuation {
  ledger: Ledger;
  status: PositionStatus;
  matured: boolean;
  daysLeft: number;
  daysHeld: number;
  /** Token price in accounting-asset units. */
  tokenPrice: Valued<number>;
  assetUsd: Valued<number>;
  /** Age of the market data, ms (null without data). */
  dataAgeMs: number | null;
  /** Units × price × asset USD — what the tokens are marked at, before any exit cost. */
  markValueUsd: number;
  /** YT: yield accrued since the last claim, USD. */
  unclaimedYield: Valued<number>;
  debtUsd: Valued<number>;
  /** Mark value + unclaimed yield − debt. */
  netValueUsd: number;
  /** What an exit now would roughly pay out after fees, slippage and debt repayment. */
  exit: {
    grossUsd: number;
    costPct: number;
    /** Price-impact share of the cost, % (null when liquidity is unknown). */
    impactPct: number | null;
    networkUsd: number;
    proceedsUsd: number;
    quality: Quality;
    /** Position is a large share of the market's liquidity. */
    illiquid: boolean;
  };
  /** Own capital in = contributions − borrowed cash. */
  investedUsd: number;
  pnlUsd: number;
  pnlPct: number;
  realizedUsd: number;
  unrealizedUsd: number;
  /** Return measured in the accounting asset (null when an event lacks the asset rate). */
  pnlAsset: number | null;
  pnlAssetPct: number | null;
  /** Part of the USD P&L explained by the asset's USD price moving. */
  assetPriceEffectUsd: number | null;
  avgCostUsd: number;
  avgCostAsset: number;
  /** Fixed APY locked at entry (PT/loop), from the price actually paid. */
  entryAPY: number | null;
  /** PT/loop: value if held and redeemed at maturity at today's asset price. */
  redeemValueUsd: number;
  loop: LoopHealth | null;
  /** YT points accumulated (estimate) — never part of P&L. */
  points: number;
}

/** APY implied by a PT price (accepts ≥ 1 → ≤ 0%). */
export const apyFromPT = (pt: number, days: number) =>
  pt > 0 && days > 0 ? (Math.pow(1 / pt, 365 / days) - 1) * 100 : NaN;

function quoteQuality(q: MarketQuote | null, now: number): { quality: Quality; age: number | null } {
  if (!q) return { quality: 'missing', age: null };
  const age = now - new Date(q.fetchedAt).getTime();
  return { quality: q.failed || !(age <= FRESH_MS) ? 'stale' : 'market', age: Number.isFinite(age) ? age : null };
}

/**
 * Yield one YT unit earned over the holding intervals since the last claim. Uses the
 * protocol's daily base-APY history where it covers the days; otherwise the current
 * base APY — then the result is only an estimate.
 */
function accruedYield(L: Ledger, maturityMs: number, q: MarketQuote | null, now: number): Valued<number> {
  if (!L.yieldSince) return { value: 0, quality: 'rule' };
  const since = new Date(L.yieldSince).getTime();
  const end = Math.min(now, maturityMs);
  const hist = q?.history ?? null;
  const current = q?.baseAPY;
  let total = 0;
  let usedEstimate = false;
  let missing = false;

  for (const h of L.holdings) {
    const s = Math.max(h.start, since);
    const e = Math.min(h.end, end);
    if (e <= s) continue;
    // Walk day by day; history[len − 1] is today, history[len − 1 − k] is k days ago.
    for (let t = s; t < e; t += DAY_MS) {
      const dt = Math.min(DAY_MS, e - t);
      const daysAgo = Math.floor((now - t) / DAY_MS);
      let apy: number | undefined;
      if (hist && daysAgo < hist.length) apy = hist[hist.length - 1 - daysAgo];
      if (apy === undefined || !Number.isFinite(apy)) {
        usedEstimate = true;
        apy = current;
      }
      if (apy === undefined || !Number.isFinite(apy)) {
        missing = true;
        continue;
      }
      total += h.units * (Math.pow(1 + apy / 100, dt / DAY_MS / 365) - 1);
    }
  }
  if (missing) return { value: NaN, quality: 'missing' };
  return { value: total, quality: usedEstimate ? 'estimate' : 'historical' };
}

export function valuePosition(p: Position, q: MarketQuote | null, now = Date.now(), exit: ExitSettings = defaultExitSettings): Valuation {
  const maturityMs = new Date(p.maturity).getTime();
  const matured = Number.isFinite(maturityMs) && now >= maturityMs;
  const L = buildLedger(p, now);
  const daysLeft = matured || !Number.isFinite(maturityMs) ? 0 : (maturityMs - now) / DAY_MS;
  const daysHeld = L.firstAt ? Math.max(0, (now - new Date(L.firstAt).getTime()) / DAY_MS) : 0;
  const { quality: qq, age } = quoteQuality(q, now);

  // Token price (asset units).
  const isPT = p.kind !== 'yt';
  let tokenPrice: Valued<number>;
  if (p.manual.tokenPrice) tokenPrice = { value: p.manual.tokenPrice.value, quality: 'manual' };
  else if (matured) tokenPrice = { value: isPT ? 1 : 0, quality: 'rule' };
  else if (q) tokenPrice = { value: isPT ? q.ptPrice : q.ytPrice, quality: qq };
  else tokenPrice = { value: NaN, quality: 'missing' };

  let assetUsd: Valued<number>;
  if (p.manual.assetUsd) assetUsd = { value: p.manual.assetUsd.value, quality: 'manual' };
  else if (q && q.assetUsd !== null && q.assetUsd > 0) assetUsd = { value: q.assetUsd, quality: qq };
  else assetUsd = { value: NaN, quality: 'missing' };

  const A = assetUsd.value;
  const markValueUsd = L.units > EPS ? L.units * tokenPrice.value * A : 0;

  // YT unclaimed yield.
  let unclaimedYield: Valued<number> = { value: 0, quality: 'rule' };
  if (p.kind === 'yt') {
    if (p.manual.unclaimedYield) unclaimedYield = { value: p.manual.unclaimedYield.value * A, quality: 'manual' };
    else {
      const y = accruedYield(L, maturityMs, q, now);
      unclaimedYield = { value: y.value * A, quality: y.quality };
    }
  }

  // Debt.
  let debtUsd: Valued<number> = { value: 0, quality: 'rule' };
  if (p.loop && (L.debtUnits > EPS || p.loop.debtOverride)) {
    const lp = p.loop;
    const debtPrice = lp.debtIsAccountingAsset ? A : lp.debtAssetUsd ?? NaN;
    let units = L.debtUnits;
    let quality: Quality = 'estimate';
    if (lp.debtOverride) {
      const at = new Date(lp.debtOverride.at).getTime();
      units = lp.debtOverride.amount * Math.pow(1 + lp.borrowAPY / 100, Math.max(0, now - at) / DAY_MS / 365);
      quality = 'manual';
    }
    debtUsd = { value: units * debtPrice, quality: Number.isFinite(debtPrice) ? quality : 'missing' };
  }

  const netValueUsd = markValueUsd + (Number.isFinite(unclaimedYield.value) ? unclaimedYield.value : 0) - debtUsd.value;

  // Exit estimate: swap fee + price impact vs liquidity; PT redemption at maturity is free.
  const redeemAtMaturity = matured && isPT;
  const liquidity = q?.liquidity ?? null;
  const impactPct = redeemAtMaturity || L.units <= EPS ? 0 : liquidity && liquidity > 0 ? Math.min(30, (markValueUsd / liquidity) * 50) : null;
  const costPct = redeemAtMaturity || L.units <= EPS ? 0 : exit.feePct + (impactPct ?? 0);
  const networkUsd = L.units > EPS ? exit.networkUsd : 0;
  const unclaimed = Number.isFinite(unclaimedYield.value) ? unclaimedYield.value : 0;
  const proceedsUsd = markValueUsd * (1 - costPct / 100) - networkUsd + unclaimed - debtUsd.value;
  const exitQuality: Quality = !Number.isFinite(proceedsUsd) ? 'missing' : redeemAtMaturity ? tokenPrice.quality === 'manual' ? 'manual' : 'rule' : 'estimate';

  // P&L.
  const investedUsd = ownCapitalUsd(L);
  const pnlUsd = netValueUsd + L.withdrawalsUsd - L.contributionsUsd;
  const pnlPct = investedUsd > EPS ? (pnlUsd / investedUsd) * 100 : NaN;
  const realizedUsd = L.realizedUsd;
  const unrealizedUsd = pnlUsd - realizedUsd;

  const assetFlowsKnown = Number.isFinite(L.contributionsAsset) && Number.isFinite(L.withdrawalsAsset);
  const pnlAsset = assetFlowsKnown && A > 0 ? netValueUsd / A + L.withdrawalsAsset - L.contributionsAsset : null;
  const investedAsset = L.contributionsAsset - L.borrowedAsset;
  const pnlAssetPct = pnlAsset !== null && investedAsset > EPS ? (pnlAsset / investedAsset) * 100 : null;
  const assetPriceEffectUsd = pnlAsset !== null && Number.isFinite(pnlUsd) ? pnlUsd - pnlAsset * A : null;

  // Fixed rate locked at entry: effective PT price paid (asset units) over the days it had left.
  let entryAPY: number | null = null;
  if (isPT && L.boughtUnits > EPS && Number.isFinite(L.boughtCostAsset) && L.firstAt) {
    // Unit-weighted entry time of all buys.
    const buys = p.events.filter((e) => e.type === 'buy' && e.units > 0);
    const w = buys.reduce((s, e) => s + e.units, 0);
    const avgT = w > 0 ? buys.reduce((s, e) => s + e.units * new Date(e.at).getTime(), 0) / w : NaN;
    // For a loop, the price paid includes borrowed cash, so it is still the PT price.
    const paid = L.boughtCostAsset / L.boughtUnits;
    const d = (maturityMs - avgT) / DAY_MS;
    entryAPY = Number.isFinite(apyFromPT(paid, d)) ? apyFromPT(paid, d) : null;
  }

  // Loop health.
  let loop: LoopHealth | null = null;
  if (p.loop && L.units > EPS) {
    const lp = p.loop;
    const oraclePrice = lp.oracle === 'manual' && lp.oraclePtPrice ? lp.oraclePtPrice : tokenPrice.value;
    const collateralOracleUsd = L.units * oraclePrice * A;
    const lltv = lp.lltv / 100;
    const debt = debtUsd.value;
    const healthFactor = debt > EPS ? (collateralOracleUsd * lltv) / debt : Infinity;
    const liquidationPtPrice = debt > EPS && lltv > 0 ? debt / (L.units * lltv * A) : 0;
    const quality: Quality =
      debtUsd.quality === 'missing' || !Number.isFinite(collateralOracleUsd)
        ? 'missing'
        : lp.oracle === 'unknown'
          ? 'estimate'
          : lp.oracle === 'manual'
            ? 'manual'
            : tokenPrice.quality === 'manual' ? 'manual' : 'estimate';
    loop = {
      collateralUsd: markValueUsd,
      debtUsd: debt,
      leverage: markValueUsd - debt > EPS ? markValueUsd / (markValueUsd - debt) : Infinity,
      healthFactor,
      liquidationPtPrice,
      dropToLiquidation: oraclePrice > 0 ? (1 - liquidationPtPrice / oraclePrice) * 100 : NaN,
      liquidationAPY: liquidationPtPrice >= 1 ? -Infinity : liquidationPtPrice <= 0 ? Infinity : apyFromPT(liquidationPtPrice, Math.max(1, daysLeft)),
      quality,
      debtQuality: debtUsd.quality,
    };
  }

  // Points (YT only): exposure × rate × multiplier × days held until maturity.
  let points = 0;
  if (p.kind === 'yt' && p.points.perDay > 0) {
    for (const h of L.holdings) {
      const e = Math.min(h.end, maturityMs);
      if (e <= h.start) continue;
      const exposure = p.points.basis === 'usd' ? h.units * (Number.isFinite(A) ? A : 0) : h.units;
      points += exposure * p.points.perDay * p.points.multiplier * ((e - h.start) / DAY_MS);
    }
  }

  const status: PositionStatus = L.units <= EPS && L.debtUnits <= EPS && L.hasExit ? 'closed' : matured ? 'matured' : 'open';

  return {
    ledger: L,
    status,
    matured,
    daysLeft,
    daysHeld,
    tokenPrice,
    assetUsd,
    dataAgeMs: age,
    markValueUsd,
    unclaimedYield,
    debtUsd,
    netValueUsd,
    exit: {
      grossUsd: markValueUsd,
      costPct,
      impactPct,
      networkUsd,
      proceedsUsd,
      quality: exitQuality,
      illiquid: impactPct !== null && liquidity !== null && markValueUsd / liquidity >= thresholds.liquidity.positionShareWarning,
    },
    investedUsd,
    pnlUsd,
    pnlPct,
    realizedUsd,
    unrealizedUsd,
    pnlAsset,
    pnlAssetPct,
    assetPriceEffectUsd,
    avgCostUsd: L.units > EPS ? L.costUsd / L.units : NaN,
    avgCostAsset: L.units > EPS ? L.costAsset / L.units : NaN,
    entryAPY,
    redeemValueUsd: isPT ? L.units * A : 0,
    loop,
    points,
  };
}
