import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import boxes from '../fixtures/pendle-longshort.json';
import kamino from '../fixtures/kamino-multiply.json';
import { longShortRow } from '../../src/lib/longshort/feed';
import type { MultiplyRow } from '../../src/lib/multiply/types';
import { assetsOf, DEFAULT_INPUT, offersFor, rank } from '../../src/lib/leverage/model';
import type { LeverageFeed } from '../../src/lib/leverage/types';
import { mergeFeed, OfferRow } from '../../src/components/tools/LeverageTool';

type Box = Parameters<typeof longShortRow>[0];
const perp = (coin: string) => ({ venue: 'Hyperliquid' as const, coin, fundingNowPct: 10.9, funding7dPct: 9.5, maxLeverage: 20, markPx: 100, url: `https://app.hyperliquid.xyz/trade/${coin}` });
const feed: LeverageFeed = {
  kamino: kamino as unknown as MultiplyRow[],
  kaminoError: null,
  pendle: (boxes as unknown as Box[]).map((b) => longShortRow(b)!).filter(Boolean),
  pendleError: null,
  perps: { BTC: perp('BTC'), ETH: perp('ETH'), SOL: perp('SOL'), 'xyz:TSLA': perp('xyz:TSLA') },
  perpError: null,
  fetchedAt: '2026-11-07T00:00:00.000Z',
};

describe('معامله‌ی اهرمی rows', () => {
  it.each(assetsOf(feed, 'long').map((a) => [a.asset] as const))('renders every %s offer in Persian, without NaN', (asset) => {
    const r = rank(offersFor(feed, asset, { ...DEFAULT_INPUT, leverage: 3 }), 1000);
    const html = r.offers.map((o, i) => renderToStaticMarkup(<OfferRow o={o} on={i === 0} star={r.best[0] === o.key ? 'best' : null} gap={o.cost.totalUsd - r.offers[0].cost.totalUsd} onPick={() => {}} />)).join('');
    expect(html).not.toContain('NaN');
    expect(html).not.toMatch(/eip155:|solana:mainnet/);
    expect(html).toContain('دلار');
  });

  it('a perp row names its funding, a stock loop its frozen weekend price, a blocked one its limit', () => {
    const offers = offersFor(feed, 'TSLA', { ...DEFAULT_INPUT, leverage: 5 });
    const html = offers.map((o) => renderToStaticMarkup(<OfferRow o={o} on={false} star={null} gap={0} onPick={() => {}} />)).join('');
    expect(html).toContain('TSLA-PERP');
    expect(html).toContain('فاندینگ');
    expect(html).toContain('آخر هفته قیمت ثابت');
    expect(html).toContain('سقف اهرم');
  });
});

describe('a source still loading keeps the rows it had', () => {
  it('pending Kamino keeps the previous Kamino rows; a real answer replaces them', () => {
    const next = { ...feed, kamino: [], kaminoError: 'pending' };
    expect(mergeFeed(feed, next).kamino).toBe(feed.kamino);
    expect(mergeFeed(feed, { ...feed, kamino: [] }).kamino).toEqual([]);
  });
});

describe('every row has its own logos', () => {
  it('token (a stock by its ticker, a perp by its underlying), network and platform', async () => {
    const { assetLogo, platformLogo, tokenLogo } = await import('../../src/lib/leverage/logos');
    for (const side of ['long', 'short'] as const)
      for (const a of assetsOf(feed, side)) {
        expect(assetLogo(a.asset, a.kind) ?? a.icon, a.asset).toBeTruthy();
        for (const o of offersFor(feed, a.asset, { ...DEFAULT_INPUT, side })) {
          const logo = o.venue === 'perp' ? assetLogo(o.asset, o.kind) : tokenLogo(o.token, o.tokenIcon, o.kind);
          expect(logo, o.token).toBeTruthy();
          expect(logo).not.toContain('/ipfs/');
          expect(platformLogo(o.protocol, o.protocolIcon), o.protocol).toBeTruthy();
        }
      }
    expect(tokenLogo('TSLAc', null, 'stocks')).toContain('/TSLA.png');
    expect(platformLogo('Kamino')).toContain('kamino-lend');
  });
});
