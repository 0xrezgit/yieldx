import { describe, expect, it } from 'vitest';
import { ytPlan, type YtPlanMarket } from '../../src/lib/calculators/yt-plan';
import { fdvFor, holdAlternative, pointsWorth, spreadBudget } from '../../src/lib/calculators/points-worth';

const ONYC: YtPlanMarket = {
  protocol: 'exponent',
  impliedPct: 12.9,
  basePct: 11.02,
  daysToMaturity: 92,
  hasPoints: true,
  points: { name: 'Onre Points', pointsPerDay: 1, basis: 'unit', ytMultiplier: 8, lpMultiplier: 8, season: 1 },
  unitUsd: 1.1542,
};
const plan = (capital: number, m: YtPlanMarket = ONYC) => ytPlan(m, { capital, assumedFeePct: 0.5, txUsd: 0.01 })!;

describe('points worth', () => {
  it('orders the outcome ladder and prices each band from the cash result', () => {
    const p = plan(1000);
    const w = pointsWorth(p, 92, 8, 5);
    const likely = p.maturity.find((x) => x.kind === 'likely')!;
    expect(w.zeroUsd).toBe(likely.cashUsd);
    expect(w.zeroUsd).toBeLessThan(0);
    expect(w.ladder!.map((x) => x.band)).toEqual(['loss', 'small-loss', 'even', 'thin', 'good']);
    // Break-even of the cash loss is the statement's own cost per 1M points.
    expect(w.ladder![1].toPerM).toBeCloseTo(likely.costPerMillion!, 6);
    for (let k = 1; k < w.ladder!.length; k++) expect(w.ladder![k].fromPerM).toBeGreaterThanOrEqual(w.ladder![k - 1].fromPerM);
    // At the «good» threshold the result equals the safe yield plus the extra asked for.
    expect(w.ladder!.at(-1)!.resultUsd).toBeCloseTo(w.safeUsd + w.extraUsd, 6);
    expect(w.realCostUsd).toBeCloseTo(w.safeUsd - w.zeroUsd, 6);
  });

  it('turns a value per 1M points into an FDV only when the program size is known', () => {
    expect(fdvFor(10, 50e9, 10)).toBeCloseTo(5e6, 0);
    expect(fdvFor(10, 0, 10)).toBeNull();
  });

  it('holding the asset earns fewer points with less at risk', () => {
    const p = plan(1000);
    const alt = holdAlternative(p, 92, 8, ONYC.unitUsd!)!;
    const w = pointsWorth(p, 92, 8, 5);
    expect(alt.hold.points).toBeLessThan(w.points!);
    expect(alt.hold.riskUsd).toBeLessThan(w.riskUsd);
  });

  it('keeps the worst case within the loss budget, one market per program', () => {
    const other: YtPlanMarket = { ...ONYC, points: { ...ONYC.points!, name: 'Other' }, impliedPct: 14 };
    const markets: Record<string, YtPlanMarket> = { a: ONYC, b: other, c: { ...ONYC, impliedPct: 13.5 } };
    const cands = Object.entries(markets).map(([id, m]) => ({ id, program: m.points!.name, plan: plan(1000, m) }));
    const picks = spreadBudget(cands, 60, 5000, (id, amount) => ytPlan(markets[id], { capital: amount, assumedFeePct: 0.5, txUsd: 0.01 }));
    expect(picks.length).toBe(2);
    expect(new Set(picks.map((p) => p.plan.program!.name)).size).toBe(2);
    expect(picks.reduce((s, p) => s + p.worstUsd, 0)).toBeLessThanOrEqual(60 * 1.01);
  });
});
