/**
 * Revert for the LP tool: where a pool lives on Revert (its link opens Revert's
 * position creator with automatic range management), and how the pool's real LPs
 * have done — from Revert's public positions index (`/v1/positions?network=&pool=`).
 *
 * The real-LP figures sit beside the estimate, never in it: they describe other
 * people's ranges and timing, not the position the estimate assumes.
 */

const NETWORK: Record<number, string> = { 1: 'mainnet', 10: 'optimism', 56: 'bnb', 130: 'unichain', 137: 'polygon', 4663: 'robinhood', 8453: 'base', 42161: 'arbitrum' };
/** vfat protocol id → Revert exchange (only venues Revert indexes; Fables, Ramses… are not). */
const EXCHANGE: Record<string, string> = { uniswap: 'uniswapv3', uniswap_v4: 'uniswapv4', aerodrome: 'aerodrome', pancakeSwap: 'pancakeswapv3' };

export interface RevertRef {
  network: string;
  exchange: string;
  /** Pool address, or the bytes32 pool id for Uniswap V4. */
  pool: string;
  url: string;
}

/** Revert's pool page (Discover, expanded on this pool); only revert.finance links are ever built. */
export const revertPoolUrl = (r: Omit<RevertRef, 'url'>) =>
  `https://revert.finance/#/discover?networks=${encodeURIComponent(r.network)}&exchanges=${encodeURIComponent(r.exchange)}&address=${encodeURIComponent(r.pool)}&expand=true`;

export function revertRef(chainId: number, protocolId: string | undefined, poolAddress: string | undefined, poolId: string | undefined | null): RevertRef | null {
  const network = NETWORK[chainId];
  const exchange = protocolId ? EXCHANGE[protocolId] : undefined;
  if (!network || !exchange) return null;
  const pool = (exchange === 'uniswapv4' ? poolId : poolAddress)?.toLowerCase();
  if (!pool || !/^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(pool)) return null;
  return { network, exchange, pool, url: revertPoolUrl({ network, exchange, pool }) };
}

/** Revert `/v1/positions` row (only the fields read). */
export interface RawRevertPosition {
  nft_id?: number;
  in_range?: boolean;
  exited?: boolean;
  age?: number | null;
  underlying_value?: string | number | null;
  performance?: { hodl?: { fee_apr?: string | number | null } | null } | null;
}

export interface RealLpStats {
  /** Positions counted (open, ≥ $100, ≥ 7 days old). */
  count: number;
  /** Realised fee APR of those positions, %: quartiles. */
  feeApr: { p25: number; median: number; p75: number };
  /** Share of them in range now, %. */
  inRangePct: number;
  url: string;
}

const MIN_VALUE_USD = 100;
const MIN_AGE_DAYS = 7;
/** Fewer counted positions than this → no figures (too few to describe a pool). */
export const MIN_POSITIONS = 5;

const n = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN);
const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};

export function realLpStats(rows: RawRevertPosition[], ref: RevertRef): RealLpStats | null {
  const seen = new Set<number>();
  const ok = rows.filter((r) => {
    if (typeof r.nft_id === 'number') {
      if (seen.has(r.nft_id)) return false;
      seen.add(r.nft_id);
    }
    return !r.exited && n(r.underlying_value) >= MIN_VALUE_USD && n(r.age) >= MIN_AGE_DAYS && Number.isFinite(n(r.performance?.hodl?.fee_apr));
  });
  if (ok.length < MIN_POSITIONS) return null;
  const fees = ok.map((r) => n(r.performance?.hodl?.fee_apr)).sort((a, b) => a - b);
  return {
    count: ok.length,
    feeApr: { p25: quantile(fees, 0.25), median: quantile(fees, 0.5), p75: quantile(fees, 0.75) },
    inRangePct: (ok.filter((r) => r.in_range).length / ok.length) * 100,
    url: ref.url,
  };
}
