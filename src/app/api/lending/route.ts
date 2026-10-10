import { after, NextResponse } from 'next/server';
import { getLendingFeed } from '../../../lib/lending/server';
import { pendingHistories } from '../../../lib/lending/history';

export const runtime = 'nodejs';
/** Room for the rate histories still being fetched after the answer (see `after`). */
export const maxDuration = 120;

/**
 * GET /api/lending — variable-rate lending and vault opportunities (Morpho, Aave V4)
 * in the shared Opportunity model, with the state of each source. Fixed queries, no
 * parameters. Always 200 while any source answers; the estimate for the user's
 * amount and period is computed in the browser.
 */
export async function GET() {
  const feed = await getLendingFeed();
  const histories = pendingHistories();
  if (histories) after(() => histories);
  const allDown = feed.sources.every((s) => s.state === 'error');
  return NextResponse.json(feed, {
    status: allDown ? 502 : 200,
    headers: { 'Cache-Control': allDown ? 'no-store' : 'public, s-maxage=30, stale-while-revalidate=120' },
  });
}
