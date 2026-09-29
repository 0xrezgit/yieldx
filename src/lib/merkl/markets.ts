import type { TokenMarket } from './types';

/**
 * DexScreener chain ids for the networks Merkl runs on. Only chains checked
 * against DexScreener's token endpoint are listed; on the others liquidity is
 * reported as unknown, never guessed.
 */
export const DEX_CHAINS: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  137: 'polygon',
  143: 'monad',
  480: 'worldchain',
  999: 'hyperevm',
  1329: 'seiv2',
  4326: 'megaeth',
  4663: 'robinhood',
  5000: 'mantle',
  5042: 'arc',
  8453: 'base',
  9745: 'plasma',
  42161: 'arbitrum',
  42220: 'celo',
  43114: 'avalanche',
  747474: 'katana',
};

export interface RawPair {
  chainId?: string;
  url?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
}

/**
 * Market of one token from DexScreener pairs: total liquidity of every pair it
 * trades in, and the price of the deepest pair where it is the base asset.
 */
export function marketFromPairs(address: string, pairs: RawPair[]): TokenMarket | null {
  const a = address.toLowerCase();
  const mine = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === a || p.quoteToken?.address?.toLowerCase() === a);
  if (!mine.length) return null;
  const liq = (p: RawPair) => (typeof p.liquidity?.usd === 'number' && Number.isFinite(p.liquidity.usd) ? p.liquidity.usd : 0);
  const asBase = mine.filter((p) => p.baseToken?.address?.toLowerCase() === a && Number(p.priceUsd) > 0).sort((x, y) => liq(y) - liq(x));
  const deepest = [...mine].sort((x, y) => liq(y) - liq(x))[0];
  return {
    liquidityUsd: mine.reduce((s, p) => s + liq(p), 0),
    dexPrice: asBase.length ? Number(asBase[0].priceUsd) : null,
    volume24h: mine.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0),
    pairs: mine.length,
    url: deepest?.url ?? null,
  };
}
