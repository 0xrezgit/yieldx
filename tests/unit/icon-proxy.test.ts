import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { iconSrc } from '../../src/lib/market/icon-proxy';
import { GET } from '../../src/app/api/icon/route';

const PENDLE = 'https://storage.googleapis.com/prod-pendle-bucket-a/images/uploads/abc.svg';
const req = (u: string) => new NextRequest(`http://localhost/api/icon?u=${encodeURIComponent(u)}`);

describe('Pendle icons through the server', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends only the blocked host through /api/icon', () => {
    expect(iconSrc(PENDLE)).toBe(`/api/icon?u=${encodeURIComponent(PENDLE)}`);
    expect(iconSrc('https://assets.coingecko.com/x.png')).toBe('https://assets.coingecko.com/x.png');
  });

  it('is never an open proxy', async () => {
    for (const u of ['https://example.com/x.svg', 'https://storage.googleapis.com/other-bucket/x.svg', 'https://storage.googleapis.com/prod-pendle-bucket-a/../other/x.svg', 'not a url']) {
      expect((await GET(req(u))).status).toBe(400);
    }
  });

  it('returns the image with a long cache and no script', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })));
    const res = await GET(req(PENDLE));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('cache-control')).toContain('max-age=604800');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses what is not an image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error/>', { status: 403, headers: { 'content-type': 'application/xml' } })));
    expect((await GET(req(PENDLE))).status).toBe(502);
  });
});
