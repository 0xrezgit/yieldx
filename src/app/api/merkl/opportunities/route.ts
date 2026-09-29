import { NextResponse } from 'next/server';
import { getMerklFeed } from '../../../../lib/merkl/server';

export const runtime = 'nodejs';

/**
 * GET /api/merkl/opportunities — every live Merkl opportunity with its live
 * campaigns, slimmed for the browser. Fixed query, no parameters: callers cannot
 * make the server spend Merkl quota on arbitrary requests.
 */
export async function GET() {
  try {
    const feed = await getMerklFeed();
    return NextResponse.json(feed, {
      // Shared caches may reuse it briefly; upstream is cached for 5 minutes anyway.
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'Merkl API unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
