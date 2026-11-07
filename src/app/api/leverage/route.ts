import { after, NextResponse } from 'next/server';
import { getLeverageFeed } from '../../../lib/leverage/feed';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/leverage — every way to hold a leveraged long or short the app knows of:
 * Kamino Multiply pairs, PendleLoop Long/Short markets and the matching Hyperliquid
 * perps, each source with its own error. Fixed query, no parameters; costs are
 * computed in the browser for the user's amount, leverage and period.
 *
 * A source that is slow on a cold cache is answered as «pending» and finished after the
 * response, so the next request (the page retries in seconds) has it.
 */
export async function GET() {
  const { feed, pending } = await getLeverageFeed();
  if (pending.length) after(() => Promise.allSettled(pending));
  const down = !feed.kamino.length && !feed.pendle.length && !pending.length;
  const partial = feed.kaminoError === 'pending' || feed.pendleError === 'pending';
  return NextResponse.json(feed, {
    status: down ? 502 : 200,
    headers: { 'Cache-Control': down || partial ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
