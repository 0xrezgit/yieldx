import { describe, expect, it } from 'vitest';
import { breakEvenDays, compareStrategies, exitMap, lpCalc, mintPreview, ptCalc, redeemPreview, ytCalc, type CalcInput, type CalcMarket } from '../../src/lib/calculators/pendle-calc';

// Pendle sUSDfr, 2026-10-11 (API and the user's screenshots of Pendle's calculator and trade page).
const SUSDFR: CalcMarket = {
  protocol: 'pendle',
  daysToMaturity: 109,
  impliedPct: 29.18,
  basePct: 35.46,
  ammFeeLn: 0.005261,
  yieldFeePct: 5,
  accountingUsd: 1.0011,
  tokenUsd: 1.0207,
  tokenSymbol: 'sUSDfr',
  lp: { ptShare: 0.672, swapFeeApyPct: 0.124, rewardApyPct: 1.134 },
};
const IN: CalcInput = { capitalTokens: 1000, holdDays: 109, exitImpliedPct: 29.18, basePct: 35.46, assumedFeePct: 0.5, txUsd: 0, withRewards: true };

describe('calculator against Pendle', () => {
  it('Mint: 1,000 sUSDfr → 1,019.5 PT + 1,019.5 YT worth ~$945 and ~$75', () => {
    const p = mintPreview(SUSDFR, 1000);
    expect(p.pt).toBeCloseTo(1019.6, 0);
    expect(p.ptUsd).toBeCloseTo(945, -1);
    expect(p.ytUsd).toBeCloseTo(75, 0);
    expect(p.ptUsd + p.ytUsd).toBeCloseTo(p.inUsd, 6);
  });

  it('Redeem: before maturity PT and YT pair up; the rest is left over', () => {
    const r = redeemPreview(SUSDFR, 100, 60);
    expect(r).toMatchObject({ matured: false, units: 60, leftover: { pt: 40, yt: 0 } });
    expect(redeemPreview({ ...SUSDFR, daysToMaturity: 0 }, 100, 0).units).toBe(100);
  });

  it('YT to maturity: ~+19–20% (Pendle: «20% profit if the underlying APY stays»; its calculator +18.6% with fees)', () => {
    const r = ytCalc(SUSDFR, IN);
    expect(r.hprPct).toBeGreaterThan(18);
    expect(r.hprPct).toBeLessThan(21.5);
    // The buy fee ≈ feeRate ÷ implied of the capital (Pendle's trade page: 1.93%).
    expect((r.fees.entry / r.capital) * 100).toBeGreaterThan(1.5);
    // Break-even underlying APY near Pendle's 29.43%.
    expect(r.breakEvenBasePct!).toBeGreaterThan(28.5);
    expect(r.breakEvenBasePct!).toBeLessThan(31);
  });

  it('PT to maturity: ~+7.2% (Pendle +72.8 sUSDfr on 1,000)', () => {
    const r = ptCalc(SUSDFR, IN);
    expect(r.netTokens).toBeGreaterThan(70);
    expect(r.netTokens).toBeLessThan(80);
    expect(r.fees.entry).toBeGreaterThan(0);
  });

  it('LP to maturity: ~+8–9% (Pendle +81.8 sUSDfr, blended 32.5%)', () => {
    const r = lpCalc(SUSDFR, IN)!;
    expect(r.netTokens).toBeGreaterThan(78);
    expect(r.netTokens).toBeLessThan(92);
  });

  it('gas and a short hold: no yearly figure under 7 days; PT breaks even after some days', () => {
    expect(ptCalc(SUSDFR, { ...IN, holdDays: 3, txUsd: 2 }).annualPct).toBeNull();
    const d = breakEvenDays(SUSDFR, { ...IN, txUsd: 5 }, 'pt');
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(1);
  });

  it('exit map: maturity is the same whatever the exit rate; earlier, a higher rate pays less', () => {
    const map = exitMap(SUSDFR, IN, 'pt');
    const last = map.days.length - 1;
    const atMaturity = map.cells.map((row) => row[last]);
    expect(new Set(atMaturity.map((x) => x!.toFixed(6))).size).toBe(1);
    expect(map.cells[0][0]!).toBeGreaterThan(map.cells[4][0]!);
  });

  it('strategies side by side under three underlying readings', () => {
    const c = compareStrategies(SUSDFR, IN);
    expect(c.rows.map((r) => r.strategy)).toEqual(['hold', 'pt', 'yt', 'lp']);
    // PT does not depend on the underlying APY (held to maturity).
    const pt = c.rows.find((r) => r.strategy === 'pt')!.byReading;
    expect(pt.low!.net).toBeCloseTo(pt.high!.net, 9);
  });
});
