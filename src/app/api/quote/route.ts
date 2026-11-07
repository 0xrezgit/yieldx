import { NextResponse, type NextRequest } from 'next/server';
import { pendleQuote, quoteAmount } from '../../../lib/protocols/pendle-quote';

export const runtime = 'nodejs';

/**
 * GET /api/quote?chain=1&market=0x…&side=pt|yt&usd=10000[&token=0x…] — what that many
 * dollars of the chain's USDC (or of `token`, a token Pendle lists on that chain: a loop's
 * borrowed asset) buys of a Pendle market's PT or YT right now (Pendle's router). The amount must already be rounded to two significant figures,
 * so callers cannot spend Pendle's quota on arbitrary amounts.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const chain = Number(p.get('chain'));
  const market = p.get('market') ?? '';
  const side = p.get('side');
  const usd = Number(p.get('usd'));
  const token = p.get('token');
  if (!Number.isInteger(chain) || chain <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(market) || (side !== 'pt' && side !== 'yt') || !(usd >= 100 && usd <= 10_000_000) || quoteAmount(usd) !== usd || (token !== null && !/^0x[0-9a-fA-F]{40}$/.test(token))) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const quote = await pendleQuote(chain, market, side, usd, token);
  if (!quote) return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(quote, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
}
