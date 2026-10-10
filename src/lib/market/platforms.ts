import type { Opportunity } from '../../types/opportunity';

/**
 * The platforms the market analysis is split by: each protocol YieldX reads directly,
 * plus Merkl for the markets known only through Merkl's campaigns. An opportunity
 * belongs to the protocol it is entered on — Merkl rewards linked to a Morpho vault
 * keep it on Morpho.
 */
export type PlatformId = 'pendle' | 'spectra' | 'exponent' | 'morpho' | 'aave' | 'kamino' | 'loopscale' | 'revert' | 'merkl';

export interface Platform {
  id: PlatformId;
  name: string;
  /** What is done there, in a few Persian words. */
  what: string;
  logo: string;
  site: string;
}

const llamaIcon = (slug: string) => `https://icons.llamao.fi/icons/protocols/${slug}?w=48&h=48`;

export const PLATFORMS: Platform[] = [
  { id: 'pendle', name: 'Pendle', what: 'نرخ ثابت (PT) و بازده و پوینت (YT)', logo: '/logos/protocols/pendle.webp', site: 'https://app.pendle.finance' },
  { id: 'morpho', name: 'Morpho', what: 'وام‌دهی، خزانه‌ها و نرخ ثابت Midnight', logo: llamaIcon('morpho'), site: 'https://app.morpho.org' },
  { id: 'aave', name: 'Aave', what: 'وام‌دهی Aave V4', logo: llamaIcon('aave'), site: 'https://app.aave.com' },
  { id: 'kamino', name: 'Kamino', what: 'وام‌دهی روی سولانا', logo: llamaIcon('kamino'), site: 'https://kamino.com' },
  { id: 'spectra', name: 'Spectra', what: 'نرخ ثابت (PT) و بازده (YT)', logo: '/logos/protocols/spectra.webp', site: 'https://app.spectra.finance' },
  { id: 'exponent', name: 'Exponent', what: 'نرخ ثابت و بازده روی سولانا', logo: '/logos/protocols/exponent.webp', site: 'https://www.exponent.finance' },
  { id: 'loopscale', name: 'Loopscale', what: 'خزانه‌های وام‌دهی سولانا', logo: llamaIcon('loopscale'), site: 'https://app.loopscale.com' },
  { id: 'revert', name: 'Revert', what: 'وام‌دهی Revert Lend', logo: llamaIcon('revert'), site: 'https://revert.finance' },
  { id: 'merkl', name: 'Merkl', what: 'کمپین‌های پاداش در پروتکل‌های دیگر', logo: llamaIcon('merkl'), site: 'https://app.merkl.xyz' },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);
const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));
export const platformById = (id: string): Platform | null => BY_ID.get(id as PlatformId) ?? null;

/** The platform an opportunity is entered on. */
export function platformOf(o: Pick<Opportunity, 'key' | 'protocol'>): PlatformId {
  if (o.key.startsWith('merkl:')) return 'merkl';
  return BY_ID.has(o.protocol.id as PlatformId) ? (o.protocol.id as PlatformId) : 'merkl';
}
