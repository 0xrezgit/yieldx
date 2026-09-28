import { describe, expect, it } from 'vitest';
import {
  maxEntryAPY,
  maxLoopLeverage,
  simulateLoop,
  simulatePt,
  simulateYt,
  ytEntryLimits,
  ytPriceFromAPY,
  type YtTradeInput,
} from '../../src/lib/calculators/trade';
import { calculateLooping } from '../../src/lib/calculators/looping';
import { impliedAPYFromPT } from '../../src/lib/calculators/implied-apy';
import { assessLiquidation } from '../../src/lib/risk/liquidation';
import { screenLoop, screenPt, screenYt, defaultScreenSettings, type OpportunityListing } from '../../src/lib/risk/opportunities';

const yt: YtTradeInput = {
  capital: 10_000,
  underlyingPrice: 1,
  daysToMaturity: 180,
  entryAPY: 10,
  baseAPY: 8,
  holdDays: 180,
  exitAPY: 10,
  feePercent: 0,
  pointsPerDay: 1,
  ytMultiplier: 2,
  pointsBasis: 'unit',
  valuePerPoint: 0,
};

describe('ytPriceFromAPY', () => {
  it('is the complement of the PT price and round-trips through the implied APY', () => {
    const y = ytPriceFromAPY(12, 90);
    expect(y).toBeCloseTo(1 - Math.pow(1.12, -90 / 365), 12);
    expect(impliedAPYFromPT(1 - y, 90)).toBeCloseTo(12, 9);
  });
});

describe('simulateYt', () => {
  it('to maturity: returns only the accrued yield', () => {
    const r = simulateYt(yt);
    const price = 1 - Math.pow(1.1, -180 / 365);
    const units = 10_000 / price;
    expect(r.entryPrice).toBeCloseTo(price, 12);
    expect(r.units).toBeCloseTo(units, 6);
    expect(r.exitPrice).toBe(0);
    expect(r.cash).toBeCloseTo(units * (Math.pow(1.08, 180 / 365) - 1) - 10_000, 6);
    expect(r.points).toBeCloseTo(units * 1 * 2 * 180, 3);
    expect(r.toMaturity).toBe(true);
  });

  it('is exactly break-even at maturity when base APY solves (1+a)^t − 1 = YT price', () => {
    const price = ytPriceFromAPY(10, 180);
    const a = (Math.pow(1 + price, 365 / 180) - 1) * 100;
    expect(simulateYt({ ...yt, baseAPY: a }).cash).toBeCloseTo(0, 6);
  });

  it('selling on day 0 at the entry rate costs exactly the two fees', () => {
    const r = simulateYt({ ...yt, holdDays: 0, feePercent: 0.5 });
    expect(r.cash).toBeCloseTo(-10_000 * (1 - 0.995 * 0.995), 6);
  });

  it('break-even exit APY returns the capital exactly', () => {
    const r = simulateYt({ ...yt, holdDays: 45, feePercent: 0.3 });
    expect(Number.isFinite(r.breakEvenExitAPY)).toBe(true);
    const atBE = simulateYt({ ...yt, holdDays: 45, feePercent: 0.3, exitAPY: r.breakEvenExitAPY });
    expect(atBE.cash).toBeCloseTo(0, 6);
    // Higher exit rate → higher YT price → profit.
    expect(simulateYt({ ...yt, holdDays: 45, feePercent: 0.3, exitAPY: r.breakEvenExitAPY + 1 }).cash).toBeGreaterThan(0);
  });

  it('break-even point value makes airdrop + cash = 0', () => {
    const r = simulateYt(yt);
    expect(r.cash).toBeLessThan(0);
    const withAirdrop = simulateYt({ ...yt, valuePerPoint: r.breakEvenPointValue });
    expect(withAirdrop.total).toBeCloseTo(0, 6);
  });

  it('USD-based points ignore the asset price; unit-based points scale with it', () => {
    const usd = simulateYt({ ...yt, pointsBasis: 'usd', underlyingPrice: 2 });
    const unit = simulateYt({ ...yt, pointsBasis: 'unit', underlyingPrice: 2 });
    expect(usd.points).toBeCloseTo(usd.notional * 2 * 180, 3);
    expect(unit.points).toBeCloseTo(unit.units * 2 * 180, 3);
    expect(usd.cash).toBeCloseTo(unit.cash, 9);
  });
});

describe('ytEntryLimits', () => {
  it('free limit at maturity matches the closed form', () => {
    const { free } = ytEntryLimits({ ...yt }, 10);
    // cash = 0 ⇔ YT price = (1+a)^t − 1  ⇔  r = (1 / (2 − (1+a)^t))^(365/D) − 1
    const g = Math.pow(1.08, 180 / 365);
    const expected = (Math.pow(1 / (2 - g), 365 / 180) - 1) * 100;
    expect(free).toBeCloseTo(expected, 6);
  });

  it('budget limit loses exactly the budget and sits above the free limit', () => {
    const input = { ...yt, holdDays: 30, feePercent: 0.5 };
    const { free, budget } = ytEntryLimits(input, 5);
    expect(free).not.toBeNull();
    expect(budget!).toBeGreaterThan(free!);
    expect(simulateYt({ ...input, entryAPY: budget!, exitAPY: budget! }).cashPercent).toBeCloseTo(-5, 5);
    expect(simulateYt({ ...input, entryAPY: free!, exitAPY: free! }).cashPercent).toBeCloseTo(0, 5);
  });

  it('returns null when no entry rate can meet the target', () => {
    expect(maxEntryAPY(() => -1, 0)).toBeNull();
    expect(ytEntryLimits({ ...yt, baseAPY: 0 }, 0).free).toBeNull();
  });
});

describe('simulatePt', () => {
  it('to maturity locks the implied rate', () => {
    const r = simulatePt({ capital: 1000, daysToMaturity: 200, entryAPY: 9, holdDays: 200, exitAPY: 0, feePercent: 0 });
    expect(r.value).toBeCloseTo(1000 * Math.pow(1.09, 200 / 365), 6);
    expect(r.annualized).toBeCloseTo(9, 9);
  });

  it('exit at the same rate earns the rate for the days held', () => {
    const r = simulatePt({ capital: 1000, daysToMaturity: 200, entryAPY: 9, holdDays: 50, exitAPY: 9, feePercent: 0 });
    expect(r.annualized).toBeCloseTo(9, 9);
  });

  it('break-even exit APY returns the capital', () => {
    const i = { capital: 1000, daysToMaturity: 200, entryAPY: 9, holdDays: 50, exitAPY: 0, feePercent: 0.3 };
    const r = simulatePt(i);
    expect(r.breakEvenExitAPY).toBeGreaterThan(9);
    expect(simulatePt({ ...i, exitAPY: r.breakEvenExitAPY }).profit).toBeCloseTo(0, 6);
  });
});

describe('simulateLoop', () => {
  it('matches the loops-based calculator at the same leverage', () => {
    const loops = calculateLooping({ capital: 10_000, ptPrice: 0.95, ltv: 75, loops: 3, borrowAPY: 5, daysToMaturity: 120 });
    const apy = impliedAPYFromPT(0.95, 120);
    const r = simulateLoop({ capital: 10_000, daysToMaturity: 120, entryAPY: apy, leverage: loops.leverage, borrowAPY: 5, lltv: 90, feePercent: 0 });
    expect(r.profit).toBeCloseTo(loops.profitToMaturity, 6);
    expect(r.netAPY).toBeCloseTo(loops.netAPY, 6);
    expect(r.breakEvenBorrowAPY).toBeCloseTo(loops.breakEvenBorrowAPY, 6);
  });

  it('matches the liquidation model', () => {
    const apy = impliedAPYFromPT(0.95, 120);
    const r = simulateLoop({ capital: 1000, daysToMaturity: 120, entryAPY: apy, leverage: 3, borrowAPY: 5, lltv: 86, feePercent: 0 });
    const liq = assessLiquidation(r.ltv, 86, 0.95, 120);
    expect(r.ltv).toBeCloseTo((2 / 3) * 100, 9);
    expect(r.healthFactor).toBeCloseTo(liq.healthFactor, 9);
    expect(r.liquidationPTPrice).toBeCloseTo(liq.liquidationPTPrice, 9);
    expect(r.liquidationAPY).toBeCloseTo(liq.liquidationImpliedAPY, 6);
  });

  it('leverage 1 equals plain PT', () => {
    const r = simulateLoop({ capital: 1000, daysToMaturity: 90, entryAPY: 7, leverage: 1, borrowAPY: 50, lltv: 86, feePercent: 0 });
    expect(r.debt).toBe(0);
    expect(r.netAPY).toBeCloseTo(7, 9);
    expect(r.healthFactor).toBe(Infinity);
  });

  it('max leverage hits the minimum health factor', () => {
    const L = maxLoopLeverage(86, 1.15, 0.2);
    const r = simulateLoop({ capital: 1000, daysToMaturity: 90, entryAPY: 7, leverage: L, borrowAPY: 5, lltv: 86, feePercent: 0.2 });
    expect(r.healthFactor).toBeCloseTo(1.15, 9);
  });
});

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
  categories: ['stables'],
  isNew: false,
  expired: false,
  daysToMaturity: 120,
  ...over,
});

describe('screens', () => {
  it('YT: cheap markets rank first and zones follow the cash result', () => {
    const rows = screenYt(
      [listing({ id: 'dear', impliedAPY: 20, baseAPY: 5 }), listing({ id: 'cheap', impliedAPY: 4, baseAPY: 9 }), listing({ id: 'nopts', hasPoints: false })],
      defaultScreenSettings,
    );
    expect(rows.map((r) => r.m.id)).toEqual(['cheap', 'dear']);
    expect(rows[0].zone).toBe('free');
    expect(rows[0].costPerKDay).toBeLessThan(0);
    expect(rows[1].zone).toBe('expensive');
    expect(rows[0].m.impliedAPY).toBeLessThanOrEqual(rows[0].freeLimit!);
    expect(rows[1].m.impliedAPY).toBeGreaterThan(rows[1].budgetLimit!);
  });

  it('PT: zone from spread vs base, limit never below the market', () => {
    const [a, b] = screenPt([listing({ id: 'a', impliedAPY: 12, baseAPY: 6 }), listing({ id: 'b', impliedAPY: 5, baseAPY: 8 })], defaultScreenSettings);
    expect(a.zone).toBe('strong');
    expect(a.limitAPY).toBe(12);
    expect(b.zone).toBe('weak');
    expect(b.limitAPY).toBe(9);
    expect(b.limitPrice).toBeLessThan(b.ptPrice);
  });

  it('Loop: listed markets and stable candidates only', () => {
    const rows = screenLoop(
      [listing({ id: 'listed', categories: ['pt-looping'], name: 'wstETH' }), listing({ id: 'eth', categories: ['eth'], name: 'weETH' }), listing({ id: 'usd' })],
      defaultScreenSettings,
      { leverage: 3, borrowAPY: 5, lltv: 86 },
    );
    expect(rows.map((r) => [r.m.id, r.listed])).toEqual([
      ['listed', true],
      ['usd', false],
    ]);
  });
});

describe('API APY plausibility', () => {
  it('treats absurd base APYs as unknown instead of yield', async () => {
    const { plausibleAPY } = await import('../../src/lib/protocols/base');
    expect(plausibleAPY(13.68)).toBe(13.68);
    expect(plausibleAPY(1552741.82)).toBeNull();
    expect(plausibleAPY(NaN)).toBeNull();
    expect(plausibleAPY(null)).toBeNull();
    expect(plausibleAPY(-150)).toBeNull();
  });
});
