import { describe, expect, it } from 'vitest';
import boxes from '../fixtures/pendle-loop-boxes.json';
import { pendleLoopLender, type PendleLoopBox } from '../../src/lib/lending/pendle-loop';
import { ptLenders } from '../../src/lib/opportunity/leverage';
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
