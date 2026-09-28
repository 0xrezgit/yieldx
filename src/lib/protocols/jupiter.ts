import protocols from '../../config/protocols.json';

export interface SolanaToken {
  symbol: string | null;
  icon: string | null;
  usdPrice: number | null;
}

interface JupiterToken {
  id: string;
  symbol?: string;
  icon?: string;
  usdPrice?: number;
}

/**
 * Logos and USD prices for Solana mints from Jupiter's token API (one request for
 * up to 100 mints). Best-effort: returns an empty map if Jupiter is unreachable,
 * so market data still loads without logos.
 */
export async function fetchSolanaTokens(mints: string[]): Promise<Map<string, SolanaToken>> {
  const out = new Map<string, SolanaToken>();
  const unique = [...new Set(mints.filter(Boolean))].slice(0, 100);
  if (!unique.length) return out;
  try {
    const res = await fetch(`${protocols.exponent.tokenApi}?query=${unique.join(',')}`, {
      next: { revalidate: 300 },
      headers: { accept: 'application/json' },
    } as RequestInit);
    if (!res.ok) return out;
    const list = (await res.json()) as JupiterToken[];
    for (const t of Array.isArray(list) ? list : []) {
      out.set(t.id, {
        symbol: t.symbol ?? null,
        icon: typeof t.icon === 'string' && t.icon.startsWith('https://') ? t.icon : null,
        usdPrice: Number.isFinite(t.usdPrice) && (t.usdPrice as number) > 0 ? (t.usdPrice as number) : null,
      });
    }
  } catch {
    /* logos and prices are optional */
  }
  return out;
}
