import { describe, expect, it } from 'vitest';
import { leverageForHealth, loopPosition, midEntry, pendleMaxLeverage } from '../../src/lib/pendleloop/position';
import { quoteCheck, quoteImpliedPct } from '../../src/lib/opportunity/pt-price';

/**
 * PendleLoop's own screen, 2026-11-07 (PT-USD3-17DEC2026 / USDT on Morpho, Ethereum):
 * 5,000 USDT in at 5.0×, 39 days → 19,283.94 USDT borrowed, 24,458.12 PT supplied,
 * Health Factor 12.57 %, «Est. Looping APY» 47.76 %, «Est. Profit at Maturity» $214.24.
 * Market that hour: fixed 15.48 %, PT $0.98927, borrow 4.03 % (4.16 % after this borrow),
 * oracle PT price 0.995 of the market's; Pendle's router: 24,000 USDC → 24,213.7 PT.
 */
const days = 39.11;
const screen = { capital: 5000, leverage: 5, days, yieldPct: 15.48, borrowPct: 4.16, lltv: 0.915, oracleFactor: 0.995, feeRate: 0.001 };
const quoted = { unitsPerUsd: 24213.707 / 24000, midUsd: 0.98927, quoted: true };

describe('a PendleLoop position as PendleLoop opens it', () => {
  it('reproduces PendleLoop’s screen within a few dollars', () => {
    const p = loopPosition({ kind: 'pt', ...screen, entry: quoted });
    expect(p.units).toBeGreaterThan(24_458 * 0.99);
    expect(p.units).toBeLessThan(24_458 * 1.01);
    expect(p.debtUsd).toBeGreaterThan(19_284 * 0.99);
    expect(p.debtUsd).toBeLessThan(19_284 * 1.01);
    expect(p.healthPct).toBeCloseTo(1 - 0.8 / 0.915, 4); // 12.57 %
    expect(Math.abs(p.profit - 214.24)).toBeLessThan(15);
    expect(Math.abs(p.apy - 47.76)).toBeLessThan(3);
    expect(p.entryCostUsd).toBeGreaterThan(30);
  });

  it('without fee and price impact (what the app showed before) it overstates by tens of dollars', () => {
    const p = loopPosition({ kind: 'pt', ...screen, feeRate: 0, oracleFactor: 1, entry: midEntry('pt', 15.48, days) });
    expect(p.profit).toBeGreaterThan(214.24 + 20);
  });

  it('PendleLoop’s leverage is 1 ÷ (1 − LTV): 5× is an LTV of 80 %, at any price', () => {
    const p = loopPosition({ kind: 'vanilla', capital: 1000, leverage: 5, days: 30, yieldPct: 10, borrowPct: 5, lltv: 0.9, oracleFactor: 1, feeRate: 0, entry: midEntry('vanilla', 10, 30) });
    expect(p.ltv).toBeCloseTo(0.8, 9);
    expect(p.debtUsd).toBeCloseTo(4000, 6);
    expect(p.units).toBeCloseTo(5000, 6);
  });

  it('a vanilla box earns its yield on the whole position and pays interest on the debt', () => {
    const p = loopPosition({ kind: 'vanilla', capital: 1000, leverage: 5, days: 365, yieldPct: 10, borrowPct: 5, lltv: 0.9, oracleFactor: 1, feeRate: 0, entry: midEntry('vanilla', 10, 365) });
    expect(p.profit).toBeCloseTo(5000 * 0.1 - 4000 * 0.05, 6);
    expect(p.breakEvenBorrowPct).toBeCloseTo(12.5, 6);
  });

  it('PendleLoop’s cap keeps 3 % of the LLTV: 91.5 % → 8.9×', () => {
    expect(pendleMaxLeverage(0.915)).toBeCloseTo(8.89, 2);
    expect(leverageForHealth(0.915, 1.1)).toBeCloseTo(1 / (1 - 0.915 / 1.1), 9);
  });
});

describe('the rate an executable quote pays', () => {
  const q = { side: 'pt' as const, usd: 24_000, units: 24_213.707, unitUsd: 0.99975, midUsd: 0.98927 };

  it('reads the executed price against the PT’s mid price, not the accounting asset’s', () => {
    // Against the accounting asset ($0.99975) the quote read 8.4 %; one PT-USD3 redeems for about $1.005.
    expect(quoteImpliedPct({ ...q, midUsd: null }, days)!).toBeLessThan(9);
    const r = quoteImpliedPct(q, days, 15.48)!;
    expect(r).toBeGreaterThan(12.5);
    expect(r).toBeLessThan(15.48);
    expect(quoteCheck(q, 15.48, days)).toMatchObject({ ok: true });
  });
});
