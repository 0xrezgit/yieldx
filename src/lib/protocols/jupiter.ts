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

/** Logos rarely change: a mint's answer is kept for hours, so a cold start's many sources share one request. */
const META_TTL_MS = 6 * 3_600_000;
/**
 * Mints per request. Jupiter's search slows with the list (2026-11-08: 86 mints 8.8 s,
 * 40 mints 1.0 s, 20 mints 0.8 s), and a long one ran past the timeout — which had left
 * every Kamino row without a logo.
 */
const BATCH = 25;
const known = new Map<string, { at: number; t: SolanaToken | null }>();

/** Tests: forget every remembered mint. */
export const resetSolanaTokens = () => known.clear();

async function ask(mints: string[], fresh: boolean): Promise<JupiterToken[] | null> {
  const res = await fetch(`${protocols.exponent.tokenApi}?query=${mints.join(',')}`, {
    ...(fresh ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  } as RequestInit);
  if (!res.ok) return null;
  const list = (await res.json()) as JupiterToken[];
  return Array.isArray(list) ? list : null;
}

/**
 * Logos and USD prices for Solana mints from Jupiter's token API (one request for
 * up to 100 mints). Best-effort: returns what it has if Jupiter is unreachable, so
 * market data still loads without logos. A failed request is tried once more — on a
 * cold start several sources ask at once and Jupiter turns some away, which had left
 * every Kamino row without a logo (2026-11-08). Logos are remembered per mint; prices
 * are only as fresh as `fresh` asks.
 */
export async function fetchSolanaTokens(mints: string[], fresh = false): Promise<Map<string, SolanaToken>> {
  const out = new Map<string, SolanaToken>();
  const unique = [...new Set(mints.filter(Boolean))].slice(0, 100);
  if (!unique.length) return out;
  const now = Date.now();
  const due = fresh ? unique : unique.filter((m) => { const k = known.get(m); return !k || now - k.at >= META_TTL_MS; });
  for (let i = 0; i < due.length; i += BATCH) {
    const part = due.slice(i, i + BATCH);
    let list: JupiterToken[] | null = null;
    for (let attempt = 0; attempt < 2 && !list; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500));
      try {
        list = await ask(part, fresh);
      } catch {
        /* logos and prices are optional */
      }
    }
    if (list) {
      const got = new Set<string>();
      for (const t of list) {
        got.add(t.id);
        known.set(t.id, {
          at: now,
          t: {
            symbol: t.symbol ?? null,
            // arweave.net is unreachable on some networks; ardrive.net serves the same files.
            icon: typeof t.icon === 'string' && t.icon.startsWith('https://') ? t.icon.replace(/^https:\/\/arweave\.net\//, 'https://ardrive.net/') : null,
            usdPrice: Number.isFinite(t.usdPrice) && (t.usdPrice as number) > 0 ? (t.usdPrice as number) : null,
          },
        });
      }
      // A mint Jupiter does not know is remembered as unknown, not asked again every time.
      for (const m of part) if (!got.has(m)) known.set(m, { at: now, t: null });
    }
  }
  for (const m of unique) {
    const t = known.get(m)?.t;
    if (t) out.set(m, t);
  }
  return out;
}
