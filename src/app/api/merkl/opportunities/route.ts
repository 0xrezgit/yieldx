import { NextResponse } from 'next/server';
import { getMerklFeed } from '../../../../lib/merkl/server';

export const runtime = 'nodejs';

/**
 * GET /api/merkl/opportunities — every live Merkl opportunity with its live
 * campaigns, slimmed for the browser, plus programs, reward-token DEX markets and
 * Ethereum gas. Fixed query, no parameters: callers cannot
 * make the server spend Merkl quota on arbitrary requests.
 */
export async function GET() {
  try {
    const feed = await getMerklFeed();
    return NextResponse.json(feed, {
      // Live list: shared caches may reuse it for 30 s; upstream refreshes every minute.
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
    });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'Merkl API unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
