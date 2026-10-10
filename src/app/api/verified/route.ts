import { after, NextResponse } from 'next/server';
import { getVerified } from '../../../lib/llama/verify-server';

export const runtime = 'nodejs';
/** Room for the verification still running after the answer (see `after`). */
export const maxDuration = 300;

/**
 * GET /api/verified — DefiLlama pools that YieldX verified on-chain itself: yield
 * from the vault's share price, exits from simulated withdrawals of real holders.
 * While pools are still being verified the feed says how many (`pending`) and the
 * browser asks again.
 */
export async function GET() {
  try {
    const { feed, background } = await getVerified();
    if (background) after(() => background);
    return NextResponse.json(feed, { headers: { 'Cache-Control': feed.pending ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=3600' } });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'DefiLlama unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
