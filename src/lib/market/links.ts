import type { MarketListing } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import { networkByName } from '../registry/networks';

/**
 * Entry links to a market in its protocol's own app.
 *
 * Verified formats (from live Merkl `depositUrl` values, which the protocols supply):
 * - Pendle:  https://app.pendle.finance/trade/markets/{market}/swap?view=yt&chain=ethereum
 * - Morpho:  https://app.morpho.org/{chain}/vault/{address}, …/{chain}/market/{uniqueKey}
 *   (seen for «ethereum» and «base»; other chain names follow the same lower-case pattern).
 * Spectra and Exponent publish no market URL format we could verify: their links open the
 * app, and `exact` is false so the page can show the market address to search for.
 */

export interface EntryLink {
  url: string;
  /** Opens this market itself (true) or only the protocol's app (false). */
  exact: boolean;
}

const PENDLE_CHAIN: Record<number, string> = { 1: 'ethereum', 42161: 'arbitrum', 8453: 'base', 56: 'bnbchain', 5000: 'mantle', 146: 'sonic', 80094: 'berachain', 999: 'hyperevm', 9745: 'plasma', 10: 'optimism' };
const MORPHO_CHAIN: Record<number, string> = { 1: 'ethereum', 8453: 'base', 42161: 'arbitrum', 10: 'optimism', 137: 'polygon', 130: 'unichain', 747474: 'katana', 999: 'hyperevm' };

export const morphoLink = (chainId: number, kind: 'vault' | 'market', id: string): EntryLink | null => {
  const chain = MORPHO_CHAIN[chainId];
  return chain ? { url: `https://app.morpho.org/${chain}/${kind}/${id}`, exact: true } : null;
};

export function pendleLink(chainId: number, market: string, view: 'pt' | 'yt'): EntryLink {
  const chain = PENDLE_CHAIN[chainId];
  return { url: `https://app.pendle.finance/trade/markets/${market.toLowerCase()}/swap?view=${view}${chain ? `&chain=${chain}` : ''}`, exact: true };
}

/** Where to buy this market's PT or YT. */
export function listingLink(protocol: ProtocolId, m: Pick<MarketListing, 'id' | 'chain'>, view: 'pt' | 'yt'): EntryLink {
  if (protocol === 'pendle') {
    const r = /^(?:(\d+)-)?(0x[0-9a-fA-F]{40})$/.exec(m.id);
    const chainId = r?.[1] ? Number(r[1]) : (networkByName(m.chain).chainId ?? 1);
    if (r) return pendleLink(chainId, r[2], view);
    return { url: 'https://app.pendle.finance/trade/markets', exact: false };
  }
  if (protocol === 'spectra') return { url: 'https://app.spectra.finance', exact: false };
  return { url: 'https://www.exponent.finance', exact: false };
}

/** The market's address as shown to search for it when the link only opens the app. */
export const marketAddress = (m: Pick<MarketListing, 'id'>) => (m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id);

/** A link that only opens a protocol's app (its root or a generic section), not one market. */
export function isAppRoot(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return path === '' || /^\/(earn\/lend|lend|markets|fixed|trade\/markets)$/.test(path);
  } catch {
    return true;
  }
}
