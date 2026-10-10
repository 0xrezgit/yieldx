import type { Estimate, Opportunity } from '../../types/opportunity';
import type { Analysis, Evaluated } from '../market/analysis';
import { selectHorizon } from '../market/analysis';
import { tokenClass } from '../merkl/vetting';
import { rateAfterBorrow } from './curve';
import type { HorizonDays } from './policy';
import { periodGrowth } from './rates';

/**
 * «وام با وثیقه»: keep an asset you hold (BTC, ETH …), post it as collateral, borrow
 * dollars against it and put the dollars in the best dollar opportunity. Kept apart from
 * the market ranking — it adds a loan, a second liquidation and often a bridge.
 *
 *   borrowed B = value × LTV
 *   net = result of the dollar opportunity for B (the ranking's own estimate, its own
 *         costs and leverage policy included) − interest on B − bridge (when the two
 *         legs are on different chains)
 *
 * The collateral's price is held constant: the result is dollars earned on top of
 * holding the asset; its price risk stays. The loan can be liquidated when the asset
 * falls `1 − LTV ÷ LLTV`.
 *
 * Borrow rate, three readings (a variable rate is never held at today's figure):
 *   today   the rate after the user's own borrow (the market's curve)
 *   likely  Morpho market above its 90% target: the AdaptiveCurveIRM keeps raising the
 *           rate while it stays full (×e^(50·err·t), t in years — the Arc cirBTC market
 *           went 0.57% → 2.31% in 10 days at ~100%, 1.15× a day, as the formula says);
 *           the rate after `likelyDays` of that, then flat. Else today, or the 7-day
 *           average when higher.
 *   high    the same with `highDays`; a market without that model: likely × `highShare`.
 */
export const COLLATERAL_POLICY = {
  /** LTV on the collateral loan by default (the tweet's 50%: liquidation at a ~42% fall with an 86% LLTV). */
  defaultLtv: 0.5,
  /** Highest LTV offered: past it a normal week's move can liquidate. */
  maxLtv: 0.7,
  /** Bridge cost there and back when the legs are on different chains, USD (USDC via CCTP / Arc Portal). */
  defaultBridgeUsd: 3,
  /** Morpho AdaptiveCurveIRM: adjustment speed per year at full error, and the target utilization. */
  irmSpeed: 50,
  irmTarget: 0.9,
  likelyDays: 3,
  highDays: 7,
  highShare: 1.5,
  /** Funding markets and dollar opportunities paired. */
  fundingKept: 6,
  deployKept: 20,
  pairsKept: 30,
} as const;

const P = COLLATERAL_POLICY;

export type HoldingClass = 'btc' | 'eth' | 'other';

/** BTC- or ETH-like by symbol, wider than the shared list (cirBTC, uniBTC …) — only to group the choices. */
export function holdingClass(symbol: string): HoldingClass {
  const c = tokenClass({ symbol });
  if (c === 'btc' || /btc$/i.test(symbol)) return 'btc';
  if (c === 'eth' || /eth$/i.test(symbol)) return 'eth';
  return 'other';
}

/** A holding: one collateral symbol, or every collateral of a class («any BTC»). */
export type Holding = { kind: 'symbol'; symbol: string } | { kind: 'class'; cls: Exclude<HoldingClass, 'other'> };

export const holdingId = (h: Holding) => (h.kind === 'symbol' ? `s:${h.symbol.toLowerCase()}` : `c:${h.cls}`);

const isDollarLoan = (o: Opportunity) => tokenClass({ symbol: o.assets.deposit[0]?.symbol ?? '' }) === 'usd';

/** Variable-rate dollar loans with collateral (the funding leg); fixed books and loops are not. */
const fundable = (o: Opportunity) => !!o.borrow && o.family !== 'leverage' && !o.book && isDollarLoan(o) && o.borrow.ratePct !== null && o.borrow.collateral.length > 0;

export interface HoldingOption {
  holding: Holding;
  label: string;
  cls: HoldingClass;
  /** Dollar markets that take it. */
  markets: number;
}

/** Every collateral a dollar loan accepts, most markets first, with «any BTC» / «any ETH» on top. */
export function holdingOptions(opps: Opportunity[]): HoldingOption[] {
  const by = new Map<string, { symbol: string; markets: number }>();
  for (const o of opps) {
    if (!fundable(o)) continue;
    for (const c of o.borrow!.collateral) {
      const s = c.token.symbol?.trim();
      if (!s) continue;
      const k = s.toLowerCase();
      by.set(k, { symbol: by.get(k)?.symbol ?? s, markets: (by.get(k)?.markets ?? 0) + 1 });
    }
  }
  const symbols = [...by.values()].map((x) => ({ holding: { kind: 'symbol', symbol: x.symbol } as Holding, label: x.symbol, cls: holdingClass(x.symbol), markets: x.markets }));
  const classes = (['btc', 'eth'] as const)
    .map((cls) => ({ holding: { kind: 'class', cls } as Holding, label: cls === 'btc' ? 'هر نوع BTC' : 'هر نوع ETH', cls, markets: symbols.filter((s) => s.cls === cls).reduce((a, s) => a + s.markets, 0) }))
    .filter((x) => x.markets > 0);
  return [...classes, ...symbols.sort((a, b) => b.markets - a.markets || a.label.localeCompare(b.label))];
}

const accepts = (h: Holding, symbol: string | null) => !!symbol && (h.kind === 'symbol' ? symbol.toLowerCase() === h.symbol.toLowerCase() : holdingClass(symbol) === h.cls);

/** Average of a rate that grows by `rate`·e^(k·t) for `grow` days and then stays, over `days`. */
function adaptedAverage(ratePct: number, perDay: number, grow: number, days: number): number {
  if (!(perDay > 0) || !(days > 0)) return ratePct;
  const g = Math.min(grow, days);
  const growing = (Math.exp(perDay * g) - 1) / perDay; // ∫0^g e^(k t) dt
  const flat = (days - g) * Math.exp(perDay * g);
  return (ratePct * (growing + flat)) / days;
}

export interface RateReadings {
  today: number;
  likely: number;
  high: number;
  /** A full Morpho market whose rate is rising by itself. */
  rising: boolean;
}

/** The three borrow-rate readings for a market after borrowing `amount` (see the header). */
export function borrowReadings(o: Opportunity, ratePct: number, utilization: number | null, days: number): RateReadings {
  const adaptive = o.protocol.id === 'morpho' && utilization !== null && utilization > P.irmTarget;
  if (adaptive) {
    const err = Math.min(1, (utilization - P.irmTarget) / (1 - P.irmTarget));
    const perDay = (P.irmSpeed * err) / 365;
    return { today: ratePct, likely: adaptedAverage(ratePct, perDay, P.likelyDays, days), high: adaptedAverage(ratePct, perDay, P.highDays, days), rising: err > 0.5 };
  }
  const week = o.borrow?.ratePct7d;
  const likely = Math.max(ratePct, typeof week === 'number' && Number.isFinite(week) ? week : ratePct);
  return { today: ratePct, likely, high: likely * P.highShare, rising: false };
}

export interface Funding {
  o: Opportunity;
  /** The collateral this market takes from the holding, and its liquidation limit. */
  collateral: string;
  lltv: number;
  borrowUsd: number;
  rate: RateReadings;
  /** Interest over the period, USD, per reading. */
  cost: { today: number; likely: number; high: number };
  /** Fall of the collateral's price that liquidates the loan, 0…1. */
  liquidationDrop: number;
  availableUsd: number | null;
  notes: string[];
}

export interface CollateralInput {
  holding: Holding;
  valueUsd: number;
  /** LTV taken on the collateral loan, 0…1. */
  ltv: number;
  days: number;
}

const interest = (amount: number, pct: number, days: number) => amount * (periodGrowth({ value: pct, kind: 'apy' }, days) ?? 0);

/** Dollar loans against the holding at this LTV, cheapest likely cost first; markets that cannot lend it are left out. */
export function fundingOptions(opps: Opportunity[], i: CollateralInput): Funding[] {
  const B = i.valueUsd * i.ltv;
  if (!(B > 0)) return [];
  const out: Funding[] = [];
  // A market listed twice by its source (seen with Aave) counts once.
  const seen = new Set<string>();
  for (const o of opps) {
    if (!fundable(o) || seen.has(o.key)) continue;
    seen.add(o.key);
    const side = o.borrow!;
    const c = side.collateral.filter((x) => accepts(i.holding, x.token.symbol) && x.maxLtv > i.ltv).sort((a, b) => b.maxLtv - a.maxLtv)[0];
    if (!c) continue;
    if (side.availableUsd !== null && side.availableUsd < B) continue;
    const r0 = side.ratePct as number;
    const notes: string[] = [];
    let r = r0;
    let u: number | null = null;
    if (side.curve) {
      const after = rateAfterBorrow(side.curve, B, r0);
      if (after === null) continue;
      r = after;
      u = side.curve.suppliedUsd > 0 ? (side.curve.borrowedUsd + B) / side.curve.suppliedUsd : null;
    } else notes.push('اثر وام شما بر نرخ مدل نشده است.');
    if (side.premiumUnknown) notes.push('Aave V4: صرف ریسک کاربر اضافه نشده؛ هزینه می‌تواند بیشتر باشد.');
    const rate = borrowReadings(o, r, u, i.days);
    if (rate.rising) notes.push(`بازار تقریباً پر است (استفاده ${Math.round((u ?? 0) * 100)}٪): مدل نرخ Morpho نرخ را تا وقتی پر بماند خودکار بالا می‌برد.`);
    out.push({
      o,
      collateral: c.token.symbol ?? '—',
      lltv: c.maxLtv,
      borrowUsd: B,
      rate,
      cost: { today: interest(B, rate.today, i.days), likely: interest(B, rate.likely, i.days), high: interest(B, rate.high, i.days) },
      liquidationDrop: Math.max(0, 1 - i.ltv / c.maxLtv),
      availableUsd: side.availableUsd,
      notes,
    });
  }
  return out.sort((a, b) => a.cost.likely - b.cost.likely);
}

export interface Pair {
  key: string;
  funding: Funding;
  deploy: Evaluated;
  estimate: Estimate;
  /** Bridge there and back, USD (0 on the same chain). */
  bridgeUsd: number;
  /** Net dollars over the period: likely (ranked on), low (worst borrow rate, worst deploy reading), high. */
  net: number;
  low: number;
  high: number;
}

/**
 * The best dollar opportunities for the borrowed amount (`analysis` must be built for that
 * capital), each with its best funding market — one row per opportunity; the other lenders
 * stay in the funding list. Best likely net first.
 */
export function collateralPairs(fundings: Funding[], analysis: Analysis, days: HorizonDays, bridgeUsd: number): Pair[] {
  const deploys = selectHorizon(analysis, days).ranking.top.slice(0, P.deployKept);
  const out: Pair[] = [];
  for (const f of fundings.slice(0, P.fundingKept)) {
    for (const e of deploys) {
      const row = analysis.rowByKey.get(e.key);
      if (!row || e.net === null) continue;
      // Lending the borrowed dollars back into the very market that lent them is no strategy.
      if (row.o.key === f.o.key) continue;
      const bridge = row.o.chain !== f.o.chain ? bridgeUsd : 0;
      const lowDeploy = e.range ? Math.min(e.range.low, e.net) : e.net;
      const highDeploy = e.range ? Math.max(e.range.high, e.net) : e.net;
      out.push({
        key: `${f.o.key}→${row.o.key}`,
        funding: f,
        deploy: row,
        estimate: e,
        bridgeUsd: bridge,
        net: e.net - f.cost.likely - bridge,
        low: lowDeploy - f.cost.high - bridge,
        high: highDeploy - f.cost.today - bridge,
      });
    }
  }
  const best = new Map<string, Pair>();
  for (const p of out) if (!best.has(p.deploy.o.key) || best.get(p.deploy.o.key)!.net < p.net) best.set(p.deploy.o.key, p);
  return [...best.values()].sort((a, b) => b.net - a.net).slice(0, P.pairsKept);
}

/** The token the dollar opportunity is entered with: PT, YT and PT loops are bought with USDC. */
export function entryToken(o: Opportunity): string {
  if (o.family === 'pt' || o.family === 'yt' || (o.family === 'leverage' && o.maturity)) return 'USDC';
  return o.assets.deposit[0]?.symbol ?? 'USDC';
}
