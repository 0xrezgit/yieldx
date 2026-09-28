import config from '../../config/tokens.json';

/**
 * Tokens a user can pay with, per chain. Symbols keep their official casing
 * (USDe, cbBTC, wstETH); matching is case-insensitive. Any other symbol can be typed.
 */
export interface TokenInfo {
  symbol: string;
  name: string;
  logo: string | null;
  /** CoinGecko id, used to look up USD prices; null for tokens outside the list. */
  coingeckoId: string | null;
  /** First token of a chain: pays network fees. */
  native: boolean;
}

type Known = keyof typeof config.tokens;
const KNOWN = config.tokens as Record<string, { name: string; coingeckoId: string; logo: string }>;
const BY_LOWER = new Map(Object.keys(KNOWN).map((s) => [s.toLowerCase(), s]));

export function tokenInfo(symbol: string): TokenInfo | null {
  const key = BY_LOWER.get(symbol.trim().toLowerCase());
  if (!key) return null;
  const t = KNOWN[key as Known];
  return { symbol: key, name: t.name, logo: t.logo, coingeckoId: t.coingeckoId, native: false };
}

export function chainTokenSymbols(chain: string): string[] {
  return (config.chains as Record<string, string[]>)[chain] ?? config.fallback;
}

/**
 * Tokens offered on a chain. The market's own asset comes first (with the market
 * icon when the list has no logo for it), then the chain's native token and the rest.
 */
export function tokensForChain(chain: string, asset?: { symbol: string; icon?: string | null }): TokenInfo[] {
  const symbols = chainTokenSymbols(chain);
  const list: TokenInfo[] = symbols.map((s, i) => ({ ...tokenInfo(s)!, native: i === 0 }));
  const a = asset?.symbol.trim();
  if (a && !list.some((t) => t.symbol.toLowerCase() === a.toLowerCase())) {
    const known = tokenInfo(a);
    list.unshift(known ?? { symbol: a, name: 'دارایی پایه‌ی بازار', logo: asset?.icon ?? null, coingeckoId: null, native: false });
  } else if (a) {
    const i = list.findIndex((t) => t.symbol.toLowerCase() === a.toLowerCase());
    list.unshift(...list.splice(i, 1));
  }
  return list;
}

export const nativeToken = (chain: string) => chainTokenSymbols(chain)[0];
