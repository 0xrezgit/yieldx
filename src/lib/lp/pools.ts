import config from '../../config/lp-pools.json';
import { tokenClass } from '../merkl/vetting';
import { tokenInfo } from '../portfolio/tokens';
import { networkByChainId } from '../registry/networks';
import { revertRef, type RealLpStats, type RevertRef } from './revert';
import { aeroPoolUrl, fullRangeUsd, isAeroVenue, isLegacyVenue, rewardAprPct, weeklyRevenue, type PoolReward } from './rewards';

/**
 * LP pools from vfat's public data API, vetted for the «LP» tool. They never enter
 * the general ranking: an LP's result depends on the price path, so each row only
 * opens the LP analyzer with the pool's own numbers.
 *
 * Kept only when every fact the analyzer needs is known and plausible. Anything
 * missing or doubtful drops the pool — it is counted, never shown half-filled.
 *
 * Fee rate. In a concentrated pool (Uniswap V3/V4, Slipstream…) fees go to the
 * liquidity at the current price, so «fees ÷ pool TVL» is not what any position
 * earns: a full-range dollar earns far less, a narrow range far more. The rate is
 * therefore taken per unit of liquidity — each day's LP fees over that day's
 * average active liquidity (vfat pool history) — and expressed for one dollar
 * placed over the full range. A range position earns that times its
 * concentration (see `concentration` in scenarios). Plain x·y=k pools spread
 * every dollar over the full range, so there «fees ÷ TVL» is the rate.
 *
 * Aero pools (live 2026-10-22) also pay AERO to staked positions (see rewards.ts).
 * They are new and some have no fee history yet: such a pool is kept for its
 * staked AERO rate alone, its fee rate left unknown, while every other rule holds.
 */

export type AssetClass = 'usd' | 'eur' | 'gold' | 'eth' | 'btc' | 'stock';

export interface PoolToken {
  symbol: string;
  address: string;
  cls: AssetClass;
  /** Logo URL; null → the UI draws a monogram. */
  logo: string | null;
}

export interface LpPool {
  /** vfat's stable pool id. */
  id: string;
  chainId: number;
  /** Network key, e.g. "eip155:4663". */
  chain: string;
  /** [A, B]: A is the side that moves, B the price unit (a dollar first, then ETH/BTC, a stock last). */
  tokens: [PoolToken, PoolToken];
  protocol: string;
  concentrated: boolean;
  /** Swap fee of the pool, percent (0.3 = 0.3%); null when not published. */
  feeTierPct: number | null;
  tvlUsd: number;
  volume7dUsd: number;
  fees7dUsd: number;
  /** Yearly fee rate of a full-range position (see the module note); null when the pool is too new to have one (Aero, rewards only). */
  feeAprPct: number | null;
  /** Days of fee history behind `feeAprPct` (7 for x·y=k pools: vfat's 7-day total). */
  feeDays: number;
  /** The same rate over the last week alone (trend hint), when the history has it. */
  feeTrendPct: number | null;
  /** Share of fees an unstaked LP gives up (Aerodrome), already out of `feeAprPct`; 0 elsewhere. */
  unstakedFee: number;
  /** This market's own deposit page (vfat zaps from any token into it). */
  url: string;
  /** The same pool on Revert (automatic range management), when Revert indexes its venue. */
  revert: RevertRef | null;
  /** How the pool's real LPs have done (Revert); null until fetched, or too few positions. */
  realLps?: RealLpStats | null;
  /** Has incentive rewards beyond swap fees (not included in feeAprPct). */
  incentives: boolean;
  /** AERO for a staked position (Aero gauge), when its rate is known. */
  reward: PoolReward | null;
  /** Aerodrome / Velodrome pool with a gauge: it pays no AERO since the Aero launch, and staked liquidity earns no fees either. */
  legacyGauge: boolean;
  /** The venue's own page for the pool (Aero), when known. */
  venueUrl: string | null;
  /** Both sides are dollar stablecoins. */
  stable: boolean;
  /** 95th-percentile 7-day move of A against B (percent, both positive). */
  move7d: { down: number; up: number };
  /** Realised volatility of A against B, annualised (percent; vfat, 30 days of 4-hour returns). */
  volAnnualPct: number;
  ageDays: number;
}

export type RejectReason = 'asset' | 'price' | 'tvl' | 'age' | 'fees' | 'history' | 'outlier' | 'volatility' | 'inactive';

export interface LpPoolFeed {
  pools: LpPool[];
  /** How many pools each rule dropped (shown so the list never looks complete when it is not). */
  rejected: Record<RejectReason, number>;
  /** Pools whose history is still being fetched: not shown yet, and not counted as rejected. */
  pending: number;
  /** Shown pools whose real-LP figures (Revert) are still being fetched. */
  realPending: number;
  sources: { id: 'focus' | 'global' | 'aero'; ok: boolean }[];
  fetchedAt: string;
}

// ─── vfat response (only the fields read) ───────────────────────────────────

interface RawToken {
  address?: string;
  symbol?: string;
  decimals?: number;
  price?: number | null;
}
interface RawReward {
  type?: string;
  token?: { symbol?: string };
  amountUsd?: number | null;
}
interface RawOption {
  id?: string;
  kind?: string;
  isKilled?: boolean;
  type?: string;
  totalLiquidity?: number | null;
  feesUsd7d?: number | null;
  weeklyRewards?: RawReward[];
  protocol?: { id?: string; name?: string };
}
export interface RawItem {
  id?: string;
  chainId?: number;
  isWhitelisted?: boolean;
  firstSeenAt?: string | null;
  pool?: {
    address?: string;
    poolId?: string | null;
    type?: string;
    underlying?: RawToken[];
    createdAt?: string | null;
    currentFee?: number | null;
    volumeUsd7d?: number | null;
    /** Current price, Q64.96 (concentrated pools). */
    sqrtPrice?: string | null;
    assetCorrelation?: RawRangeRisk | null;
  };
  options?: RawOption[];
}

/**
 * The pair's price behaviour, measured by vfat over 30 days of 4-hour returns. Until
 * 2026-10 it came with the list (`pool.assetCorrelation`); vfat now sends only the
 * correlation there and the full block — 7-day move percentiles and realized volatility —
 * with each pool's history (`currentRangeRisk`). Both places are read.
 */
export interface RawRangeRisk {
  baseTokenAddress?: string;
  relativeRealizedVolatilityAnnualizedPercent?: number | null;
  relativePriceMovePercentiles?: { horizonHours?: number; p95DownMovePercent?: number; p95UpMovePercent?: number }[];
}

/**
 * What a concentrated pool's fee rate needs beyond vfat's list: its daily history,
 * for Aerodrome Slipstream and Aero the share of an unstaked LP's fees the pool keeps
 * (`unstakedFee()`, read on-chain; 0.05 = 5%), and for an Aero gauge the staked
 * liquidity in range (`stakedLiquidity()`, raw units, decimal string).
 */
export interface PoolFeeData {
  history: RawHistory | null;
  unstakedFee?: number | null;
  stakedLiquidity?: string | null;
}

/** vfat protocol ids whose concentrated pools charge unstaked LPs (Aerodrome Slipstream, Aero). */
export const UNSTAKED_FEE_VENUES = new Set(['aerodrome', 'aero']);

/** vfat `/v4/pool-history` (daily buckets; only the fields read). */
export interface RawHistory {
  token0?: { address?: string; decimals?: number };
  token1?: { address?: string; decimals?: number };
  points?: {
    timestamp?: string;
    volumeUsd?: number | null;
    feePercent?: number | null;
    protocolFeesUsd?: number | null;
    averageLiquidity?: string | number | null;
    closePriceToken1PerToken0?: number | null;
  }[];
  /** The pair's measured price moves (see `RawRangeRisk`). */
  currentRangeRisk?: RawRangeRisk | null;
}

const CFG = config.vfat;
const STOCKS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(config.stockTokens)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([chain, list]) => [chain, new Set(Object.values(list as Record<string, string>).map((a) => a.toLowerCase()))]),
);

const DAY = 86_400_000;
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Euro stablecoins and tokenized gold: priced against the median of their own kind. */
const EUR_LIKE = /^(eurc|eure|eura|eurcv|eurs|ageur|eurr|eurq|eurau)$/i;
const GOLD_LIKE = /^(xaut|xaut0|xaum|paxg)$/i;

export const emptyRejected = (): Record<RejectReason, number> => ({ asset: 0, price: 0, tvl: 0, age: 0, fees: 0, history: 0, outlier: 0, volatility: 0, inactive: 0 });

/** Fewer days than this in the last week → no reliable fee rate. */
export const MIN_HISTORY_DAYS = 14;
/** Days of history the fee rate averages over (one month: busy weeks and weekends both in). */
export const FEE_WINDOW_DAYS = 30;
/** The last week, shown beside the month as a trend (never used for the rate). */
const TREND_DAYS = 7;

/** The ticker of a tokenized stock: Coinbase's carry a trailing «c» (NVDAc). */
export const stockTicker = (symbol: string) => (/^[A-Z.]+c$/.test(symbol) ? symbol.slice(0, -1) : symbol.toUpperCase());

/** Stocks: the ticker's logo; everything else: the app's token list (majors and stablecoins). */
export const logoOf = (symbol: string, cls: AssetClass): string | null => (cls === 'stock' ? `${config.stockLogo}${encodeURIComponent(stockTicker(symbol))}.png` : (tokenInfo(symbol)?.logo ?? null));

/** Tokenized stocks by address only — a token reusing a stock's symbol is not one. */
export const isStockToken = (chainId: number, address: string) => STOCKS[String(chainId)]?.has(address.toLowerCase()) ?? false;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Reference prices, USD; euro and gold are optional (a response without them has none). */
export interface RefPrices {
  eth: number | null;
  btc: number | null;
  eur?: number | null;
  gold?: number | null;
}

/** ETH, BTC, euro and gold reference prices: the median over every pool in the response. */
export function referencePrices(items: RawItem[]): Required<RefPrices> {
  const eth: number[] = [];
  const btc: number[] = [];
  const eur: number[] = [];
  const gold: number[] = [];
  for (const it of items)
    for (const t of it.pool?.underlying ?? []) {
      const p = num(t.price);
      if (p === null || !t.symbol) continue;
      const s = t.symbol.trim().toLowerCase();
      if (s === 'eth' || s === 'weth') eth.push(p);
      if (s === 'wbtc' || s === 'cbbtc' || s === 'btc') btc.push(p);
      if (EUR_LIKE.test(s)) eur.push(p);
      if (GOLD_LIKE.test(s)) gold.push(p);
    }
  return { eth: median(eth), btc: median(btc), eur: median(eur), gold: median(gold) };
}

/** The side used as the price unit (B): a dollar first, then the euro, then gold/ETH/BTC, a stock last. */
const UNIT_RANK: Record<AssetClass, number> = { usd: 0, eur: 1, gold: 2, eth: 2, btc: 2, stock: 3 };

/**
 * A's move from the measured move of the base token against the quote token. When
 * A is the quote token the move inverts: base +u% is A −u/(1+u), base −d% is A +d/(1−d).
 */
export function orientMove(m: { down: number; up: number }, aIsBase: boolean): { down: number; up: number } {
  if (aIsBase) return m;
  const d = Math.min(99, m.down) / 100;
  const u = m.up / 100;
  return { down: (u / (1 + u)) * 100, up: (d / (1 - d)) * 100 };
}

/** A token's class, or why it is not accepted. Price must fit the class (a fake "USDC" at $0.40 is not a dollar). */
function classify(t: RawToken, chainId: number, ref: RefPrices): AssetClass | 'asset' | 'price' {
  if (!t.address || !t.symbol) return 'asset';
  if (isStockToken(chainId, t.address)) return 'stock';
  const sym = t.symbol.trim();
  if (EUR_LIKE.test(sym) || GOLD_LIKE.test(sym)) {
    const p = num(t.price);
    if (p === null) return 'price';
    const eur = EUR_LIKE.test(sym);
    // The kind's own median, itself within a sane band (a euro is $0.8–1.6, an ounce $1,000–20,000).
    const r = (eur ? ref.eur : ref.gold) ?? null;
    const [lo, hi, band] = eur ? [0.8, 1.6, 0.03] : [1000, 20_000, 0.05];
    if (r === null || r < lo || r > hi) return 'price';
    return Math.abs(p / r - 1) <= band ? (eur ? 'eur' : 'gold') : 'price';
  }
  const cls = tokenClass({ symbol: sym });
  if (cls === 'other') return 'asset';
  const p = num(t.price);
  if (p === null) return 'price';
  if (cls === 'usd') return p >= 0.97 && p <= 1.03 ? 'usd' : 'price';
  const r = cls === 'eth' ? ref.eth : ref.btc;
  // Liquid-staking tokens trade a little above the base asset (same band as the Merkl check).
  return r !== null && p >= r * 0.6 && p <= r * 1.5 ? cls : 'price';
}

/**
 * Full-range fee rate (yearly %) from daily history: LP fees per unit of active
 * liquidity, averaged over the last FEE_WINDOW_DAYS, times the liquidity one dollar
 * buys over the full range. Fees and liquidity come from the same days, so a busy
 * week and a quiet weekend are both in. Null when fewer than MIN_HISTORY_DAYS
 * usable days or a token price is missing. `trendPct`: the same rate over the last
 * week alone (a hint, never the rate).
 */
export function fullRangeAprFromHistory(h: RawHistory, usdPrice: (address: string) => number | null): { aprPct: number; days: number; trendPct: number | null } | null {
  const d0 = num(h.token0?.decimals);
  const d1 = num(h.token1?.decimals);
  const p1 = h.token1?.address ? usdPrice(h.token1.address) : null;
  if (d0 === null || d1 === null || p1 === null || !(p1 > 0)) return null;
  const daily: number[] = [];
  let price: number | null = null;
  for (const p of (h.points ?? []).slice(-FEE_WINDOW_DAYS)) {
    const vol = num(p.volumeUsd);
    const fee = num(p.feePercent);
    const L = Number(p.averageLiquidity);
    if (vol === null || fee === null || !(L > 0) || vol < 0 || fee < 0) continue;
    const lpFees = Math.max(0, vol * (fee / 100) - (num(p.protocolFeesUsd) ?? 0));
    daily.push(lpFees / L);
    price = num(p.closePriceToken1PerToken0) ?? price;
  }
  if (daily.length < MIN_HISTORY_DAYS || price === null || !(price > 0)) return null;
  // Full range holds value 2·L·√P (token1 base units): liquidity per dollar.
  const sqrtRaw = Math.sqrt(price * 10 ** d1 / 10 ** d0);
  const yearly = (perL: number[]) => (perL.reduce((a, b) => a + b, 0) / perL.length) * 365 * (10 ** d1 / (2 * sqrtRaw * p1)) * 100;
  const week = daily.slice(-TREND_DAYS);
  return { aprPct: yearly(daily), days: daily.length, trendPct: week.length === TREND_DAYS ? yearly(week) : null };
}

/** vfat's deposit page for one option (the unstaked LP: it is the one that earns the swap fees). */
export const farmUrl = (optionId: string) => `https://vfat.io/farm?farmId=${encodeURIComponent(optionId)}`;

/** Rewards beyond swap fees an option pays per week, USD. */
const weeklyRewardUsd = (o: RawOption) => (o.weeklyRewards ?? []).reduce((a, r) => a + (r.type !== 'swap-fee' ? Math.max(0, num(r.amountUsd) ?? 0) : 0), 0);

/** The Aero gauge of a pool that pays rewards now (the staked LP), if any. */
const aeroStake = (it: RawItem): RawOption | null =>
  (it.options ?? []).find((o) => o.kind === 'lp-stake' && !o.isKilled && !!o.id && isAeroVenue(o.protocol?.id) && weeklyRewardUsd(o) > 0) ?? null;

/**
 * A staked position's AERO (see rewards.ts). Concentrated: the staked in-range
 * liquidity read on-chain, valued at the pool's current price as full-range dollars;
 * plain: the gauge's staked TVL. Null while either is unknown.
 */
function poolReward(it: RawItem, stake: RawOption, concentrated: boolean, data: PoolFeeData | null | undefined): PoolReward | null {
  const weeklyUsd = weeklyRewardUsd(stake);
  let staked: number | null = null;
  if (concentrated) {
    const L = Number(data?.stakedLiquidity);
    const sqrtX96 = Number(it.pool?.sqrtPrice);
    // token1 is the higher address (Uniswap v3 order), the unit of the pool's price.
    const t1 = [...(it.pool?.underlying ?? [])].sort((x, y) => ((x.address ?? '').toLowerCase() < (y.address ?? '').toLowerCase() ? -1 : 1))[1];
    const d1 = num(t1?.decimals);
    const p1 = num(t1?.price);
    if (L > 0 && sqrtX96 > 0 && d1 !== null && p1 !== null && p1 > 0) staked = fullRangeUsd(L, sqrtX96, d1, p1);
  } else {
    staked = num(stake.totalLiquidity);
  }
  if (staked === null || !(staked > 0)) return null;
  const rev = data?.history?.points ? weeklyRevenue(data.history.points) : null;
  const tokens = [...new Set((stake.weeklyRewards ?? []).filter((r) => r.type !== 'swap-fee' && (num(r.amountUsd) ?? 0) > 0).map((r) => r.token?.symbol?.trim()).filter(Boolean))];
  return {
    token: tokens.join(' + ') || 'AERO',
    weeklyUsd,
    aprPct: rewardAprPct(weeklyUsd, staked),
    stakedFullRangeUsd: staked,
    revenueWeeklyUsd: rev?.usd ?? null,
    revenueDays: rev?.days ?? 0,
    url: farmUrl(stake.id as string),
  };
}

/**
 * One vfat pool → a vetted row, or the first rule it fails. Concentrated pools need
 * their fee data. An Aero pool paying AERO may be younger than a week and have no
 * fee rate yet: it is kept for its staked rate alone.
 */
export function vetPool(it: RawItem, ref: RefPrices, now: number, data?: PoolFeeData | null): LpPool | RejectReason {
  const chainId = num(it.chainId);
  const under = it.pool?.underlying ?? [];
  if (!it.id || chainId === null || under.length !== 2 || it.isWhitelisted === false) return 'asset';

  const classes = under.map((t) => classify(t, chainId, ref));
  const bad = classes.find((c) => c === 'asset' || c === 'price');
  if (bad) return bad as RejectReason;
  // Any pair of known classes is kept; a memecoin or unknown token on either side never is.
  // Order as A (moves) / B (unit).
  const [ia, ib] = UNIT_RANK[classes[0] as AssetClass] < UNIT_RANK[classes[1] as AssetClass] ? [1, 0] : [0, 1];
  const [a, b] = [classes[ia] as AssetClass, classes[ib] as AssetClass];
  const [ta, tb] = [under[ia], under[ib]];

  const opt = (it.options ?? []).find((o) => o.kind === 'lp' && !o.isKilled) ?? null;
  if (!opt || !opt.id) return 'inactive';
  const tvl = num(opt.totalLiquidity);
  if (tvl === null || tvl < CFG.minTvlUsd) return 'tvl';
  const stake = aeroStake(it);

  const born = Date.parse(it.pool?.createdAt ?? it.firstSeenAt ?? '');
  if (!Number.isFinite(born)) return 'age';
  const ageDays = (now - born) / DAY;
  if (ageDays < CFG.minAgeDays && !stake) return 'age';

  const fees = num(opt.feesUsd7d);
  if ((fees === null || fees <= 0) && !stake) return 'fees';

  // Without a measured price swing there is no loss estimate, so no dollar figure: dropped.
  // The full measurement now comes with the pool's history; the list keeps only part of it.
  const p168 = (r: RawRangeRisk | null | undefined) => r?.relativePriceMovePercentiles?.find((x) => x.horizonHours === 168);
  const fromHistory = data?.history?.currentRangeRisk;
  const risk = p168(fromHistory) ? fromHistory : p168(it.pool?.assetCorrelation) ? it.pool?.assetCorrelation : null;
  // History not fetched yet, or not received (vfat rate-limits): the history decides — counted
  // as missing history and asked again, never as a volatile pair.
  if (!risk) return !data?.history ? 'history' : 'volatility';
  const p95 = p168(risk);
  const down = num(p95?.p95DownMovePercent);
  const up = num(p95?.p95UpMovePercent);
  const base = risk.baseTokenAddress?.toLowerCase();
  const vol = num(risk.relativeRealizedVolatilityAnnualizedPercent);
  if (down === null || up === null || down < 0 || up < 0 || !base || vol === null || vol < 0) return 'volatility';
  const aIsBase = base === ta.address?.toLowerCase();
  if (!aIsBase && base !== tb.address?.toLowerCase()) return 'volatility';

  const concentrated = it.pool?.type === 'concentrated';
  let feeAprPct: number | null;
  let feeDays = 7;
  let feeTrendPct: number | null = null;
  let unstakedFee = 0;
  if (concentrated) {
    // The history (and, on Aero, the staked liquidity read with it) is needed either way.
    if (!data?.history) return 'history';
    const prices = new Map(under.map((t) => [(t.address as string).toLowerCase(), num(t.price)]));
    const r = fullRangeAprFromHistory(data.history, (addr) => prices.get(addr.toLowerCase()) ?? null);
    // Aerodrome and Aero keep a share of an unstaked LP's fees; without that share the rate would be too high.
    let cut: number | null = 0;
    if (opt.protocol?.id && UNSTAKED_FEE_VENUES.has(opt.protocol.id)) {
      const c = num(data.unstakedFee);
      cut = c !== null && c >= 0 && c < 1 ? c : null;
    }
    // Known even without a fee rate: an Aero pool's unstaked mode is described with it.
    if (cut !== null) unstakedFee = cut;
    if (!r || cut === null) {
      if (!stake) return 'history';
      feeAprPct = null;
    } else {
      feeAprPct = r.aprPct * (1 - cut);
      feeTrendPct = r.trendPct === null ? null : r.trendPct * (1 - cut);
      feeDays = r.days;
    }
  } else {
    feeAprPct = fees !== null && fees > 0 ? (fees / tvl) * (365 / 7) * 100 : null;
  }
  const reward = stake ? poolReward(it, stake, concentrated, data) : null;
  if (feeAprPct === null && !reward) return stake && concentrated ? 'history' : 'fees';
  if (feeAprPct !== null && (!Number.isFinite(feeAprPct) || feeAprPct <= 0)) {
    if (!reward) return 'fees';
    feeAprPct = null;
  }
  if ((feeAprPct ?? 0) > CFG.maxFeeAprPct || (reward?.aprPct ?? 0) > CFG.maxFeeAprPct || (reward && !Number.isFinite(reward.aprPct))) return 'outlier';
  const fee = num(it.pool?.currentFee);
  const legacyGauge = isLegacyVenue(opt.protocol?.id) && (it.options ?? []).some((o) => o.kind === 'lp-stake');

  return {
    id: it.id,
    chainId,
    chain: networkByChainId(chainId).key,
    tokens: [
      { symbol: ta.symbol as string, address: (ta.address as string).toLowerCase(), cls: a, logo: logoOf(ta.symbol as string, a) },
      { symbol: tb.symbol as string, address: (tb.address as string).toLowerCase(), cls: b, logo: logoOf(tb.symbol as string, b) },
    ],
    protocol: opt.protocol?.name?.trim() || 'vfat',
    concentrated,
    // vfat publishes the fee in hundredths of a basis point (3000 = 0.3%).
    feeTierPct: fee !== null && fee >= 0 ? fee / 10_000 : null,
    tvlUsd: tvl,
    volume7dUsd: num(it.pool?.volumeUsd7d) ?? 0,
    fees7dUsd: fees ?? 0,
    feeAprPct,
    feeDays,
    feeTrendPct,
    unstakedFee,
    url: farmUrl(opt.id),
    revert: revertRef(chainId, opt.protocol?.id, it.pool?.address, it.pool?.poolId),
    incentives: (it.options ?? []).some((o) => (o.weeklyRewards ?? []).some((r) => r.type !== 'swap-fee' && (num(r.amountUsd) ?? 0) > 0)),
    reward,
    legacyGauge,
    venueUrl: isAeroVenue(opt.protocol?.id) && it.pool?.address ? aeroPoolUrl(chainId, it.pool.address.toLowerCase()) : null,
    stable: a === 'usd' && b === 'usd',
    move7d: orientMove({ down, up }, aIsBase),
    volAnnualPct: vol,
    ageDays,
  };
}

/** Pools that pass every rule needing no history, deduplicated: the ones worth a history request (fee rate, price moves). */
export function historyCandidates(items: RawItem[], now: number): RawItem[] {
  const ref = referencePrices(items);
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.id || seen.has(it.id)) return false;
    seen.add(it.id);
    return vetPool(it, ref, now) === 'history';
  });
}

/** Vets every pool, one row per id (the focus and global lists overlap), highest fee rate first. */
export function vetPools(items: RawItem[], now: number, feeData: Map<string, PoolFeeData | null> = new Map()): { pools: LpPool[]; rejected: Record<RejectReason, number> } {
  const ref = referencePrices(items);
  const rejected = emptyRejected();
  const byId = new Map<string, LpPool>();
  const seen = new Set<string>();
  for (const it of items) {
    if (it.id && seen.has(it.id)) continue;
    if (it.id) seen.add(it.id);
    const r = vetPool(it, ref, now, it.id ? feeData.get(it.id) : undefined);
    if (typeof r === 'string') rejected[r]++;
    else byId.set(r.id, r);
  }
  return { pools: [...byId.values()].sort((x, y) => (y.feeAprPct ?? 0) - (x.feeAprPct ?? 0) || (x.id < y.id ? -1 : 1)), rejected };
}
