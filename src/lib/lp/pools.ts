import config from '../../config/lp-pools.json';
import { tokenClass } from '../merkl/vetting';
import { tokenInfo } from '../portfolio/tokens';
import { networkByChainId } from '../registry/networks';
import { revertRef, type RealLpStats, type RevertRef } from './revert';

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
 */

export type AssetClass = 'usd' | 'eth' | 'btc' | 'stock';

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
  /** Yearly fee rate of a full-range position, from the last 7 days (see the module note). */
  feeAprPct: number;
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
  sources: { id: 'focus' | 'global'; ok: boolean }[];
  fetchedAt: string;
}

// ─── vfat response (only the fields read) ───────────────────────────────────

interface RawToken {
  address?: string;
  symbol?: string;
  price?: number | null;
}
interface RawReward {
  type?: string;
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
    assetCorrelation?: { baseTokenAddress?: string; relativeRealizedVolatilityAnnualizedPercent?: number | null; relativePriceMovePercentiles?: { horizonHours?: number; p95DownMovePercent?: number; p95UpMovePercent?: number }[] } | null;
  };
  options?: RawOption[];
}

/**
 * What a concentrated pool's fee rate needs beyond vfat's list: its daily history,
 * and for Aerodrome Slipstream the share of an unstaked LP's fees the pool keeps
 * (`unstakedFee()`, read on-chain; 0.05 = 5%).
 */
export interface PoolFeeData {
  history: RawHistory | null;
  unstakedFee?: number | null;
}

/** vfat protocol ids whose concentrated pools charge unstaked LPs (Aerodrome Slipstream). */
export const UNSTAKED_FEE_VENUES = new Set(['aerodrome']);

/** vfat `/v4/pool-history` (daily buckets; only the fields read). */
export interface RawHistory {
  token0?: { address?: string; decimals?: number };
  token1?: { address?: string; decimals?: number };
  points?: {
    volumeUsd?: number | null;
    feePercent?: number | null;
    protocolFeesUsd?: number | null;
    averageLiquidity?: string | number | null;
    closePriceToken1PerToken0?: number | null;
  }[];
}

const CFG = config.vfat;
const STOCKS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(config.stockTokens)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([chain, list]) => [chain, new Set(Object.values(list as Record<string, string>).map((a) => a.toLowerCase()))]),
);

const DAY = 86_400_000;
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export const emptyRejected = (): Record<RejectReason, number> => ({ asset: 0, price: 0, tvl: 0, age: 0, fees: 0, history: 0, outlier: 0, volatility: 0, inactive: 0 });

/** Fewer days than this in the last week → no reliable fee rate. */
export const MIN_HISTORY_DAYS = 14;
/** Days of history the fee rate averages over (one month: busy weeks and weekends both in). */
export const FEE_WINDOW_DAYS = 30;
/** The last week, shown beside the month as a trend (never used for the rate). */
const TREND_DAYS = 7;

/** Stocks: the ticker's logo; everything else: the app's token list (majors and stablecoins). */
export const logoOf = (symbol: string, cls: AssetClass): string | null => (cls === 'stock' ? `${config.stockLogo}${encodeURIComponent(symbol.toUpperCase())}.png` : (tokenInfo(symbol)?.logo ?? null));

/** Tokenized stocks by address only — a token reusing a stock's symbol is not one. */
export const isStockToken = (chainId: number, address: string) => STOCKS[String(chainId)]?.has(address.toLowerCase()) ?? false;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** ETH and BTC reference prices: the median over every pool in the response. */
export function referencePrices(items: RawItem[]): { eth: number | null; btc: number | null } {
  const eth: number[] = [];
  const btc: number[] = [];
  for (const it of items)
    for (const t of it.pool?.underlying ?? []) {
      const p = num(t.price);
      if (p === null || !t.symbol) continue;
      const s = t.symbol.trim().toLowerCase();
      if (s === 'eth' || s === 'weth') eth.push(p);
      if (s === 'wbtc' || s === 'cbbtc' || s === 'btc') btc.push(p);
    }
  return { eth: median(eth), btc: median(btc) };
}

/** The side used as the price unit (B): a dollar first, then ETH/BTC, a stock last. */
const UNIT_RANK: Record<AssetClass, number> = { usd: 0, eth: 1, btc: 1, stock: 2 };

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
function classify(t: RawToken, chainId: number, ref: { eth: number | null; btc: number | null }): AssetClass | 'asset' | 'price' {
  if (!t.address || !t.symbol) return 'asset';
  if (isStockToken(chainId, t.address)) return 'stock';
  const cls = tokenClass({ symbol: t.symbol });
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

/** One vfat pool → a vetted row, or the first rule it fails. Concentrated pools need their fee data. */
export function vetPool(it: RawItem, ref: { eth: number | null; btc: number | null }, now: number, data?: PoolFeeData | null): LpPool | RejectReason {
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

  const born = Date.parse(it.pool?.createdAt ?? it.firstSeenAt ?? '');
  if (!Number.isFinite(born)) return 'age';
  const ageDays = (now - born) / DAY;
  if (ageDays < CFG.minAgeDays) return 'age';

  const fees = num(opt.feesUsd7d);
  if (fees === null || fees <= 0) return 'fees';

  // Without a measured price swing there is no loss estimate, so no dollar figure: dropped.
  const p95 = it.pool?.assetCorrelation?.relativePriceMovePercentiles?.find((x) => x.horizonHours === 168);
  const down = num(p95?.p95DownMovePercent);
  const up = num(p95?.p95UpMovePercent);
  const base = it.pool?.assetCorrelation?.baseTokenAddress?.toLowerCase();
  const vol = num(it.pool?.assetCorrelation?.relativeRealizedVolatilityAnnualizedPercent);
  if (down === null || up === null || down < 0 || up < 0 || !base || vol === null || vol < 0) return 'volatility';
  const aIsBase = base === ta.address?.toLowerCase();
  if (!aIsBase && base !== tb.address?.toLowerCase()) return 'volatility';

  const concentrated = it.pool?.type === 'concentrated';
  let feeAprPct: number;
  let feeDays = 7;
  let feeTrendPct: number | null = null;
  let unstakedFee = 0;
  if (concentrated) {
    const prices = new Map(under.map((t) => [(t.address as string).toLowerCase(), num(t.price)]));
    const r = data?.history ? fullRangeAprFromHistory(data.history, (addr) => prices.get(addr.toLowerCase()) ?? null) : null;
    if (!r) return 'history';
    // Aerodrome keeps a share of an unstaked LP's fees; without that share the rate would be too high.
    if (opt.protocol?.id && UNSTAKED_FEE_VENUES.has(opt.protocol.id)) {
      const cut = num(data?.unstakedFee);
      if (cut === null || cut < 0 || cut >= 1) return 'history';
      unstakedFee = cut;
    }
    feeAprPct = r.aprPct * (1 - unstakedFee);
    feeTrendPct = r.trendPct === null ? null : r.trendPct * (1 - unstakedFee);
    feeDays = r.days;
  } else {
    feeAprPct = (fees / tvl) * (365 / 7) * 100;
  }
  if (!Number.isFinite(feeAprPct) || feeAprPct <= 0) return 'fees';
  if (feeAprPct > CFG.maxFeeAprPct) return 'outlier';
  const fee = num(it.pool?.currentFee);

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
    fees7dUsd: fees,
    feeAprPct,
    feeDays,
    feeTrendPct,
    unstakedFee,
    url: farmUrl(opt.id),
    revert: revertRef(chainId, opt.protocol?.id, it.pool?.address, it.pool?.poolId),
    incentives: (it.options ?? []).some((o) => (o.weeklyRewards ?? []).some((r) => r.type !== 'swap-fee' && (num(r.amountUsd) ?? 0) > 0)),
    stable: a === 'usd' && b === 'usd',
    move7d: orientMove({ down, up }, aIsBase),
    volAnnualPct: vol,
    ageDays,
  };
}

/** Pools that pass every rule needing no fee data, deduplicated: the ones worth a fee-data request. */
export function historyCandidates(items: RawItem[], now: number): RawItem[] {
  const ref = referencePrices(items);
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.id || seen.has(it.id) || it.pool?.type !== 'concentrated') return false;
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
  return { pools: [...byId.values()].sort((x, y) => y.feeAprPct - x.feeAprPct || (x.id < y.id ? -1 : 1)), rejected };
}
