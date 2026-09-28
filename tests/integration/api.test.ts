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
    underlyingAsset: { mint: 'MintHy', ticker: 'hyUSD' },
    totalMarketSize: 500_000,
    ptPriceInAsset: 0.97,
    ytPriceInAsset: 0.03,
    impliedApy: (1 / 0.97) ** (365 / 90) - 1,
    underlyingApy: 0.1,
    maturityDateUnixTs: maturityTs,
    marketStatus: 'active',
    pointsBoost: { points_name: 'Hylo XP', points_per_day: 1, yt_multiplier: 8, lp_multiplier: 2, is_active: true, type: 'usd', season: 1 },
  },
  { vaultAddress: 'VaultExpired', tokenName: 'old', marketStatus: 'expired' },
  {
    vaultAddress: 'VaultNoPoints',
    tokenName: 'fragSOL',
    ptPriceInAsset: 0.99,
    ytPriceInAsset: 0.01,
    impliedApy: 0.02,
    underlyingApy: 0.05,
    maturityDateUnixTs: maturityTs,
    marketStatus: 'active',
    pointsBoost: null,
  },
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
  protocol: 'Lido',
  categoryIds: ['eth', 'points'],
};

const SPECTRA_PT = '0x' + '1'.repeat(40);
const spectraMarkets = [
  {
    address: SPECTRA_PT,
    maturity: maturityTs,
    createdAt: Math.floor(Date.now() / 1000) - 86_400,
    tags: ['stable'],
    tvl: { usd: 12_000 },
    ibt: { symbol: 'sw-WUSDN', protocol: 'SMARDEX', logoURI: 'https://tokens.spectra.finance/sw.png', apr: { total: 11.6 } },
    baseIbt: { symbol: 'WUSDN', logoURI: 'https://tokens.spectra.finance/wusdn.png' },
    underlying: { symbol: 'USDN', price: { usd: 1.01 } },
    pools: [
      { liquidity: { underlying: 100, usd: 101 }, impliedApy: 30, ptPrice: { underlying: 0.9 }, ytPrice: { underlying: 0.1 } },
      { liquidity: { underlying: 8900, usd: 9000 }, impliedApy: 24.4, ptPrice: { underlying: 0.94 }, ytPrice: { underlying: 0.06 } },
    ],
  },
];

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
      pointsStatus: 'active',
      platform: 'Hylo',
      points: { name: 'Hylo XP', pointsPerDay: 1, basis: 'usd', ytMultiplier: 8, lpMultiplier: 2, season: 1 },
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
    expect(market.pointsStatus).toBe('active');
    expect(market.platform).toBe('Lido');
    expect(history).toHaveLength(3);
    expect(history[2]).toBeCloseTo(2.26);
  });

  it('routes chain-prefixed Pendle ids to the right chain', async () => {
    const fetchFn = mockFetch({ [`/v1/42161/markets/${PENDLE_ADDR}`]: { body: pendleMarket } });
    const res = await getMarket(req(`/api/pendle/42161-${PENDLE_ADDR}`), ctx({ protocol: 'pendle', market: `42161-${PENDLE_ADDR}` }));
    expect(res.status).toBe(200);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/v1/42161/');
  });

  it('reports Exponent markets without a points campaign as having none', async () => {
    mockFetch({ 'api.exponent.finance/markets': { body: exponentMarkets } });
    const res = await getMarket(req('/api/exponent/VaultNoPoints'), ctx({ protocol: 'exponent', market: 'VaultNoPoints' }));
    const { market } = await res.json();
    expect(market.pointsStatus).toBe('none');
    expect(market.points).toBeNull();
  });

  it('returns 404 for malformed Pendle ids and unknown markets', async () => {
    mockFetch({ 'api.exponent.finance/markets': { body: exponentMarkets } });
    expect((await getMarket(req('/api/pendle/nope'), ctx({ protocol: 'pendle', market: 'nope' }))).status).toBe(404);
    expect((await getMarket(req('/api/exponent/missing'), ctx({ protocol: 'exponent', market: 'missing' }))).status).toBe(404);
  });

  it('maps Spectra market data from the deepest pool', async () => {
    mockFetch({ 'api.spectra.finance/v1/base/pools': { body: spectraMarkets } });
    const id = `base-${SPECTRA_PT}`;
    const res = await getMarket(req(`/api/spectra/${id}?history=30`), ctx({ protocol: 'spectra', market: id }));
    expect(res.status).toBe(200);
    const { market, history } = await res.json();
    expect(market).toMatchObject({
      protocol: 'spectra',
      marketId: id,
      name: 'WUSDN',
      platform: 'SMARDEX',
      chain: 'Base',
      icon: 'https://tokens.spectra.finance/wusdn.png',
      ptPrice: 0.94,
      ytPrice: 0.06,
      impliedAPY: 24.4,
      baseAPY: 11.6,
      underlyingPrice: 1.01,
      liquidity: 9000,
      marketSizeUnits: 8900,
      pointsStatus: 'unknown',
    });
    expect(history).toBeNull();
  });

  it('keeps the user’s base APY when Spectra reports none', async () => {
    const noApr = [{ ...spectraMarkets[0], ibt: { ...spectraMarkets[0].ibt, apr: { total: null } } }];
    mockFetch({ 'api.spectra.finance/v1/base/pools': { body: noApr } });
    const id = `base-${SPECTRA_PT}`;
    const { market } = await (await getMarket(req(`/api/spectra/${id}`), ctx({ protocol: 'spectra', market: id }))).json();
    expect(market.baseAPY).toBeNull(); // NaN serialises to null
    const p = mergeMarketData({ ...defaultScenario(), baseAPY: 7 }, { ...market, baseAPY: NaN }, null);
    expect(p.baseAPY).toBe(7);
  });

  it('rejects malformed Spectra ids and unknown networks', async () => {
    for (const id of ['nope', `polygon-${SPECTRA_PT}`]) {
      expect((await getMarket(req(`/api/spectra/${id}`), ctx({ protocol: 'spectra', market: id }))).status).toBe(404);
    }
  });

  it('returns 404 for unknown and removed protocols', async () => {
    for (const protocol of ['foo', 'sense']) {
      const res = await getMarket(req(`/api/${protocol}/x`), ctx({ protocol, market: 'x' }));
      expect(res.status).toBe(404);
    }
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
  it('lists active Exponent markets with logos, USD size and points', async () => {
    mockFetch({
      'api.exponent.finance/markets': { body: exponentMarkets },
      'lite-api.jup.ag': {
        body: [{ id: 'MintHy', symbol: 'hyUSD', icon: 'https://logo/hy.png', usdPrice: 1 }],
      },
    });
    const res = await listMarkets(req('/api/exponent'), ctx({ protocol: 'exponent' }));
    const { markets } = await res.json();
    expect(markets).toHaveLength(2);
    const hy = markets.find((m: { id: string }) => m.id === 'VaultActive111');
    expect(hy).toMatchObject({
      name: 'hyUSD',
      platform: 'Hylo',
      chain: 'Solana',
      icon: 'https://logo/hy.png',
      liquidity: 500_000,
      hasPoints: true,
      ytMultiplier: 8,
      expired: false,
    });
    expect(markets.find((m: { id: string }) => m.id === 'VaultNoPoints').hasPoints).toBe(false);
  });

  it('still lists Exponent markets when the logo service is down', async () => {
    mockFetch({ 'api.exponent.finance/markets': { body: exponentMarkets }, 'lite-api.jup.ag': { status: 500, body: {} } });
    const res = await listMarkets(req('/api/exponent'), ctx({ protocol: 'exponent' }));
    const { markets } = await res.json();
    expect(markets).toHaveLength(2);
    expect(markets[0].icon).toBeNull();
  });

  it('merges Pendle markets across chains, follows pagination and tolerates a failing chain', async () => {
    const row = (address: string, liquidity: number, extra = {}) => ({
      address,
      expiry: '2099-01-01T00:00:00.000Z',
      proName: address.toUpperCase(),
      proIcon: `https://icons/${address}.svg`,
      protocol: 'Proto',
      impliedApy: 0.05,
      underlyingApy: 0.04,
      liquidity: { usd: liquidity },
      categoryIds: ['stables'],
      ...extra,
    });
    const page1 = Array.from({ length: 100 }, (_, i) => row(`0x${i}`, 1));
    mockFetch({
      '/v1/1/markets?is_active=true&limit=100&skip=0': { body: { total: 101, results: page1 } },
      '/v1/1/markets?is_active=true&limit=100&skip=100': { body: { total: 101, results: [row('0xlast', 5, { isNew: true })] } },
      '/v1/42161/markets?is_active=true&limit=100&skip=0': {
        body: { total: 1, results: [row('0xb', 20, { categoryIds: ['points', 'eth'] })] },
      },
      '/v1/8453/markets': { status: 500, body: {} },
    });
    const res = await listMarkets(req('/api/pendle'), ctx({ protocol: 'pendle' }));
    expect(res.status).toBe(200);
    const { markets } = await res.json();
    expect(markets).toHaveLength(102);
    // Sorted by liquidity; chain names and tags mapped.
    expect(markets[0]).toMatchObject({ id: '42161-0xb', chain: 'Arbitrum', hasPoints: true, icon: 'https://icons/0xb.svg' });
    expect(markets[1]).toMatchObject({ id: '1-0xlast', isNew: true, chain: 'Ethereum' });
  });
});

describe('GET /api/pendle chain discovery', () => {
  it('lists markets on every chain the Pendle API reports, naming unknown chains by id', async () => {
    const row = (address: string, liquidity: number) => ({
      address,
      expiry: '2099-01-01T00:00:00.000Z',
      proName: address,
      impliedApy: 0.05,
      liquidity: { usd: liquidity },
    });
    const fetchFn = mockFetch({
      '/v1/chains': { body: { chainIds: [1, 999, 777777] } },
      '/v1/1/markets': { body: { total: 1, results: [row('0xeth', 3)] } },
      '/v1/999/markets': { body: { total: 1, results: [row('0xhype', 2)] } },
      '/v1/777777/markets': { body: { total: 1, results: [row('0xnew', 1)] } },
    });
    const res = await listMarkets(req('/api/pendle'), ctx({ protocol: 'pendle' }));
    const { markets } = await res.json();
    expect(markets.map((m: { id: string; chain: string }) => [m.id, m.chain])).toEqual([
      ['1-0xeth', 'Ethereum'],
      ['999-0xhype', 'HyperEVM'],
      ['777777-0xnew', 'Chain 777777'],
    ]);
    // Only the discovered chains are queried — no fallback list.
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes('/v1/42161/'))).toBe(false);
  });
});

describe('GET /api/spectra', () => {
  it('lists markets across networks, skips pools without a price and tolerates failing networks', async () => {
    const noPool = { ...spectraMarkets[0], address: '0x' + '2'.repeat(40), pools: [] };
    mockFetch({
      'api.spectra.finance/v1/base/pools': { body: [...spectraMarkets, noPool] },
      'api.spectra.finance/v1/mainnet/pools': { status: 500, body: {} },
    });
    const res = await listMarkets(req('/api/spectra'), ctx({ protocol: 'spectra' }));
    expect(res.status).toBe(200);
    const { markets } = await res.json();
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({
      id: `base-${SPECTRA_PT}`,
      chain: 'Base',
      impliedAPY: 24.4,
      baseAPY: 11.6,
      liquidity: 9000,
      categories: ['stables'],
      isNew: true,
      expired: false,
    });
  });
});

describe('market lifecycle', () => {
  it('flags matured markets as expired and sorts them last, even if upstream still lists them', async () => {
    const past = { ...exponentMarkets[0], vaultAddress: 'VaultOld', maturityDateUnixTs: Math.floor(Date.now() / 1000) - 86_400 };
    mockFetch({ 'api.exponent.finance/markets': { body: [past, ...exponentMarkets] } });
    const { markets } = await (await listMarkets(req('/api/exponent'), ctx({ protocol: 'exponent' }))).json();
    const last = markets[markets.length - 1];
    expect(last).toMatchObject({ id: 'VaultOld', expired: true, daysToMaturity: 0 });
    expect(markets.filter((m: { expired: boolean }) => !m.expired)).toHaveLength(2);
  });

  it('marks recently opened Exponent markets as new', async () => {
    const fresh = { ...exponentMarkets[0], vaultAddress: 'VaultNew', startDateUnixTs: Math.floor(Date.now() / 1000) - 3600 };
    mockFetch({ 'api.exponent.finance/markets': { body: [fresh] } });
    const { markets } = await (await listMarkets(req('/api/exponent'), ctx({ protocol: 'exponent' }))).json();
    expect(markets[0].isNew).toBe(true);
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
      marketSizeUnits: null,
      volume24h: null,
      pointsStatus: 'active',
      points: { name: 'Hylo XP', pointsPerDay: 1, basis: 'usd', ytMultiplier: 8, lpMultiplier: 2, season: 1 },
      platform: 'Hylo',
      icon: null,
      chain: 'Solana',
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
