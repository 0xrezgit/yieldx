import { describe, expect, it } from 'vitest';
import { buckets, leaderLoop, leaderPt, leaderYt, type LeaderRow } from '../../src/lib/risk/leaderboard';
import { defaultScreenSettings, type OpportunityListing } from '../../src/lib/risk/opportunities';
import { ptPriceFromAPY } from '../../src/lib/calculators/implied-apy';
import { simulateLoop, simulateYt } from '../../src/lib/calculators/trade';

const listing = (over: Partial<OpportunityListing>): OpportunityListing => ({
  protocol: 'pendle',
  id: 'x',
  name: 'USDx',
  platform: null,
  icon: null,
  chain: 'Ethereum',
  maturity: '2027-01-01',
  impliedAPY: 8,
  baseAPY: 8,
  liquidity: 5_000_000,
  hasPoints: true,
  ytMultiplier: null,
  points: null,
  categories: ['stables', 'pt-looping'],
  isNew: false,
  expired: false,
  daysToMaturity: 90,
  ...over,
});

const s = defaultScreenSettings;
const input = { capital: 10_000, hurdle: 8 };

describe('leaderPt', () => {
  it('holds to maturity: pnl = C × ((1 − fee) / PT − 1)', () => {
    const [r] = leaderPt([listing({ impliedAPY: 10, daysToMaturity: 45 })], s, input);
    const pt = ptPriceFromAPY(10, 45);
    expect(r.pnl).toBeCloseTo(10_000 * ((1 - s.feePercent / 100) / pt - 1), 6);
    expect(r.days).toBe(45);
    expect(r.perDay).toBeCloseTo(r.pnl / 45, 9);
    expect(r.annualized).toBeCloseTo((Math.pow(1 + r.pnl / 10_000, 365 / 45) - 1) * 100, 6);
  });

  it('judges a small profit over a long time as thin and a solid one as worth it', () => {
    const [thin, worth] = leaderPt(
      [listing({ id: 'thin', impliedAPY: 4, daysToMaturity: 90 }), listing({ id: 'worth', impliedAPY: 30, daysToMaturity: 45 })],
      s,
      input,
    );
    expect(thin.pnl).toBeGreaterThan(0);
    expect(thin.verdict).toBe('thin');
    expect(worth.verdict).toBe('worth');
  });

  it('flags a position that is large for the market', () => {
    const [r] = leaderPt([listing({ liquidity: 200_000 })], { ...s, minLiquidity: 0 }, input);
    expect(r.tooBig).toBe(true);
  });
});

describe('leaderYt', () => {
  it('picks the day with the best cash result', () => {
    const m = listing({ impliedAPY: 12, baseAPY: 6, daysToMaturity: 60 });
    const [r] = leaderYt([m], s, input, true);
    for (let h = 1; h <= 60; h++) {
      const cash = simulateYt({
        capital: 10_000, underlyingPrice: 1, daysToMaturity: 60, entryAPY: 12, baseAPY: 6, holdDays: h, exitAPY: 12,
        feePercent: s.feePercent, pointsPerDay: 0, ytMultiplier: 1, pointsBasis: 'usd', valuePerPoint: 0,
      }).cash;
      expect(r.pnl).toBeGreaterThanOrEqual(cash - 1e-9);
    }
    expect(r.verdict).not.toBe('free');
    expect(r.freeUntil).toBeNull();
  });

  it('cheap YT is free to hold to maturity', () => {
    const [r] = leaderYt([listing({ impliedAPY: 5, baseAPY: 9, daysToMaturity: 60 })], s, input, true);
    expect(r.verdict).toBe('free');
    expect(r.days).toBe(60);
    expect(r.freeUntil).toBe(60);
    expect(r.pnl).toBeGreaterThan(0);
  });

  it('skips markets without points when asked', () => {
    expect(leaderYt([listing({ hasPoints: false })], s, input, true)).toHaveLength(0);
    expect(leaderYt([listing({ hasPoints: false })], s, input, false)).toHaveLength(1);
  });
});

describe('leaderLoop', () => {
  it('matches the loop simulator at maturity', () => {
    const l = { leverage: 3, borrowAPY: 5, lltv: 86 };
    const [r] = leaderLoop([listing({ impliedAPY: 12, daysToMaturity: 80 })], s, l, input);
    const sim = simulateLoop({ capital: 10_000, daysToMaturity: 80, entryAPY: 12, ...l, feePercent: s.feePercent });
    expect(r.pnl).toBeCloseTo(sim.profit, 9);
  });
});

describe('buckets', () => {
  const row = (id: string, pnl: number, days = 10): LeaderRow => ({
    m: listing({ id }), pnl, pnlPercent: pnl / 100, days, annualized: 0, perDay: pnl / days,
    verdict: 'worth', tooBig: false, freeUntil: null, pointsExposure: null,
  });
  const rows = [30, 10, 50, 0, 20, 5, 40, 60, 70, -5, -50, -1, -20].map((p, i) => row(`r${i}`, p));

  it('splits into four ordered lists without repeats', () => {
    const b = buckets(rows, 'total', 3);
    expect(b.topProfit.map((r) => r.pnl)).toEqual([70, 60, 50]);
    expect(b.leastProfit.map((r) => r.pnl)).toEqual([0, 5, 10]);
    expect(b.topLoss.map((r) => r.pnl)).toEqual([-50, -20, -5]);
    expect(b.leastLoss.map((r) => r.pnl)).toEqual([-1]);
  });

  it('can rank by profit per day', () => {
    const b = buckets([row('slow', 100, 100), row('fast', 50, 5)], 'perDay', 1);
    expect(b.topProfit[0].m.id).toBe('fast');
    expect(b.leastProfit[0].m.id).toBe('slow');
  });
});

describe('bucket size', () => {
  it('lists up to 15 markets per bucket by default', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ m: { id: String(i), protocol: 'pendle' }, pnl: i - 20, perDay: i - 20 }) as unknown as LeaderRow);
    const b = buckets(many);
    expect(b.topProfit).toHaveLength(15);
    expect(b.topLoss).toHaveLength(15);
    expect(b.leastProfit).toHaveLength(5);
    expect(b.leastLoss).toHaveLength(5);
  });
});
