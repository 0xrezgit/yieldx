import { NextResponse } from 'next/server';
import { getLoopHistory } from '../../../../lib/pendleloop/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/pendleloop/history?chain=<id>&pt=<address> — the hourly history of every PendleLoop
 * box of one collateral (borrow rate, the oracle's and the market's price), for the replay of
 * past entries. Only a chain id and a token address are accepted.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const chain = Number(q.get('chain'));
  const pt = q.get('pt') ?? '';
  if (!Number.isInteger(chain) || chain <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(pt)) return NextResponse.json({ error: 'chain and pt are required' }, { status: 400 });
  try {
    const feed = await getLoopHistory(chain, pt);
    return NextResponse.json(feed, { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown error' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
