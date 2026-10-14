import { NextResponse } from 'next/server';
import { getMultiplyFeed } from '../../../lib/multiply/kamino';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/multiply — Kamino Multiply pairs with a volatile collateral and a dollar debt
 * (a leveraged long), with each pair's limits, rates and measured volatility. Fixed
 * query, no parameters; the scenarios are simulated in the browser.
 */
export async function GET() {
  const feed = await getMultiplyFeed();
  const down = !feed.rows.length && feed.error !== null;
  return NextResponse.json(feed, {
    status: down ? 502 : 200,
    headers: { 'Cache-Control': down ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
