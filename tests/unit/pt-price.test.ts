import { describe, expect, it } from 'vitest';
import { afterAmmFee, afterRedeem, quoteCheck, quoteImpliedPct } from '../../src/lib/opportunity/pt-price';

/** Live Pendle numbers, 2026-10-10. */
describe('PT price checks', () => {
  it('takes the AMM fee out of a PT buy and puts it on a YT buy (reUSD: 11.87 %, feeRate 0.0022)', () => {
    expect(afterAmmFee(11.87, 0.002216, 'pt')).toBeCloseTo((Math.exp(Math.log(1.1187) - 0.002216) - 1) * 100, 9);
    expect(afterAmmFee(11.87, 0.002216, 'pt')).toBeLessThan(11.87);
    expect(afterAmmFee(11.87, 0.002216, 'yt')).toBeGreaterThan(11.87);
    expect(afterAmmFee(11.87, null, 'pt')).toBe(11.87);
  });

  it('reads the rate a quote pays (USD3: $10k for 68 days at about 11.8 %)', () => {
    const units = 10_000 * Math.pow(1.118, 68 / 365);
    expect(quoteImpliedPct({ side: 'pt', usd: 10_000, units, unitUsd: 1 }, 68)).toBeCloseTo(11.8, 6);
  });

  it('accepts a quote near the market’s rate and refuses one that is a data error', () => {
    const units = (r: number, d: number) => 1000 * Math.pow(1 + r / 100, d / 365);
    // USD3: 15.06 % published, 11.8 % executable — a real cost, kept.
    expect(quoteCheck({ side: 'pt', usd: 1000, units: units(11.8, 68), unitUsd: 1 }, 15.06, 68).ok).toBe(true);
    // ROY-ST-apyUSD: 15.35 % published, the quote 993 % — refused.
    expect(quoteCheck({ side: 'pt', usd: 1000, units: units(993, 26), unitUsd: 1 }, 15.35, 26).ok).toBe(false);
  });

  it('a PT that redeems for less loses that share', () => {
    expect(afterRedeem(0.02, 0.85)).toBeCloseTo(1.02 * 0.85 - 1, 12);
    expect(afterRedeem(0.02, 0.9995)).toBe(0.02);
    expect(afterRedeem(0.02, null)).toBe(0.02);
  });
});
