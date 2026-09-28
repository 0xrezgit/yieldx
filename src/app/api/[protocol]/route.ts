import { NextResponse } from 'next/server';
import { getAdapter, isProtocolId } from '../../../lib/protocols';
import { adapterErrorResponse, unknownProtocolResponse } from '../../../lib/protocols/http';
import { withLifecycle } from '../../../lib/protocols/lifecycle';

export const runtime = 'nodejs';

/** GET /api/:protocol — the protocol's live market list, with expiry flags. New listings appear automatically. */
export async function GET(_request: Request, { params }: { params: Promise<{ protocol: string }> }) {
  const { protocol } = await params;
  if (!isProtocolId(protocol)) return unknownProtocolResponse(protocol);
  try {
    const markets = withLifecycle(await getAdapter(protocol).listMarkets());
    return NextResponse.json({ protocol, markets });
  } catch (error) {
    return adapterErrorResponse(error, `GET /api/${protocol} failed`);
  }
}
