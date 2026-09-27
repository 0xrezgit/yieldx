import { NextResponse, type NextRequest } from 'next/server';
import { getAdapter, isProtocolId, LiveDataUnavailableError } from '../../../../lib/protocols';
import { adapterErrorResponse, unknownProtocolResponse } from '../../../../lib/protocols/http';

export const runtime = 'nodejs';

const MAX_HISTORY_DAYS = 365;

/**
 * GET /api/:protocol/:market[?history=<days>]
 * Returns live market data, plus daily base-APY history when requested.
 * History that the protocol cannot provide is reported as null, not an error.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ protocol: string; market: string }> },
) {
  const { protocol, market } = await params;
  if (!isProtocolId(protocol)) return unknownProtocolResponse(protocol);

  const historyParam = request.nextUrl.searchParams.get('history');
  const historyDays = historyParam === null ? 0 : Math.floor(Number(historyParam));
  if (historyParam !== null && !(historyDays > 0 && historyDays <= MAX_HISTORY_DAYS)) {
    return NextResponse.json(
      { error: 'invalid_history', message: `history must be an integer between 1 and ${MAX_HISTORY_DAYS}.` },
      { status: 400 },
    );
  }

  const adapter = getAdapter(protocol);
  const marketId = decodeURIComponent(market);
  try {
    const data = await adapter.fetchMarketData(marketId);
    let history: number[] | null = null;
    if (historyDays) {
      try {
        history = await adapter.getHistoricalAPY(marketId, historyDays);
      } catch (error) {
        if (!(error instanceof LiveDataUnavailableError)) throw error;
      }
    }
    return NextResponse.json({ market: data, history });
  } catch (error) {
    return adapterErrorResponse(error, `GET /api/${protocol}/${marketId} failed`);
  }
}
