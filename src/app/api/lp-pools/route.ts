import { NextResponse } from 'next/server';
import { getLpPools } from '../../../lib/lp/server';

export const runtime = 'nodejs';

/**
 * GET /api/lp-pools — vetted LP pools (vfat) for the LP tool. Fixed queries, no
 * parameters. Not part of the market ranking.
 */
export async function GET() {
  try {
    const feed = await getLpPools();
    return NextResponse.json(feed, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'vfat unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
