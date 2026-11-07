import config from '../../config/rwa.json';
import type { RwaInfo } from '../../types/opportunity';

/**
 * Real-world-asset tokens priced as a dollar NAV (src/config/rwa.json): they loop against a
 * dollar debt like a stablecoin, but nothing pegs them — the issuer's NAV can be marked
 * down and redemption can be queued. A loop on one is costed in dollars, at the cautious
 * leverage, and carries the issuer and what backs it.
 */

const COLLATERAL = config.collateral as Record<string, Record<string, { symbol: string; issuer: string; backing: string; url?: string; logo?: string }>>;
const DOLLAR_DEBT = config.dollarDebt as Record<string, Record<string, string>>;

/** By the token's address on its network (case kept: Solana addresses are case-sensitive). */
export function rwaOf(chain: string, address: string | null | undefined): RwaInfo | null {
  if (!address) return null;
  const hit = COLLATERAL[chain]?.[address];
  return hit ? { issuer: hit.issuer, backing: hit.backing, url: hit.url ?? null } : null;
}

/** The token's logo from the list, for when the live token list is unreachable. */
export const rwaLogo = (chain: string, address: string | null | undefined) => (address ? (COLLATERAL[chain]?.[address]?.logo ?? null) : null);

/** A dollar token whose symbol does not say so (wYLDS, CASH): held at $1. */
export const isDollarDebt = (chain: string, address: string | null | undefined) => !!address && !!DOLLAR_DEBT[chain]?.[address];

/** The risks every RWA loop shares, in plain Persian (shown with the loop). */
export const RWA_RISKS = [
  'ارزش این دارایی NAV صادرکننده است، نه یک دلار ثابت: زیان اعتباری یا بیمه‌ای می‌تواند آن را یک‌باره پایین بیاورد و لوپ را به لیکوییدشدن برساند.',
  'بازخرید می‌تواند صف یا سقف روزانه داشته باشد؛ در فشار بازار، بستن سریع موقعیت سخت است.',
  'ظرفیت وام این بازارها کوچک است و زود پر می‌شود؛ وام نرخ ثابت در پایان دوره با نرخ آن روز تمدید می‌شود.',
] as const;
