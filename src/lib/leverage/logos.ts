import lp from '../../config/lp-pools.json';
import { projectLogo } from '../llama/yields';
import { tokenInfo } from '../portfolio/tokens';
import { underlyingOf, type AssetKind } from './assets';

/**
 * Logos for the leverage comparison: the token's own (the source's icon, then the app's
 * token list), a tokenised stock by its ticker (the same source the LP pools use), and
 * each platform's from DefiLlama's protocol icons (checked 2026-11-07: every slug below
 * answers with an image; an unknown slug is a 404, so a failed image shows a monogram).
 */

const PLATFORM: Record<string, string> = {
  kamino: 'kamino-lend',
  morpho: 'morpho-blue',
  'aave v3': 'aave-v3',
  aave: 'aave-v3',
  euler: 'euler-v2',
  hyperliquid: 'hyperliquid',
  pendleloop: 'pendle',
};

/** Underlyings the token list has no entry for (checked 2026-11-07: each answers with an image). */
const UNDERLYING: Record<string, string> = {
  BTC: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
  ZEC: 'https://coin-images.coingecko.com/coins/images/486/small/circle-zcash-color.png',
  PAXG: 'https://coin-images.coingecko.com/coins/images/9519/small/paxgold.png',
};

const stockLogo = (ticker: string) => `${lp.stockLogo}${encodeURIComponent(ticker)}.png`;

/** The underlying's logo, for the asset strip (BTC, SOL, TSLA…). */
export function assetLogo(asset: string, kind: AssetKind): string | null {
  return kind === 'stocks' ? stockLogo(asset) : (UNDERLYING[asset] ?? tokenInfo(asset)?.logo ?? null);
}

/**
 * A token's logo: the app's token list first (stable hosts — a source's icon can sit on a
 * rate-limited IPFS gateway), then the source's icon (xStocks, Jupiter), then the underlying's.
 */
export function tokenLogo(symbol: string, icon: string | null, kind?: AssetKind): string | null {
  const known = tokenInfo(symbol)?.logo;
  if (known) return known;
  if (icon && !icon.includes('/ipfs/')) return icon;
  const u = underlyingOf(symbol, kind);
  return u ? assetLogo(u.asset, u.kind) : (icon ?? null);
}

/** A platform's logo: the one its source sent (PendleLoop's money-market icons), else DefiLlama's. */
export function platformLogo(name: string, icon: string | null = null): string | null {
  if (icon) return icon;
  const slug = PLATFORM[name.trim().toLowerCase()];
  return slug ? projectLogo(slug) : null;
}
