import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import config from '../../src/config/tokens.json';
import pendle from '../../src/config/protocols.json';
import { nativeToken, tokenInfo, tokensForChain } from '../../src/lib/portfolio/tokens';
import { GET as getPrices } from '../../src/app/api/prices/route';
import { valuePosition } from '../../src/lib/portfolio/valuation';
import { dollarNumber, formatDollar } from '../../src/lib/portfolio/format';
import { emptyManual, emptyTargets, type Position } from '../../src/types/position';

describe('payment tokens', () => {
  it('every listed token has a logo and a price id; every chain list resolves', () => {
    for (const t of Object.values(config.tokens)) {
      expect(t.logo).toMatch(/^https:\/\//);
      expect(t.coingeckoId).toBeTruthy();
    }
    for (const list of Object.values(config.chains)) for (const s of list) expect(tokenInfo(s)).not.toBeNull();
  });

  it('covers every chain the adapters report', () => {
    const chains = [...Object.values(pendle.pendle.chainNames), ...Object.values(pendle.spectra.networks), 'Solana'];
    for (const c of chains) expect(Object.keys(config.chains)).toContain(c);
  });

  it('offers the chain tokens with the native token first, keeping official symbols', () => {
    const eth = tokensForChain('Ethereum').map((t) => t.symbol);
    expect(eth[0]).toBe('ETH');
    expect(eth).toEqual(expect.arrayContaining(['WBTC', 'USDC', 'USDT', 'USDe', 'USDG']));
    expect(tokensForChain('Solana').map((t) => t.symbol)).toEqual(expect.arrayContaining(['SOL', 'USDC', 'USDG']));
    expect(nativeToken('BNB Chain')).toBe('BNB');
    expect(tokenInfo('usde')?.symbol).toBe('USDe');
  });

  it('puts the market asset first, with the market icon when it is unlisted', () => {
    const list = tokensForChain('Ethereum', { symbol: 'reUSD', icon: 'https://x/re.png' });
    expect(list[0]).toMatchObject({ symbol: 'reUSD', logo: 'https://x/re.png', coingeckoId: null });
    expect(tokensForChain('Ethereum', { symbol: 'usdc' })[0].symbol).toBe('USDC');
  });
});

describe('GET /api/prices', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps symbols to price ids, current or historical', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ coins: { 'coingecko:ethereum': { price: 3000, timestamp: 1735689600 }, 'coingecko:global-dollar': { price: 1, timestamp: 1735689600 } } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await getPrices(new NextRequest('http://x/api/prices?symbols=ETH,USDG,NOPE&at=1735689600'));
    const body = await res.json();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/historical/1735689600/coingecko:ethereum,coingecko:global-dollar');
    expect(body.prices.ETH.usd).toBe(3000);
    expect(body.prices.USDG.usd).toBe(1);
    expect(body.prices.NOPE).toBeUndefined();

    await getPrices(new NextRequest('http://x/api/prices?symbols=ETH'));
    expect(String(fetchMock.mock.calls[1][0])).toContain('/current/coingecko:ethereum');
  });

  it('rejects future times and reports upstream failure', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400;
    expect((await getPrices(new NextRequest(`http://x/api/prices?symbols=ETH&at=${future}`))).status).toBe(400);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect((await getPrices(new NextRequest('http://x/api/prices?symbols=ETH'))).status).toBe(502);
  });
});

describe('loop debt in another token', () => {
  it('values the debt at the live price of the debt token', () => {
    const at = new Date(Date.now() - 1000).toISOString();
    const p: Position = {
      id: 'l', createdAt: at, updatedAt: at, kind: 'loop', protocol: 'pendle', chain: 'Ethereum', marketId: 'm', marketName: 'weETH', platform: '', icon: '',
      maturity: new Date(Date.now() + 100 * 86_400_000).toISOString(), assetSymbol: 'ETH',
      events: [
        { id: 'b', type: 'borrow', at, units: 0, cash: { amount: 3000, token: 'USDC', usdRate: 1, rateSource: 'historical' }, assetUsd: 3000, assetUsdSource: 'historical', fees: [], note: '' },
        { id: 'p', type: 'buy', at, units: 2, cash: { amount: 2, token: 'ETH', usdRate: 3000, rateSource: 'historical' }, assetUsd: 3000, assetUsdSource: 'historical', fees: [], note: '' },
      ],
      loop: { lendingPlatform: 'Morpho', lendingMarket: '', debtAsset: 'USDC', debtIsAccountingAsset: false, debtAssetUsd: 1, borrowAPY: 0, lltv: 86, oracle: 'market', oraclePtPrice: null, debtOverride: null },
      manual: emptyManual(), targets: emptyTargets(), points: { perDay: 0, multiplier: 1, basis: 'unit', valuePerPoint: 0 }, snapshots: [], note: '',
    };
    const q = { ptPrice: 1, ytPrice: 0, assetUsd: 3000, impliedAPY: 5, baseAPY: 3, liquidity: 1e8, fetchedAt: new Date().toISOString(), history: null };
    expect(valuePosition(p, q, Date.now()).debtUsd.value).toBeCloseTo(3000, 6);
    expect(valuePosition(p, q, Date.now(), undefined, 0.98).debtUsd.value).toBeCloseTo(2940, 6);
  });
});

describe('dollar formatting', () => {
  it('writes «دلار» with Persian digits and never a signed zero', () => {
    // The number is bidi-isolated (LRI…PDI) so a minus sign stays attached in RTL text.
    expect(formatDollar(1234.5)).toBe('\u2066۱٬۲۳۴٫۵\u2069 دلار');
    expect(dollarNumber(-4.06)).toBe('−۴٫۰۶');
    expect(dollarNumber(-0.001)).toBe('۰');
    expect(formatDollar(12)).not.toContain('$');
  });
});
