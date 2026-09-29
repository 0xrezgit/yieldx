/**
 * Network registry — one stable identity per chain, independent of how each API
 * spells it ("mainnet", "Ethereum", 1). EVM networks are keyed by their chainId
 * (CAIP-2 `eip155:<id>`), Solana by its namespace.
 *
 * Every network present in the adapters' data today is listed (Pendle chainNames +
 * chains discovered from /v1/chains, Spectra networks, Exponent/Solana). A chain that
 * appears later without an entry still works: `networkByName` / `networkByChainId`
 * return a generic entry with a monogram instead of a logo.
 *
 * Logos: local 64×64 copies in /public/logos/networks — sources in public/logos/SOURCES.md.
 */
export type Namespace = 'eip155' | 'solana';

export interface Network {
  /** Stable key, e.g. "eip155:42161", "solana:mainnet". */
  key: string;
  namespace: Namespace;
  /** EVM chainId; null for non-EVM. */
  chainId: number | null;
  /** English name as used in market data. */
  name: string;
  nameFa: string;
  /** Local logo path, or null → monogram fallback. */
  logo: string | null;
  /** Other spellings used by the APIs. */
  aliases: string[];
}

const evm = (chainId: number, name: string, nameFa: string, logo: string | null, aliases: string[] = []): Network => ({
  key: `eip155:${chainId}`,
  namespace: 'eip155',
  chainId,
  name,
  nameFa,
  logo: logo ? `/logos/networks/${logo}.webp` : null,
  aliases,
});

export const NETWORKS: Network[] = [
  evm(1, 'Ethereum', 'اتریوم', 'ethereum', ['mainnet', 'eth']),
  evm(10, 'Optimism', 'آپتیمیزم', 'optimism', ['op']),
  evm(14, 'Flare', 'فلر', 'flare'),
  evm(56, 'BNB Chain', 'بی‌ان‌بی چین', 'bnb', ['bsc', 'bnb']),
  evm(143, 'Monad', 'موناد', 'monad'),
  evm(146, 'Sonic', 'سونیک', 'sonic'),
  evm(196, 'X Layer', 'ایکس‌لیر', 'xlayer', ['xlayer']),
  evm(999, 'HyperEVM', 'هایپر‌ای‌وی‌ام', 'hyperevm', ['hyperliquid']),
  evm(4663, 'Robinhood Chain', 'رابین‌هود چین', 'robinhood', ['robinhood']),
  evm(5000, 'Mantle', 'منتل', 'mantle'),
  evm(8453, 'Base', 'بیس', 'base'),
  evm(9745, 'Plasma', 'پلاسما', 'plasma'),
  evm(42161, 'Arbitrum', 'آربیتروم', 'arbitrum', ['arbitrum one']),
  evm(43111, 'Hemi', 'همی', 'hemi'),
  evm(43114, 'Avalanche', 'اولانچ', 'avalanche', ['avax']),
  evm(80094, 'Berachain', 'براچین', 'berachain'),
  evm(747474, 'Katana', 'کاتانا', 'katana'),
  {
    key: 'solana:mainnet',
    namespace: 'solana',
    chainId: null,
    name: 'Solana',
    nameFa: 'سولانا',
    logo: '/logos/networks/solana.webp',
    aliases: ['sol'],
  },
];

const BY_ALIAS = new Map<string, Network>();
for (const n of NETWORKS) for (const a of [n.name, ...n.aliases]) BY_ALIAS.set(a.toLowerCase(), n);
const BY_CHAIN_ID = new Map(NETWORKS.filter((n) => n.chainId !== null).map((n) => [n.chainId as number, n]));

/** A network not in the registry: still shown, with its raw name and a monogram. */
function unknownNetwork(name: string): Network {
  const id = /^Chain (\d+)$/.exec(name)?.[1];
  return {
    key: id ? `eip155:${id}` : `unknown:${name.toLowerCase()}`,
    namespace: 'eip155',
    chainId: id ? Number(id) : null,
    name,
    nameFa: id ? `شبکه‌ی ${Number(id).toLocaleString('fa-IR', { useGrouping: false })}` : name,
    logo: null,
    aliases: [],
  };
}

export function networkByName(name: string): Network {
  return BY_ALIAS.get(name.trim().toLowerCase()) ?? unknownNetwork(name);
}

export function networkByChainId(chainId: number): Network {
  return BY_CHAIN_ID.get(chainId) ?? unknownNetwork(`Chain ${chainId}`);
}

export const networkFa = (name: string) => networkByName(name).nameFa;
