import { NextResponse } from 'next/server';
import { getLoopBoxes } from '../../../lib/pendleloop/server';

export const runtime = 'nodejs';

/**
 * GET /api/pendleloop — PendleLoop's «Loop to Earn» boxes as listed right now, on every network
 * and money market Pendle has; PTs past maturity are left out. Fixed query, no parameters.
 */
export async function GET() {
  const feed = await getLoopBoxes();
  const down = !feed.boxes.length && feed.error !== null;
  return NextResponse.json(feed, {
    status: down ? 502 : 200,
    headers: { 'Cache-Control': down ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}
