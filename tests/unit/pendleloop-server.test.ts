import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { historySeries, loopBoxOf } from '../../src/lib/pendleloop/server';
import { pendleLoopLender } from '../../src/lib/lending/pendle-loop';

// Controlled test data shaped like Pendle's answer; not market data.

const NOW = Date.parse('2026-10-26T12:00:00Z');
const box = (over: Record<string, unknown> = {}) =>
  ({
    boxId: `0x${'b1'.repeat(32)}`,
    chainId: 143,
    kind: 'pt',
    ptAddress: `0x${'ab'.repeat(20)}`,
    ptSymbol: 'PT-AUSD-17DEC2026',
    ptMarketAddress: `0x${'cd'.repeat(20)}`,
    expiry: '2026-12-17T00:00:00.000Z',
    protocol: 'Aave',
    moneyMarketAddress: `0x${'ef'.repeat(20)}`,
    iconUrl: 'https://storage.googleapis.com/prod-pendle-bucket-a/images/uploads/aave.png',
    marketUrl: 'https://app.aave.com/reserve-overview/',
    debtAsset: `0x${'11'.repeat(20)}`,
    debtSymbol: 'USDC',
    side: null,
    isDepegged: false,
    minOpenUsd: 100,
    risks: null,
    data: { lltv: 0.9, borrowApy: 0.06, borrowApy7dAvg: 0.055, liquidityUsd: 2e6, maxLeverage: 8.1, maxApy: 0.31, serviceFeeRate: 0.001, utilization: 0.8, reference: { fixedApy: 0.12 } },
    ...over,
  }) as never;

describe('PendleLoop boxes for the loop page', () => {
  it('keeps any network and money market Pendle lists, with its logo, PendleLoop link and figures', () => {
    const b = loopBoxOf(box(), NOW)!;
    expect(b).toMatchObject({ chainId: 143, kind: 'pt', protocol: { name: 'Aave V3', icon: expect.stringContaining('aave.png') }, lltv: 0.9, borrowApy: 0.06, yieldApy: 0.12, maxLeverage: 8.1, minOpenUsd: 100 });
    expect(b.pendleUrl).toBe(`https://app.pendle.finance/trade/loop/0x${'b1'.repeat(32)}/deposit?chain=monad`);
    expect(loopBoxOf(box({ chainId: 9745, protocol: 'Euler' }), NOW)?.pendleUrl).toContain('chain=plasma');
  });

  it('drops a PT past maturity, long/short boxes and broken rates', () => {
    expect(loopBoxOf(box({ expiry: '2026-10-22T00:00:00.000Z' }), NOW)).toBeNull();
    expect(loopBoxOf(box({ expiry: null }), NOW)).toBeNull();
    expect(loopBoxOf(box({ side: 'long' }), NOW)).toBeNull();
    expect(loopBoxOf(box({ data: { lltv: 0.915, borrowApy: 182.98 } }), NOW)).toBeNull();
    // A yield-bearing asset has no maturity and stays.
    expect(loopBoxOf(box({ kind: 'vanilla', expiry: null, data: { lltv: 0.86, borrowApy: 0.05, collateralYieldApy: 0.09 } }), NOW)).toMatchObject({ kind: 'vanilla', expiry: null, yieldApy: 0.09 });
  });

  it('the lending feed leaves out a PendleLoop PT box past maturity', () => {
    const live = box({ protocol: 'Euler' });
    expect(pendleLoopLender(live, new Date(NOW).toISOString())).not.toBeNull();
    expect(pendleLoopLender(box({ protocol: 'Euler', expiry: '2026-09-24T00:00:00.000Z' }), new Date(NOW).toISOString())).toBeNull();
  });

  it('history: compact rows in %, points without both prices dropped', () => {
    const s = historySeries({
      series: [
        {
          boxId: 'x',
          moneyMarketAddress: `0x${'EF'.repeat(20)}`,
          debtAsset: `0x${'11'.repeat(20)}`,
          points: [
            { timestamp: 1, borrowApy: 0.0845, ptOraclePriceInDebt: 0.968, ptMarketPriceInDebt: 0.9682, fixedApy: 0.1058, liquidityUsd: 70110.9 },
            { timestamp: 2, borrowApy: 0.09, ptOraclePriceInDebt: null, ptMarketPriceInDebt: 0.97 },
          ],
        },
        { boxId: 'empty', moneyMarketAddress: `0x${'ef'.repeat(20)}`, debtAsset: `0x${'11'.repeat(20)}`, points: [] },
      ],
    });
    expect(s).toEqual([{ boxId: 'x', moneyMarketAddress: `0x${'ef'.repeat(20)}`, debtAsset: `0x${'11'.repeat(20)}`, rows: [[1, 8.45, 0.968, 0.9682, 10.58, 70111]] }]);
  });
});
