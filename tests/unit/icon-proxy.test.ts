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

  it('also takes Euler\'s token images and Upshift\'s logos (403 to a burst of requests)', () => {
    const euler = 'https://v3.euler.finance/v3/images/tokens/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const upshift = 'https://imagedelivery.net/JKqfgGWnlUbSJb3LhpWg6w/token-logo/sentusd-dark.svg/public';
    expect(iconSrc(euler)).toBe(`/api/icon?u=${encodeURIComponent(euler)}`);
    expect(iconSrc(upshift)).toBe(`/api/icon?u=${encodeURIComponent(upshift)}`);
    // Only Euler's token images and Upshift's own account, not the rest of either host.
    expect(iconSrc('https://v3.euler.finance/v3/evk/vaults')).toBe('https://v3.euler.finance/v3/evk/vaults');
    expect(iconSrc('https://imagedelivery.net/other-account/x/public')).toBe('https://imagedelivery.net/other-account/x/public');
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
