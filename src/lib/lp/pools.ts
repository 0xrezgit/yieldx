import config from '../../config/lp-pools.json';
import { tokenClass } from '../merkl/vetting';
import { networkByChainId } from '../registry/networks';

/**
 * LP pools from vfat's public data API, vetted for the «LP» tool. They never enter
 * the general ranking: an LP's result depends on the price path, so each row only
 * opens the LP analyzer with the pool's own numbers.
 *
 * Kept only when every fact the analyzer needs is known and plausible. Anything
 * missing or doubtful drops the pool — it is counted, never shown half-filled.
 */

export type AssetClass = 'usd' | 'eth' | 'btc' | 'stock';

export interface PoolToken {
  symbol: string;
  address: string;
  cls: AssetClass;
}

export interface LpPool {
  /** vfat's stable pool id. */
  id: string;
  chainId: number;
  /** Network key, e.g. "eip155:4663". */
  chain: string;
  tokens: [PoolToken, PoolToken];
  protocol: string;
  concentrated: boolean;
  /** Swap fee of the pool, percent (0.3 = 0.3%); null when not published. */
  feeTierPct: number | null;
  tvlUsd: number;
  volume7dUsd: number;
  fees7dUsd: number;
  /**
   * Realised swap fees of the last 7 days over the whole pool's liquidity, as a
   * simple yearly rate. A narrow range earns more while in range; this is the
   * conservative pool average the analyzer asks for.
   */
  feeAprPct: number;
  /** Has incentive rewards beyond swap fees (not included in feeAprPct). */
  incentives: boolean;
  /** Both sides are dollar stablecoins. */
  stable: boolean;
  /** 95th-percentile 7-day relative price move (percent), when vfat measured it. */
  move7d: { down: number; up: number } | null;
  ageDays: number;
}

export type RejectReason = 'asset' | 'price' | 'tvl' | 'age' | 'fees' | 'outlier' | 'inactive';

export interface LpPoolFeed {
  pools: LpPool[];
  /** How many pools each rule dropped (shown so the list never looks complete when it is not). */
  rejected: Record<RejectReason, number>;
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
  kind?: string;
  isKilled?: boolean;
  totalLiquidity?: number | null;
  feesUsd7d?: number | null;
  weeklyRewards?: RawReward[];
  protocol?: { name?: string };
}
export interface RawItem {
  id?: string;
  chainId?: number;
  isWhitelisted?: boolean;
  firstSeenAt?: string | null;
  pool?: {
    type?: string;
    underlying?: RawToken[];
    createdAt?: string | null;
    currentFee?: number | null;
    volumeUsd7d?: number | null;
    assetCorrelation?: { relativePriceMovePercentiles?: { horizonHours?: number; p95DownMovePercent?: number; p95UpMovePercent?: number }[] } | null;
  };
  options?: RawOption[];
}

const CFG = config.vfat;
const STOCKS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(config.stockTokens)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([chain, list]) => [chain, new Set(Object.values(list as Record<string, string>).map((a) => a.toLowerCase()))]),
);

const DAY = 86_400_000;
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export const emptyRejected = (): Record<RejectReason, number> => ({ asset: 0, price: 0, tvl: 0, age: 0, fees: 0, outlier: 0, inactive: 0 });

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

/** One vfat pool → a vetted row, or the first rule it fails. */
export function vetPool(it: RawItem, ref: { eth: number | null; btc: number | null }, now: number): LpPool | RejectReason {
  const chainId = num(it.chainId);
  const under = it.pool?.underlying ?? [];
  if (!it.id || chainId === null || under.length !== 2 || it.isWhitelisted === false) return 'asset';

  const classes = under.map((t) => classify(t, chainId, ref));
  const bad = classes.find((c) => c === 'asset' || c === 'price');
  if (bad) return bad as RejectReason;
  // Any pair of known classes is kept; a memecoin or unknown token on either side never is.
  const [a, b] = classes as AssetClass[];

  const opt = (it.options ?? []).find((o) => o.kind === 'lp' && !o.isKilled) ?? null;
  if (!opt) return 'inactive';
  const tvl = num(opt.totalLiquidity);
  if (tvl === null || tvl < CFG.minTvlUsd) return 'tvl';

  const born = Date.parse(it.pool?.createdAt ?? it.firstSeenAt ?? '');
  if (!Number.isFinite(born)) return 'age';
  const ageDays = (now - born) / DAY;
  if (ageDays < CFG.minAgeDays) return 'age';

  const fees = num(opt.feesUsd7d);
  if (fees === null || fees <= 0) return 'fees';
  const feeAprPct = (fees / tvl) * (365 / 7) * 100;
  if (feeAprPct > CFG.maxFeeAprPct) return 'outlier';

  const p95 = it.pool?.assetCorrelation?.relativePriceMovePercentiles?.find((x) => x.horizonHours === 168);
  const down = num(p95?.p95DownMovePercent);
  const up = num(p95?.p95UpMovePercent);
  const fee = num(it.pool?.currentFee);

  return {
    id: it.id,
    chainId,
    chain: networkByChainId(chainId).key,
    tokens: [
      { symbol: under[0].symbol as string, address: (under[0].address as string).toLowerCase(), cls: a },
      { symbol: under[1].symbol as string, address: (under[1].address as string).toLowerCase(), cls: b },
    ],
    protocol: opt.protocol?.name?.trim() || 'vfat',
    concentrated: it.pool?.type === 'concentrated',
    // vfat publishes the fee in hundredths of a basis point (3000 = 0.3%).
    feeTierPct: fee !== null && fee >= 0 ? fee / 10_000 : null,
    tvlUsd: tvl,
    volume7dUsd: num(it.pool?.volumeUsd7d) ?? 0,
    fees7dUsd: fees,
    feeAprPct,
    incentives: (it.options ?? []).some((o) => (o.weeklyRewards ?? []).some((r) => r.type !== 'swap-fee' && (num(r.amountUsd) ?? 0) > 0)),
    stable: a === 'usd' && b === 'usd',
    move7d: down !== null && up !== null ? { down, up } : null,
    ageDays,
  };
}

/** Vets every pool, one row per id (the focus and global lists overlap), highest fee rate first. */
export function vetPools(items: RawItem[], now: number): { pools: LpPool[]; rejected: Record<RejectReason, number> } {
  const ref = referencePrices(items);
  const rejected = emptyRejected();
  const byId = new Map<string, LpPool>();
  const seen = new Set<string>();
  for (const it of items) {
    if (it.id && seen.has(it.id)) continue;
    if (it.id) seen.add(it.id);
    const r = vetPool(it, ref, now);
    if (typeof r === 'string') rejected[r]++;
    else byId.set(r.id, r);
  }
  return { pools: [...byId.values()].sort((x, y) => y.feeAprPct - x.feeAprPct || (x.id < y.id ? -1 : 1)), rejected };
}
