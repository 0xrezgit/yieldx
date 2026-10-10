import { NextResponse, type NextRequest } from 'next/server';
import { verifiedGrowth } from '../../../../lib/llama/verify-server';

export const runtime = 'nodejs';

const ID = /^[A-Za-z0-9-]{8,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/verified/:id?amount=&from=YYYY-MM-DD — a deposit grown by the vault's
 * on-chain share price from that day to the latest verified day.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const amount = Number(sp.get('amount'));
  const from = sp.get('from') ?? '';
  if (!ID.test(id) || !DATE.test(from) || !(amount > 0)) return NextResponse.json({ error: 'invalid_query', message: 'id, amount > 0 and from=YYYY-MM-DD are required.' }, { status: 400 });
  try {
    const g = await verifiedGrowth(id, amount, Date.parse(`${from}T00:00:00Z`));
    if (!g) return NextResponse.json({ error: 'not_verified', message: 'Pool not verified, or the date is not before the verified day.' }, { status: 404 });
    return NextResponse.json(g, { headers: { 'Cache-Control': 'public, s-maxage=3600' } });
  } catch {
    return NextResponse.json({ error: 'upstream_error', message: 'On-chain data unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
