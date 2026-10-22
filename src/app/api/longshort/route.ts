import { NextResponse } from 'next/server';
import { getLongShortFeed } from '../../../lib/longshort/feed';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/longshort — PendleLoop's Long/Short markets (price views on Aave and Morpho)
 * with each one's rates, limits and oracle rating, and the same view as a Hyperliquid
 * perpetual for comparison. Fixed query, no parameters; the calculator runs in the browser.
 */
export async function GET() {
  const feed = await getLongShortFeed();
  const down = !feed.rows.length && feed.error !== null;
  return NextResponse.json(feed, {
    status: down ? 502 : 200,
    headers: { 'Cache-Control': down ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
