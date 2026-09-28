import { NextResponse } from 'next/server';
import { LiveDataUnavailableError, MarketNotFoundError, UpstreamError } from './base';

/** Maps adapter errors to HTTP responses shared by the protocol API routes. */
export function adapterErrorResponse(error: unknown, context: string) {
  if (error instanceof LiveDataUnavailableError) {
    return NextResponse.json({ error: 'manual_only', message: error.message }, { status: 501 });
  }
  if (error instanceof MarketNotFoundError) {
    return NextResponse.json({ error: 'market_not_found', message: error.message }, { status: 404 });
  }
  if (error instanceof UpstreamError) {
    return NextResponse.json({ error: 'upstream_error', message: error.message }, { status: 502 });
  }
  console.error(context, error);
  return NextResponse.json({ error: 'internal_error', message: 'Unexpected error' }, { status: 500 });
}

export function unknownProtocolResponse(protocol: string) {
  return NextResponse.json(
    { error: 'unknown_protocol', message: `Unknown protocol "${protocol}".` },
    { status: 404 },
  );
}
