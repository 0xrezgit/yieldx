import { describe, expect, it } from 'vitest';
import { EXPONENT_FEE_PCT, pointsCheapness, ytFees, ytPlan, type YtPlanMarket } from '../../src/lib/calculators/yt-plan';
import { ytPriceFromAPY } from '../../src/lib/calculators/trade';

const ONYC: YtPlanMarket = {
  protocol: 'exponent',
  impliedPct: 12.9,
  basePct: 11.02,
  daysToMaturity: 92,
  hasPoints: true,
  points: { name: 'Onre Points', pointsPerDay: 1, basis: 'unit', ytMultiplier: 8, lpMultiplier: 8, season: 1 },
  unitUsd: 1.1542,
};

describe('YT statement', () => {
  it("matches Exponent's own page for 100 ONyc ($115.42): ~2.44M points, ~$96.6 yield, 3,829 USD of exposure", () => {
    const p = ytPlan(ONYC, { capital: 115.42, assumedFeePct: 0.5, txUsd: 0 })!;
    expect(p.feeSource).toBe('exponent-book');
    expect(p.entry.feePct).toBe(EXPONENT_FEE_PCT);
    expect(p.entry.notionalUsd).toBeCloseTo(3829.5, -1);
    const likely = p.maturity.find((x) => x.kind === 'likely')!;
    expect(likely.basePct).toBe(11.02); // no history given: today's base
    expect(likely.yieldUsd).toBeCloseTo(96.63, 0);
    expect(likely.points! / 1e6).toBeCloseTo(2.44, 1);
    // What burns: everything paid for the YT (it is worth nothing at maturity).
    expect(p.burnedUsd).toBeCloseTo(115.42 * (1 - EXPONENT_FEE_PCT / 100), 6);
    expect(likely.cashUsd).toBeCloseTo(likely.yieldUsd - 115.42, 6);
    expect(likely.costPerMillion).toBeCloseTo((-likely.cashUsd / likely.points!) * 1e6, 6);
  });

  it('Pendle: the AMM fee is paid on the buy (implied + fee) and on a sale (implied − fee), not a flat guess', () => {
    const f = ytFees({ protocol: 'pendle', ammFeeLn: 0.003, impliedPct: 10, daysToMaturity: 90 }, 0.5);
    expect(f.source).toBe('pendle-amm');
    const mid = ytPriceFromAPY(10, 90);
    // The fee is on the whole yield exposure, so on the capital it is large: ≈ fee × τ ÷ YT price (~3% here).
    expect(f.entryPct).toBeCloseTo(((0.003 * 90) / 365 / mid) * 100, 0);
    expect(f.entryPct).toBeCloseTo((1 - mid / ytPriceFromAPY((Math.exp(Math.log(1.1) + 0.003) - 1) * 100, 90)) * 100, 9);
    expect(f.exitPct(10, 30)).toBeGreaterThan(0);
    // Without the AMM fee: the assumed one, labelled.
    expect(ytFees({ protocol: 'spectra', impliedPct: 10, daysToMaturity: 90 }, 0.4)).toMatchObject({ source: 'assumed', entryPct: 0.4 });
  });

  it('exit without loss: a base above the implied rate is loss-free from some day on; below it, never', () => {
    const rich = ytPlan({ ...ONYC, basePct: 20, points: null, hasPoints: false }, { capital: 1000, assumedFeePct: 0.5, txUsd: 0 })!;
    expect(rich.freeUntil).toBe(92);
    const poor = ytPlan(ONYC, { capital: 1000, assumedFeePct: 0.5, txUsd: 0 })!;
    expect(poor.freeUntil).toBeNull();
    // A one-day sale costs about the fees, not the long-run loss.
    const day1 = poor.exits.find((x) => x.day === 1)!;
    expect(day1.cashUsd).toBeGreaterThan(-5);
    expect(poor.maturity[1].cashUsd).toBeLessThan(-100);
  });

  it('gas comes off the dollar result; points with an assumed value', () => {
    const a = ytPlan(ONYC, { capital: 1000, assumedFeePct: 0.5, txUsd: 0 })!;
    const b = ytPlan(ONYC, { capital: 1000, assumedFeePct: 0.5, txUsd: 2, valuePerMillion: 100 })!;
    expect(a.maturity[1].cashUsd - b.maturity[1].cashUsd).toBeCloseTo(6, 6); // approve + buy + claim
    expect(b.withPointsUsd).toBeCloseTo(b.maturity[1].cashUsd + (b.maturity[1].points! * 100) / 1e6, 6);
  });

  it('cheapness: within one program by cost per 1M points; free when the cash result is not a loss', () => {
    const plan = (base: number) => ytPlan({ ...ONYC, basePct: base }, { capital: 1000, assumedFeePct: 0.5, txUsd: 0 })!;
    const c = pointsCheapness([
      { id: 'a', plan: plan(8) },
      { id: 'b', plan: plan(10) },
      { id: 'c', plan: plan(11.5) },
      { id: 'd', plan: plan(25) },
    ]);
    expect(c.get('d')).toMatchObject({ level: 'free', basis: 'program' });
    expect(c.get('a')).toMatchObject({ level: 'dear', basis: 'program' });
    expect(c.get('c')!.rank).toBeLessThan(c.get('a')!.rank);
  });
});
