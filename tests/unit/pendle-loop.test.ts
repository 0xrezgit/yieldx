import { describe, expect, it } from 'vitest';
import boxes from '../fixtures/pendle-loop-boxes.json';
import vanilla from '../fixtures/pendle-loop-vanilla.json';
import { markPendleLoops, morphoListing, pendleLoopLender, pendleLoopUrl, type PendleLoopBox } from '../../src/lib/lending/pendle-loop';
import { buildLoops, buildPtLoops, ptLenders } from '../../src/lib/opportunity/leverage';
import type { Opportunity } from '../../src/types/opportunity';

const at = '2026-10-19T00:00:00.000Z';
const [morpho, aave, euler] = boxes as PendleLoopBox[];

describe("Pendle's PT looping list as lenders", () => {
  it('skips Morpho (its own source has it) and keeps Aave V3 and Euler', () => {
    expect(pendleLoopLender(morpho, at)).toBeNull();
    expect(pendleLoopLender(aave, at)!.protocol).toMatchObject({ id: 'aave-v3', name: 'Aave V3' });
    expect(pendleLoopLender(euler, at)!.protocol.id).toBe('euler');
  });

  it('reads rate, LLTV, liquidity and the market\'s own page', () => {
    const o = pendleLoopLender(aave, at)!;
    expect(o.family).toBe('borrow');
    expect(o.borrow!.ratePct).toBeCloseTo(aave.data!.borrowApy! * 100, 9);
    expect(o.borrow!.collateral[0]).toMatchObject({ token: { address: aave.ptAddress.toLowerCase() }, maxLtv: aave.data!.lltv });
    expect(o.url).toBe(aave.marketUrl);
    expect(pendleLoopLender(euler, at)!.url).toContain('app.euler.finance/borrow/');
  });

  it('is found by the PT loop for that exact PT', () => {
    const o = pendleLoopLender(aave, at)!;
    const pt = { chain: 'eip155:1', ptToken: { symbol: aave.ptSymbol, address: aave.ptAddress }, assets: { deposit: [{ symbol: 'USDe', address: '0x1' }] }, ptClass: null } as unknown as Opportunity;
    expect(ptLenders(pt, [o])).toHaveLength(1);
  });

  it('drops a depegged or unreadable box', () => {
    expect(pendleLoopLender({ ...aave, isDepegged: true }, at)).toBeNull();
    expect(pendleLoopLender({ ...aave, data: { ...aave.data, lltv: 1.2 } }, at)).toBeNull();
  });
});

describe("PendleLoop's non-PT loops (Loop to Earn)", () => {
  const [aaveWst, morphoVanilla, longNvda] = vanilla as PendleLoopBox[];

  it('takes an Aave V3 vanilla box with the asset\'s own yield, so a loop is built from it', () => {
    const o = pendleLoopLender(aaveWst, at)!;
    expect(o.protocol.id).toBe('aave-v3');
    expect(o.borrow!.collateral[0].yield).toMatchObject({ pct: aaveWst.data!.collateralYieldApy! * 100, kind: 'apy' });
    const [loop] = buildLoops([o]);
    expect(loop.loop).toMatchObject({ collateral: { token: { symbol: 'wstETH' } }, debt: { token: { symbol: 'WETH' } }, pairClass: 'eth', maxLtv: aaveWst.data!.lltv });
  });

  it('skips Morpho, long/short boxes and a vanilla box without a yield', () => {
    expect(pendleLoopLender(morphoVanilla, at)).toBeNull();
    expect(pendleLoopLender(longNvda, at)).toBeNull();
    expect(pendleLoopLender({ ...aaveWst, data: { ...aaveWst.data, collateralYieldApy: 0 } }, at)).toBeNull();
  });
});

describe('Morpho markets PendleLoop also lists', () => {
  // The fixture's Morpho box: PT-fxSAVE against USDC on market 0xae99….
  const marketId = morpho.marketUrl!.split('/').pop()!;
  const morphoMarket = (id: string, collateral = morpho.ptAddress) =>
    ({
      key: `morpho:eip155:1:${id}:supply`,
      protocol: { id: 'morpho', name: 'Morpho' },
      chain: 'eip155:1',
      market: { id, address: null, name: 'USDC · PT-fxSAVE' },
      rate: { value: 3, kind: 'apy', at },
      quality: 'current',
      sources: [],
      assets: { deposit: [{ symbol: 'USDC', address: morpho.debtAsset }] },
      borrow: { ratePct: 4, ratePct7d: null, curve: null, availableUsd: null, collateral: [{ token: { symbol: morpho.ptSymbol, address: collateral }, maxLtv: 0.915, yield: null }], metric: 'ltv' },
    }) as unknown as Opportunity;

  it('marks the same market, collateral and debt with the box\'s PendleLoop page', () => {
    const [o] = markPendleLoops([morphoMarket(marketId)], morphoListing(boxes as PendleLoopBox[]));
    expect(o.borrow!.collateral[0].pendleLoop).toBe(pendleLoopUrl(morpho));
    // PendleLoop finds a box by its id and the network: without ?chain= it says «This looping box is not available».
    expect(pendleLoopUrl(morpho)).toBe(`https://app.pendle.finance/trade/loop/${morpho.boxId}/deposit?chain=ethereum`);
  });

  it('reads the id when a name follows it, so a twin market (same pair and LLTV) stays unmarked', () => {
    const listed = morphoListing([{ ...morpho, marketUrl: `https://app.morpho.org/ethereum/variable/${marketId}/pt-fxsave-29oct2026-usdc#market` }]);
    expect(markPendleLoops([morphoMarket(marketId)], listed)[0].borrow!.collateral[0].pendleLoop).toBe(pendleLoopUrl(morpho));
    expect(markPendleLoops([morphoMarket(`0x${'4'.repeat(64)}`)], listed)[0].borrow!.collateral[0].pendleLoop).toBeUndefined();
  });

  it('leaves another market or another collateral unmarked', () => {
    const listed = morphoListing(boxes as PendleLoopBox[]);
    const other = `0x${'1'.repeat(64)}`;
    expect(markPendleLoops([morphoMarket(other)], listed)[0].borrow!.collateral[0].pendleLoop).toBeUndefined();
    expect(markPendleLoops([morphoMarket(marketId, `0x${'2'.repeat(40)}`)], listed)[0].borrow!.collateral[0].pendleLoop).toBeUndefined();
  });

  it('matches a box that links a named page instead of the id by collateral, debt and LLTV', () => {
    const named = { ...morpho, marketUrl: 'https://app.morpho.org/ethereum/market/pt-fxsave-29oct2026-usdc#market' };
    const listed = morphoListing([named]);
    expect(markPendleLoops([morphoMarket(`0x${'3'.repeat(64)}`)], listed)[0].borrow!.collateral[0].pendleLoop).toBe(pendleLoopUrl(morpho));
  });

  it('carries the mark into the PT loop built on that market', () => {
    const [lender] = markPendleLoops([morphoMarket(marketId)], morphoListing(boxes as PendleLoopBox[]));
    const pt = { key: 'pendle:pt', family: 'pt', chain: 'eip155:1', rate: { value: 8 }, ptToken: { symbol: morpho.ptSymbol, address: morpho.ptAddress }, assets: { deposit: [{ symbol: 'USDC', address: morpho.debtAsset }] }, ptClass: null, protocol: { id: 'pendle', name: 'Pendle' }, market: { id: 'm', address: null, name: 'fxSAVE' }, maturity: null, quality: 'current', sources: [], url: null } as unknown as Opportunity;
    const [loop] = buildPtLoops([pt, lender]);
    expect(loop.loop!.pendleLoop).toBe(pendleLoopUrl(morpho));
  });

  it('gives a lender read from PendleLoop its own page', () => {
    expect(pendleLoopLender(aave, at)!.borrow!.collateral[0].pendleLoop).toBe(pendleLoopUrl(aave));
  });
});
