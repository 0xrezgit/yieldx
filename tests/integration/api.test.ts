import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMarket } from '../../src/app/api/[protocol]/[market]/route';
import { GET as listMarkets } from '../../src/app/api/[protocol]/route';
import { GET as getScenarios } from '../../src/app/api/scenarios/route';
import { GET as getAlerts } from '../../src/app/api/alerts/route';
import { mergeMarketData } from '../../src/lib/data/market-data';
import { analyzeScenario } from '../../src/lib/analysis';
import { defaultScenario } from '../../src/types/scenario';
import type { MarketData } from '../../src/types/market';

const DAY = 86_400_000;
const maturityTs = Math.floor((Date.now() + 90 * DAY) / 1000);
const PENDLE_ADDR = '0x34280882267ffa6383b363e278b027be083bbe3b';

const exponentMarkets = [
  {
    vaultAddress: 'VaultActive111',
    tokenName: 'hyUSD',
    platformName: 'Hylo',
    ptPriceInAsset: 0.97,
    ytPriceInAsset: 0.03,
    impliedApy: (1 / 0.97) ** (365 / 90) - 1,
    underlyingApy: 0.1,
    maturityDateUnixTs: maturityTs,
    marketStatus: 'active',
    pointsBoost: { points_name: 'Hylo XP', points_per_day: 1, yt_multiplier: 8, lp_multiplier: 2, is_active: true },
  },
  { ...{ vaultAddress: 'VaultExpired', tokenName: 'old', marketStatus: 'expired' } },
];

const pendleMarket = {
  expiry: new Date(maturityTs * 1000).toISOString(),
  proName: 'wstETH',
  ptDiscount: 0.025,
  impliedApy: 0.0215,
  underlyingApy: 0.0226,
  liquidity: { usd: 5_300_000, acc: 1989 },
  tradingVolume: { usd: 12_000 },
  accountingAsset: { symbol: 'stETH', price: { usd: 2672.2 } },
};

const pendleHistory = { underlyingApy: ['0.0200', '0.0210', '0.0220', '0.0226'] };

type Routes = Record<string, { status?: number; body: unknown }>;

function mockFetch(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response('not found', { status: 404 });
    const [, { status = 200, body }] = hit;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const req = (path: string) => new NextRequest(new URL(path, 'http://localhost'));
const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/:protocol/:market', () => {
  it('maps Exponent market data, including the points program', async () => {
    mockFetch({ 'api.exponent.finance/markets': { body: exponentMarkets } });
    const res = await getMarket(req('/api/exponent/VaultActive111?history=30'), ctx({ protocol: 'exponent', market: 'VaultActive111' }));
    expect(res.status).toBe(200);
    const { market, history } = await res.json();
    expect(market).toMatchObject({
      protocol: 'exponent',
      name: 'hyUSD',
      ptPrice: 0.97,
      ytPrice: 0.03,
      baseAPY: 10,
      underlyingPrice: null,
      points: { name: 'Hylo XP', pointsPerDay: 1, ytMultiplier: 8, lpMultiplier: 2 },
    });
    // Exponent has no daily history — reported as null, not an error.
    expect(history).toBeNull();
  });

  it('maps Pendle market data and daily history', async () => {
    mockFetch({
      [`/markets/${PENDLE_ADDR}/historical-data`]: { body: pendleHistory },
      [`/v1/1/markets/${PENDLE_ADDR}`]: { body: pendleMarket },
    });
    const res = await getMarket(req(`/api/pendle/${PENDLE_ADDR}?history=3`), ctx({ protocol: 'pendle', market: PENDLE_ADDR }));
    expect(res.status).toBe(200);
    const { market, history } = await res.json();
    expect(market.marketId).toBe(`1-${PENDLE_ADDR}`);
    expect(market.ptPrice).toBeCloseTo(0.975);
    expect(market.ytPrice).toBeCloseTo(0.025);
    expect(market.baseAPY).toBeCloseTo(2.26);
    expect(market.impliedAPY).toBeCloseTo(2.15);
    expect(market.underlyingPrice).toBeCloseTo(2672.2);
    expect(market.liquidity).toBe(5_300_000);
    expect(market.volume24h).toBe(12_000);
    expect(history).toHaveLength(3);
    expect(history[2]).toBeCloseTo(2.26);
  });

  it('routes chain-prefixed Pendle ids to the right chain', async () => {
    const fetchFn = mockFetch({ [`/v1/42161/markets/${PENDLE_ADDR}`]: { body: pendleMarket } });
    const res = await getMarket(req(`/api/pendle/42161-${PENDLE_ADDR}`), ctx({ protocol: 'pendle', market: `42161-${PENDLE_ADDR}` }));
    expect(res.status).toBe(200);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/v1/42161/');
  });

  it('returns 404 for malformed Pendle ids and unknown markets', async () => {
    mockFetch({ 'api.exponent.finance/markets': { body: exponentMarkets } });
    expect((await getMarket(req('/api/pendle/nope'), ctx({ protocol: 'pendle', market: 'nope' }))).status).toBe(404);
    expect((await getMarket(req('/api/exponent/missing'), ctx({ protocol: 'exponent', market: 'missing' }))).status).toBe(404);
  });

  it('returns 501 for manual-only protocols', async () => {
    const res = await getMarket(req('/api/spectra/x'), ctx({ protocol: 'spectra', market: 'x' }));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe('manual_only');
  });

  it('returns 404 for unknown protocols', async () => {
    const res = await getMarket(req('/api/foo/x'), ctx({ protocol: 'foo', market: 'x' }));
    expect(res.status).toBe(404);
  });

  it('returns 502 when the upstream API fails', async () => {
    mockFetch({ 'api.exponent.finance/markets': { status: 500, body: {} } });
    const res = await getMarket(req('/api/exponent/VaultActive111'), ctx({ protocol: 'exponent', market: 'VaultActive111' }));
    expect(res.status).toBe(502);
  });

  it('validates the history parameter', async () => {
    const res = await getMarket(req('/api/exponent/v?history=9999'), ctx({ protocol: 'exponent', market: 'v' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/:protocol', () => {
  it('lists only active Exponent markets', async () => {
    mockFetch({ 'api.exponent.finance/markets': { body: exponentMarkets } });
    const res = await listMarkets(req('/api/exponent'), ctx({ protocol: 'exponent' }));
    const { markets } = await res.json();
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({ id: 'VaultActive111', name: 'hyUSD · Hylo', hasPoints: true });
  });

  it('merges Pendle markets across chains and tolerates a failing chain', async () => {
    mockFetch({
      '/v1/1/markets/active': {
        body: { markets: [{ name: 'A', address: '0xa', expiry: '2027-01-01', details: { liquidity: 10, impliedApy: 0.05 } }] },
      },
      '/v1/42161/markets/active': {
        body: { markets: [{ name: 'B', address: '0xb', expiry: '2027-01-01', details: { liquidity: 20, impliedApy: 0.06 }, categoryIds: ['points'] }] },
      },
      '/v1/8453/markets/active': { status: 500, body: {} },
    });
    const res = await listMarkets(req('/api/pendle'), ctx({ protocol: 'pendle' }));
    expect(res.status).toBe(200);
    const { markets } = await res.json();
    expect(markets.map((m: { id: string }) => m.id)).toEqual(['42161-0xb', '1-0xa']); // sorted by liquidity
    expect(markets[0].hasPoints).toBe(true);
  });
});

describe('persistence routes without a database', () => {
  it('answer 503 so the client falls back to localStorage', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect((await getScenarios(new Request('http://localhost/api/scenarios'))).status).toBe(503);
    expect((await getAlerts()).status).toBe(503);
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  });
});

describe('fetched data → analysis', () => {
  it('reproduces the protocol’s own implied APY from its PT price', () => {
    const m: MarketData = {
      protocol: 'exponent',
      marketId: 'VaultActive111',
      name: 'hyUSD',
      underlyingPrice: null,
      ptPrice: 0.97,
      ytPrice: 0.03,
      impliedAPY: ((1 / 0.97) ** (365 / 90) - 1) * 100,
      baseAPY: 10,
      maturity: new Date(maturityTs * 1000).toISOString(),
      daysToMaturity: 90,
      liquidity: null,
      volume24h: null,
      points: { name: 'Hylo XP', pointsPerDay: 1, ytMultiplier: 8, lpMultiplier: 2 },
      fetchedAt: new Date().toISOString(),
    };
    const p = mergeMarketData(defaultScenario(), m, null);
    expect(p.underlyingPrice).toBe(defaultScenario().underlyingPrice); // kept when the API has none
    expect(p.ytMultiplier).toBe(8);
    const a = analyzeScenario(p);
    expect(a.validation.valid).toBe(true);
    // Maturity is truncated to a date, so allow a day of drift.
    expect(Math.abs(a.implied.impliedAPY - m.impliedAPY)).toBeLessThan(0.2);
  });
});
