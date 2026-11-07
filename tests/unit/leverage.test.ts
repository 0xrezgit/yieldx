import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import boxes from '../fixtures/pendle-longshort.json';
import kamino from '../fixtures/kamino-multiply.json';
import { longShortRow } from '../../src/lib/longshort/feed';
import { analyzeLongShort } from '../../src/lib/longshort/model';
import type { PerpRef } from '../../src/lib/longshort/types';
import type { MultiplyRow } from '../../src/lib/multiply/types';
import { underlyingOf } from '../../src/lib/leverage/assets';
import { assetsOf, DEFAULT_INPUT, kaminoOffer, offersFor, pendleOffer, perpOffer, rank, tieUsd, type LeverageInput, type Offer } from '../../src/lib/leverage/model';
import type { LeverageFeed } from '../../src/lib/leverage/types';

type Box = Parameters<typeof longShortRow>[0];
const pendle = (boxes as unknown as Box[]).map((b) => longShortRow(b)!).filter(Boolean);
const kaminoRows = kamino as unknown as MultiplyRow[];
const perp = (coin: string, funding: number, maxLeverage = 20): PerpRef => ({ venue: 'Hyperliquid', coin, fundingNowPct: funding, funding7dPct: funding, maxLeverage, markPx: 100, url: `https://app.hyperliquid.xyz/trade/${coin}` });
const feed: LeverageFeed = {
  kamino: kaminoRows,
  kaminoError: null,
  pendle,
  pendleError: null,
  perps: { BTC: perp('BTC', 10.95, 40), ETH: perp('ETH', 10.95, 25), SOL: perp('SOL', 10.95, 20), HYPE: perp('HYPE', 10.95, 10), 'xyz:TSLA': perp('xyz:TSLA', 8, 10) },
  perpError: null,
  fetchedAt: '2026-11-07T00:00:00.000Z',
};
const input = (over: Partial<LeverageInput> = {}): LeverageInput => ({ ...DEFAULT_INPUT, ...over });

describe('one underlying for many tokens', () => {
  it.each([
    ['cbBTC', undefined, 'BTC', 'BTC', true],
    ['xBTC', undefined, 'BTC', 'BTC', true],
    ['WBTC', 'crypto', 'BTC', 'BTC', true],
    ['wstETH', 'crypto', 'ETH', 'ETH', false],
    ['JITOSOL', undefined, 'SOL', 'SOL', false],
    ['SOL', undefined, 'SOL', 'SOL', true],
    ['TSLAx', undefined, 'TSLA', 'xyz:TSLA', true],
    ['TSLAc', 'stocks', 'TSLA', 'xyz:TSLA', true],
    ['SPYx', undefined, 'SPY', 'xyz:SP500', false],
    ['JLP', undefined, 'JLP', null, false],
    ['PAX Gold', undefined, 'PAXG', 'PAXG', true],
  ] as const)('%s → %s', (symbol, kind, asset, coin, exact) => {
    const u = underlyingOf(symbol, kind);
    expect(u?.asset).toBe(asset);
    expect(u?.perp).toBe(coin);
    expect(u?.exact).toBe(exact);
  });

  it('QQQ has no perp of its own; an unknown crypto symbol is not taken for a stock', () => {
    expect(underlyingOf('QQQx')?.perp).toBeNull();
    expect(underlyingOf('USDC', 'crypto')).toBeNull();
  });

  it('groups every loop market under its underlying, majors first', () => {
    const assets = assetsOf(feed).map((a) => a.asset);
    expect(assets.slice(0, 3)).toEqual(['BTC', 'ETH', 'SOL']);
    expect(assets).toContain('TSLA');
    expect(assets).toContain('JLP');
    expect(assetsOf(feed).find((a) => a.asset === 'JLP')!.perp).toBeNull();
  });
});

describe('the cost of holding, per venue', () => {
  it('a perp pays funding on the whole position: 3× at 10.95 % for a year ≈ 33 % of the capital', () => {
    const o = perpOffer(perp('BTC', 10.95, 40), 'BTC', 'crypto', input({ leverage: 3, days: 365, perpFeePct: 0 }));
    expect(o.cost.fundingUsd).toBeCloseTo(1000 * 0.3285, 0);
    expect(o.cost.totalUsd).toBeCloseTo(o.cost.fundingUsd, 6);
    expect(o.breakEvenMove).toBeCloseTo(o.cost.totalUsd / 3000, 9);
  });

  it('a short perp is paid positive funding', () => {
    const o = perpOffer(perp('BTC', 10.95, 40), 'BTC', 'crypto', input({ side: 'short', leverage: 2, days: 365, perpFeePct: 0 }));
    expect(o.cost.fundingUsd).toBeLessThan(0);
  });

  it('a PendleLoop market costs what the Long/Short page says, split into its parts', () => {
    for (const row of pendle) {
      const i = input({ side: row.side, leverage: 2, days: 90 });
      const o = pendleOffer(row, i)!;
      const a = analyzeLongShort(row, i);
      expect(o.cost.totalUsd).toBeCloseTo(a.tradeCostUsd - a.holdingUsd, 6);
      expect(o.cost.swapUsd + o.cost.feeUsd).toBeCloseTo(a.tradeCostUsd, 6);
      expect(o.liqMove).toBeCloseTo(a.liqMove, 9);
    }
  });

  it('a Kamino pair: interest on the borrowed part, yield on the whole collateral, swaps both ways plus the flash-loan fee', () => {
    const row = kaminoRows.find((r) => r.collateral.symbol === 'JITOSOL')!;
    const o = kaminoOffer(row, input({ leverage: 2, days: 365, swapPct: 0.1 }))!;
    expect(o.cost.interestUsd).toBeCloseTo(1000 * (row.borrowPct / 100), 6);
    expect(o.cost.yieldUsd).toBeCloseTo(2000 * (row.collateralYieldPct / 100), 6);
    expect(o.cost.swapUsd).toBeCloseTo(2 * 1000 * (0.001 + (row.flashFee ?? 0)), 6);
    // 2× at the pair's liquidation LTV.
    expect(o.liqMove).toBeCloseTo(1 / (2 * row.liqLtv) - 1, 9);
  });

  it('Kamino only offers a long', () => {
    expect(kaminoOffer(kaminoRows[0], input({ side: 'short' }))).toBeNull();
  });
});

describe('limits', () => {
  it('above a venue’s highest leverage the offer is kept but blocked, with the cap', () => {
    const row = kaminoRows.find((r) => r.collateral.symbol === 'TSLAx')!;
    const o = kaminoOffer(row, input({ leverage: 3 }))!;
    expect(o.blocked).toEqual({ reason: 'leverage', max: expect.closeTo(1 / (1 - row.maxLtv), 6) });
  });

  it('a market that cannot lend the amount is blocked', () => {
    const row = kaminoRows.find((r) => r.availableUsd === 0)!;
    expect(kaminoOffer(row, input({ leverage: 2 }))!.blocked).toEqual({ reason: 'liquidity', availableUsd: 0 });
  });

  it('a large swap of a thin asset is flagged; a major one is not', () => {
    const big = input({ capital: 20_000, leverage: 2 });
    expect(kaminoOffer(kaminoRows.find((r) => r.collateral.symbol === 'TSLAx')!, input({ capital: 20_000, leverage: 2 }))!.flags.thinSwap).toBe(true);
    expect(kaminoOffer(kaminoRows.find((r) => r.collateral.symbol === 'cbBTC')!, big)!.flags.thinSwap).toBe(false);
  });

  it('stock loops carry the weekend flag, the stock perp does not', () => {
    const offers = offersFor(feed, 'TSLA', input());
    expect(offers.filter((o) => o.venue !== 'perp').every((o) => o.flags.weekend)).toBe(true);
    expect(offers.find((o) => o.venue === 'perp')!.flags.weekend).toBe(false);
  });
});

describe('the ranking', () => {
  const o = (key: string, total: number, extra: Partial<Offer> = {}) =>
    ({ key, blocked: null, cost: { totalUsd: total }, flags: { weekend: false, thinSwap: false, rateJump: false, inexact: false }, ...extra }) as Offer;

  it('cheapest first, blocked last; a star only for a clear winner', () => {
    const r = rank([o('perp', 27), o('b', 8), o('x', 1, { blocked: { reason: 'leverage', max: 2 } }), o('k', 11)], 1000);
    expect(r.offers.map((x) => x.key)).toEqual(['b', 'k', 'perp', 'x']);
    expect(r).toMatchObject({ verdict: 'best', best: ['b'], usable: 3 });
  });

  it('offers within a dollar or 0.1 % of the cheapest share the star; all of them close is a tie', () => {
    expect(tieUsd(1000)).toBe(1);
    expect(tieUsd(50_000)).toBe(50);
    expect(rank([o('a', 8), o('b', 8.5), o('perp', 20)], 1000)).toMatchObject({ verdict: 'best', best: ['a', 'b'] });
    expect(rank([o('a', 8), o('b', 8.5)], 1000)).toMatchObject({ verdict: 'tie', best: [] });
  });

  it('no star when the cheapest has an unknown real cost: a thin swap, or a rate that jumps', () => {
    const f = (x: Partial<Offer['flags']>) => ({ flags: { weekend: false, thinSwap: false, rateJump: false, inexact: false, ...x } });
    expect(rank([o('a', 8, f({ thinSwap: true })), o('b', 30)], 1000)).toMatchObject({ verdict: 'uncertain', best: [] });
    expect(rank([o('a', 8, f({ rateJump: true })), o('b', 30)], 1000)).toMatchObject({ verdict: 'uncertain', best: [] });
  });

  it('borrowing over a fifth of what a market can lend is flagged', () => {
    const row = { ...kaminoRows.find((r) => r.collateral.symbol === 'cbBTC')!, availableUsd: 4000 };
    expect(kaminoOffer(row, input({ leverage: 2 }))!.flags.rateJump).toBe(true);
    expect(kaminoOffer({ ...row, availableUsd: 1e7 }, input({ leverage: 2 }))!.flags.rateJump).toBe(false);
  });

  it('the strip lists, per side, only assets a loop offers', () => {
    const shorts = assetsOf(feed, 'short').map((a) => a.asset);
    expect(shorts.length).toBeGreaterThan(0);
    for (const a of shorts) expect(offersFor(feed, a, input({ side: 'short' })).some((x) => x.venue !== 'perp')).toBe(true);
    expect(shorts).not.toContain('SOL');
  });

  it('one usable offer, or none', () => {
    expect(rank([o('a', 8)], 1000).verdict).toBe('single');
    expect(rank([o('a', 8, { blocked: { reason: 'leverage', max: 1.5 } })], 1000).verdict).toBe('none');
  });

  it('with the base perp funding, looping BTC beats the perp over a month', () => {
    const r = rank(offersFor(feed, 'BTC', input({ leverage: 3, days: 30 })), 1000);
    const perpRow = r.offers.find((x) => x.venue === 'perp')!;
    expect(r.offers[0].venue).not.toBe('perp');
    expect(perpRow.cost.totalUsd).toBeGreaterThan(r.offers[0].cost.totalUsd);
  });

  it('a short lists PendleLoop and the perp only', () => {
    const venues = new Set(offersFor(feed, 'ETH', input({ side: 'short' })).map((x) => x.venue));
    expect(venues).toEqual(new Set(['pendleloop', 'perp']));
  });

  it('never yields NaN for any asset, side, leverage or period', () => {
    for (const a of assetsOf(feed))
      for (const side of ['long', 'short'] as const)
        for (const leverage of [1.5, 3, 5])
          for (const days of [7, 180])
            for (const x of offersFor(feed, a.asset, input({ side, leverage, days, capital: 5000 }))) {
              expect(Number.isFinite(x.cost.totalUsd)).toBe(true);
              expect(Number.isFinite(x.breakEvenMove)).toBe(true);
            }
  });
});
