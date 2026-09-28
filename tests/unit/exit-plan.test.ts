import { describe, expect, it } from 'vitest';
import { computeExitPlan, type ExitPlanInput } from '../../src/lib/calculators/exit-plan';
import { impliedAPYFromPT } from '../../src/lib/calculators/implied-apy';
import { analyzeScenario } from '../../src/lib/analysis';
import { buildExitSteps } from '../../src/lib/risk/exit-advice';
import { buildInsights } from '../../src/lib/risk/advisor';
import { buildMarketBrief } from '../../src/lib/risk/market-brief';
import { mergeMarketData } from '../../src/lib/data/market-data';
import { defaultScenario, type ScenarioParams } from '../../src/types/scenario';
import type { MarketData } from '../../src/types/market';

const DAYS = 120;
const base: ExitPlanInput = {
  capital: 10_000,
  underlyingPrice: 1,
  ytPrice: 0.03,
  baseAPY: 6,
  impliedAPY: impliedAPYFromPT(0.97, DAYS), // ≈ 9.7% — YT is expensive
  daysToMaturity: DAYS,
  pointsPerDay: 1,
  ytMultiplier: 5,
  pointsBasis: 'unit',
  valuePerPoint: 0.002,
  snapshotDays: null,
  maxLossPercent: 10,
};

const plan = (over: Partial<ExitPlanInput> = {}) => computeExitPlan({ ...base, ...over })!;

describe('computeExitPlan', () => {
  it('costs only the exit fee when selling immediately', () => {
    const p = plan();
    expect(p.series[0].day).toBe(0);
    expect(p.series[0].cash).toBeCloseTo(-10_000 * 0.005, 6);
  });

  it('holds as long as the loss budget allows', () => {
    const p = plan();
    const budget = 1000;
    expect(p.lossBudget).toBe(budget);
    expect(p.recommended.cash).toBeGreaterThanOrEqual(-budget);
    // Holding one more day would break the budget (unless it is already the horizon).
    if (p.recommended.day < p.horizon) {
      const next = computeExitPlan({ ...base, maxLossPercent: 10 })!;
      const cashNext = next.series.find((x) => x.day === p.recommended.day + 1)?.cash;
      if (cashNext !== undefined) expect(cashNext).toBeLessThan(-budget);
    }
  });

  it('a bigger loss budget means holding longer and earning more points', () => {
    const tight = plan({ maxLossPercent: 5 });
    const loose = plan({ maxLossPercent: 30 });
    expect(loose.recommended.day).toBeGreaterThanOrEqual(tight.recommended.day);
    expect(loose.recommended.points).toBeGreaterThanOrEqual(tight.recommended.points);
  });

  it('never holds past the snapshot and stops counting points there', () => {
    const p = plan({ snapshotDays: 30, maxLossPercent: 100 });
    expect(p.horizon).toBe(30);
    expect(p.recommended.day).toBeLessThanOrEqual(30);
    const last = p.series[p.series.length - 1];
    expect(last.points).toBeCloseTo(10_000 / 0.03 * 5 * 30, 0);
  });

  it('break-even price really breaks even', () => {
    const p = plan();
    for (const m of p.milestones) {
      if (m.breakEvenPrice <= 0 || m.day >= DAYS) continue;
      const units = 10_000 / 0.03;
      const accrued = units * (Math.pow(1.06, m.day / 365) - 1);
      const cash = accrued + m.breakEvenPrice * units * (1 - 0.005) - 10_000;
      expect(cash).toBeCloseTo(0, 6);
      // A higher YT price than today needs a higher market rate.
      expect(m.breakEvenImpliedAPY).toBeGreaterThan(0);
    }
  });

  it('without points it picks the best cash day', () => {
    const p = plan({ pointsPerDay: 0 });
    expect(p.earnsPoints).toBe(false);
    expect(p.recommended.day).toBe(p.bestCash.day);
  });

  it('when yield beats the market rate, cash improves by holding', () => {
    const p = plan({ baseAPY: 15, pointsPerDay: 0 });
    expect(p.bestCash.day).toBe(DAYS);
    expect(p.cashBreakEven).not.toBeNull();
  });

  it('counts points per dollar when the program says so', () => {
    const perUnit = plan({ underlyingPrice: 2, maxLossPercent: 100 });
    const perUsd = plan({ underlyingPrice: 2, pointsBasis: 'usd', maxLossPercent: 100 });
    expect(perUsd.recommended.points).toBeCloseTo(perUnit.recommended.points * 2, 6);
  });

  it('returns null for impossible inputs', () => {
    expect(computeExitPlan({ ...base, ytPrice: 0 })).toBeNull();
    expect(computeExitPlan({ ...base, impliedAPY: NaN })).toBeNull();
  });
});

const NOW = Date.UTC(2026, 0, 1);
const scenario = (over: Partial<ScenarioParams> = {}): ScenarioParams => ({
  ...defaultScenario(),
  maturity: '2026-05-01',
  ...over,
});

describe('exit advice and market brief', () => {
  it('stops points at a snapshot inside the analysis', () => {
    const noSnap = analyzeScenario(scenario(), NOW);
    const snap = analyzeScenario(scenario({ snapshotDate: '2026-01-31' }), NOW);
    expect(snap.snapshotDays).toBe(30);
    expect(snap.yt.points).toBeLessThan(noSnap.yt.points);
    expect(analyzeScenario(scenario({ snapshotDate: '2025-12-01' }), NOW).snapshotDays).toBe(0);
  });

  it('explains the exit plan in Persian', () => {
    const p = scenario();
    const steps = buildExitSteps(p, analyzeScenario(p, NOW), NOW);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some((s) => s.tone === 'trigger')).toBe(true);
  });

  it('says so when a market has no points', () => {
    const p = scenario({ pointsStatus: 'none', pointsPerDay: 0 });
    const a = analyzeScenario(p, NOW);
    expect(buildMarketBrief(p, a).find((l) => l.label === 'پوینت')?.tone).toBe('bad');
    expect(buildExitSteps(p, a, NOW)[0].tone).not.toBe('trigger');
  });

  it('warns when a YT buy is bigger than the market', () => {
    // $10k at YT 0.03 → ~333k YT units; market holds 100k units.
    const p = scenario({ marketSizeUnits: 100_000 });
    const a = analyzeScenario(p, NOW);
    expect(a.liquidity.ytShareOfMarket).toBeGreaterThan(1);
    const insights = buildInsights(p, a);
    expect(insights.find((i) => i.id === 'yt-size')).toMatchObject({ strategy: 'yt', severity: 'critical' });
    expect(buildExitSteps(p, a, NOW)[0].title).toContain('سرمایه');
  });

  it('warns about an implausible points share and hides the airdrop upside', () => {
    const p = scenario({ pointsStatus: 'active', totalPointsSupply: 1_000_000, maxExitLoss: 5 });
    const a = analyzeScenario(p, NOW);
    expect(buildInsights(p, a).some((i) => i.id === 'points-share')).toBe(true);
    expect(buildExitSteps(p, a, NOW).some((s) => s.title.includes('ایردراپ'))).toBe(false);
  });

  it('flags a points market whose rates are not in the API', () => {
    const p = scenario({ pointsStatus: 'active', pointsPerDay: 0 });
    const line = buildMarketBrief(p, analyzeScenario(p, NOW)).find((l) => l.label === 'پوینت');
    expect(line?.tone).toBe('warn');
  });
});

describe('mergeMarketData points handling', () => {
  const market = (over: Partial<MarketData>): MarketData => ({
    protocol: 'exponent',
    marketId: 'm',
    name: 'X',
    underlyingPrice: null,
    ptPrice: 0.97,
    ytPrice: 0.03,
    impliedAPY: 9,
    baseAPY: 8,
    maturity: '2026-12-01T00:00:00.000Z',
    daysToMaturity: 60,
    liquidity: null,
    marketSizeUnits: null,
    volume24h: null,
    pointsStatus: 'unknown',
    points: null,
    platform: null,
    icon: null,
    chain: 'Solana',
    fetchedAt: '',
    ...over,
  });

  it('zeroes points for a market without a program', () => {
    const p = mergeMarketData(defaultScenario(), market({ pointsStatus: 'none' }), null);
    expect(p.pointsStatus).toBe('none');
    expect(p.pointsPerDay).toBe(0);
  });

  it('keeps the user’s rates when the program exists but is not detailed', () => {
    const before = { ...defaultScenario(), pointsPerDay: 3, ytMultiplier: 7 };
    const p = mergeMarketData(before, market({ pointsStatus: 'active' }), null);
    expect(p.pointsPerDay).toBe(3);
    expect(p.ytMultiplier).toBe(7);
  });

  it('applies a detailed program including its basis', () => {
    const p = mergeMarketData(
      defaultScenario(),
      market({
        pointsStatus: 'active',
        platform: 'Hylo',
        points: { name: 'XP', pointsPerDay: 1, basis: 'usd', ytMultiplier: 8, lpMultiplier: 2, season: 1 },
      }),
      null,
    );
    expect(p).toMatchObject({ pointsName: 'XP', pointsBasis: 'usd', ytMultiplier: 8, pointsSeason: 1, platform: 'Hylo' });
  });
});
