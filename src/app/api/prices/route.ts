import { NextResponse, type NextRequest } from 'next/server';
import { tokenInfo } from '../../../lib/portfolio/tokens';

export const runtime = 'nodejs';

const LLAMA = 'https://coins.llama.fi/prices';
const MAX_SYMBOLS = 10;

interface LlamaPrices {
  coins: Record<string, { price: number; timestamp: number; symbol?: string }>;
}

/**
 * GET /api/prices?symbols=ETH,USDC[&at=<unix seconds>]
 * USD prices of listed tokens, now or at a past moment (DefiLlama, ±4h window).
 * Unknown symbols are simply absent from the result.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const symbols = (q.get('symbols') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_SYMBOLS);
  const atParam = q.get('at');
  const at = atParam === null ? null : Math.floor(Number(atParam));
  if (at !== null && !(at > 1_400_000_000 && at <= Date.now() / 1000 + 300)) {
    return NextResponse.json({ error: 'invalid_at', message: 'at must be a past unix timestamp in seconds.' }, { status: 400 });
  }

  const ids = new Map<string, string>();
  for (const s of symbols) {
    const t = tokenInfo(s);
    if (t?.coingeckoId) ids.set(`coingecko:${t.coingeckoId}`, s);
  }
  if (!ids.size) return NextResponse.json({ prices: {} });

  const coins = [...ids.keys()].join(',');
  const url = at === null ? `${LLAMA}/current/${coins}?searchWidth=4h` : `${LLAMA}/historical/${at}/${coins}?searchWidth=4h`;
  try {
    // Current prices move; historical ones never change.
    const res = await fetch(url, { next: { revalidate: at === null ? 60 : 86_400 }, headers: { accept: 'application/json' } } as RequestInit);
    if (!res.ok) return NextResponse.json({ error: 'upstream_error', message: `price API responded with ${res.status}` }, { status: 502 });
    const data = (await res.json()) as LlamaPrices;
    const prices: Record<string, { usd: number; at: string }> = {};
    for (const [key, v] of Object.entries(data.coins ?? {})) {
      const s = ids.get(key);
      if (s && Number.isFinite(v.price) && v.price > 0) prices[s] = { usd: v.price, at: new Date(v.timestamp * 1000).toISOString() };
    }
    return NextResponse.json({ prices });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'price API unavailable' }, { status: 502 });
  }
}
