import { NextResponse } from 'next/server';
import { getAdapter, isProtocolId } from '../../../lib/protocols';
import { adapterErrorResponse, unknownProtocolResponse } from '../../../lib/protocols/http';

export const runtime = 'nodejs';

/** GET /api/:protocol — active markets of a protocol. */
export async function GET(_request: Request, { params }: { params: Promise<{ protocol: string }> }) {
  const { protocol } = await params;
  if (!isProtocolId(protocol)) return unknownProtocolResponse(protocol);
  try {
    const markets = await getAdapter(protocol).listMarkets();
    return NextResponse.json({ protocol, markets });
  } catch (error) {
    return adapterErrorResponse(error, `GET /api/${protocol} failed`);
  }
}
