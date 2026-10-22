import { NextResponse, type NextRequest } from 'next/server';
import { isProxiedIcon } from '../../../lib/market/icon-proxy';

export const runtime = 'nodejs';

const MAX_BYTES = 512 * 1024;

/** GET /api/icon?u=<allowed logo URL> → the image, cached for a week. */
export async function GET(request: NextRequest) {
  const u = request.nextUrl.searchParams.get('u') ?? '';
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  // Re-check after parsing: no «..», credentials or another host slipping past the prefix.
  if (!isProxiedIcon(url.href) || url.username || url.password || url.pathname.includes('..')) return new NextResponse(null, { status: 400 });
  try {
    let res = await fetch(url.href, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    // A host that limits bursts (Euler's images: 403) usually answers the same request a moment later.
    if (res.status === 403 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 600));
      res = await fetch(url.href, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return new NextResponse(null, { status: 502 });
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new NextResponse(null, { status: 502 });
    return new NextResponse(body, {
      headers: {
        'Content-Type': type,
        // Uploads have unique names: they never change.
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
        // An SVG opened directly must not run anything.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
