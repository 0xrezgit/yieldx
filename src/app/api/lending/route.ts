import { gzipSync } from 'node:zlib';
import { after, NextResponse } from 'next/server';
import { getLendingFeed } from '../../../lib/lending/server';
import { pendingHistories } from '../../../lib/lending/history';
import { leanOpportunity } from '../../../lib/lending/lean';

export const runtime = 'nodejs';
/** Room for the rate histories still being fetched after the answer (see `after`). */
export const maxDuration = 120;

/** The last body sent, plain and gzipped: the same feed is not serialised or compressed twice. */
let last: { fetchedAt: string; body: string; gz: Buffer | null } | null = null;

/**
 * GET /api/lending — variable-rate lending and vault opportunities (Morpho, Aave V4)
 * in the shared Opportunity model, with the state of each source. Fixed queries, no
 * parameters. Always 200 while any source answers; the estimate for the user's
 * amount and period is computed in the browser.
 *
 * Every opportunity goes out; only redundant points of the rate curves are dropped
 * (leanOpportunity). Next.js does not compress route handlers, so the body is gzipped
 * here when the browser accepts it (a few MB of JSON → a few hundred KB).
 */
export async function GET(request?: Request) {
  const feed = await getLendingFeed();
  const histories = pendingHistories();
  if (histories) after(() => histories);
  const allDown = feed.sources.every((s) => s.state === 'error');
  const key = `${feed.fetchedAt}|${feed.sources.map((s) => `${s.id}:${s.fetchedAt}:${s.state}`).join(',')}`;
  if (!last || last.fetchedAt !== key) last = { fetchedAt: key, body: JSON.stringify({ ...feed, opportunities: feed.opportunities.map(leanOpportunity) }), gz: null };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': allDown ? 'no-store' : 'public, s-maxage=30, stale-while-revalidate=120',
    Vary: 'Accept-Encoding',
  };
  const gzip = /\bgzip\b/.test(request?.headers.get('accept-encoding') ?? '');
  if (gzip) {
    last.gz ??= gzipSync(last.body, { level: 6 });
    return new NextResponse(new Uint8Array(last.gz), { status: allDown ? 502 : 200, headers: { ...headers, 'Content-Encoding': 'gzip' } });
  }
  return new NextResponse(last.body, { status: allDown ? 502 : 200, headers });
}
