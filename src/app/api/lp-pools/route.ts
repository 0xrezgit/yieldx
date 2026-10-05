import { after, NextResponse } from 'next/server';
import { getLpPools } from '../../../lib/lp/server';

export const runtime = 'nodejs';
/** Room for the pool histories still being fetched after the answer (see `after`). */
export const maxDuration = 120;

/**
 * GET /api/lp-pools — vetted LP pools (vfat) for the LP tool. Fixed queries, no
 * parameters. Not part of the market ranking. While some pools' history is still
 * being fetched the feed says how many (`pending`) and the browser asks again.
 */
export async function GET() {
  try {
    const { feed, background } = await getLpPools();
    if (background) after(() => background);
    return NextResponse.json(feed, { headers: { 'Cache-Control': feed.pending || feed.realPending ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'vfat unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
