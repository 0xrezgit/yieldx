import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketListing } from '../../src/types/market';
import type { Estimate, Opportunity, RewardStream } from '../../src/types/opportunity';
import { periodGrowth } from '../../src/lib/opportunity/rates';
import { estimate, type EstimateInput } from '../../src/lib/opportunity/estimate';
import { dedupeOpportunities, rankEstimates } from '../../src/lib/opportunity/rank';
import { ptOpportunity } from '../../src/lib/opportunity/from-market';
import { maturityState, withLifecycle } from '../../src/lib/protocols/lifecycle';
import { UpstreamError, fetchJson, isArrayOf } from '../../src/lib/protocols/base';

// Every number here is controlled test data for the formulas, not market data.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const opp = (over: Partial<Opportunity> = {}): Opportunity => ({
  key: 'test:eip155:1:0xabc:supply',
  family: 'lend',
  protocol: { id: 'test', version: null, name: 'Test' },
  chain: 'eip155:1',
  market: { id: 'm', address: '0xabc', name: 'USDC' },
  assets: { deposit: [{ symbol: 'USDC', address: '0xa0b8' }] },
  rate: { value: 10, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: new Date(NOW).toISOString() },
  maturity: null,
  capacity: { depositRemainingUsd: null, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  quality: 'current',
  sources: [],
  ...over,
});

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({ capital: 1000, days: 30, now: NOW, ...over });

const reward = (over: Partial<RewardStream> = {}): RewardStream => ({
  key: '1:campaign-a',
  source: 'merkl',
  kind: 'token',
  token: null,
  aprUsd: 20,
  endsAt: inDays(10),
  conditional: false,
  vesting: false,
  ...over,
});

describe('rate rules (APR ≠ APY)', () => {
  it('10% for 30 days: APY ≈ 7.86 and simple APR ≈ 8.22 on 1000', () => {
    expect(1000 * periodGrowth({ value: 10, kind: 'apy' }, 30)!).toBeCloseTo(7.864, 2);
    expect(1000 * periodGrowth({ value: 10, kind: 'apr' }, 30)!).toBeCloseTo(8.219, 2);
  });

  it('uses a stated compounding for APR, and the simple reading when the kind is unknown', () => {
    const daily = 1000 * periodGrowth({ value: 10, kind: 'apr', compoundsPerYear: 365 }, 30)!;
    expect(daily).toBeCloseTo(1000 * (Math.pow(1 + 0.1 / 365, 30) - 1), 6);
    expect(periodGrowth({ value: 10, kind: 'unknown' }, 30)).toBeCloseTo(periodGrowth({ value: 10, kind: 'apr' }, 30)!, 12);
  });

  it('has no yearly-rate reading for a quote, and none without a rate', () => {
    expect(periodGrowth({ value: 10, kind: 'quote' }, 30)).toBeNull();
    expect(periodGrowth({ value: null, kind: 'apy' }, 30)).toBeNull();
  });
});

describe('estimate — shared rules', () => {
  it('counts a campaign only until it ends (10 of 30 days)', () => {
    const e = estimate(opp({ rate: { ...opp().rate, value: 0 }, rewards: [reward()] }), input());
    expect(e.rewards).toBeCloseTo((1000 * 0.2 * 10) / 365, 6); // ≈ 5.48, not 16.44
    expect(e.rewardLines[0].days).toBe(10);
  });

  it('dilutes a reward by the user’s own capital when budget and TVL are known', () => {
    const e = estimate(opp({ rate: { ...opp().rate, value: 0 }, rewards: [reward({ dailyUsd: 100, eligibleTvlUsd: 9000 })] }), input());
    expect(e.rewards).toBeCloseTo(100 * (1000 / 10_000) * 10, 6);
  });

  it('counts one campaign once, even when two sources report it', () => {
    const e = estimate(opp({ rate: { ...opp().rate, value: 0 }, rewards: [reward(), reward({ source: 'protocol' })] }), input());
    expect(e.rewardLines).toHaveLength(1);
    const merged = dedupeOpportunities([opp({ rewards: [reward()] }), opp({ rewards: [reward({ source: 'protocol' }), reward({ key: '1:campaign-b' })] })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rewards.map((r) => r.key)).toEqual(['1:campaign-a', '1:campaign-b']);
  });

  it('never deducts a fee already inside the rate', () => {
    const inside = estimate(opp({ rate: { ...opp().rate, feesIncluded: true, fees: { performancePct: 10 } } }), input());
    expect(inside.costs.find((c) => c.key === 'performance-fee')).toBeUndefined();
    const outside = estimate(opp({ rate: { ...opp().rate, feesIncluded: false, fees: { performancePct: 10 } } }), input());
    expect(outside.costs.find((c) => c.key === 'performance-fee')!.usd).toBeCloseTo(outside.baseIncome! * 0.1, 9);
  });

  it('adds no reward on top of a rate that already contains rewards', () => {
    const e = estimate(opp({ rate: { ...opp().rate, rewardsIncluded: true }, rewards: [reward()] }), input());
    expect(e.rewards).toBe(0);
    expect(e.net).toBeCloseTo(e.baseIncome!, 9);
  });

  it('never counts points or conditional rewards in dollars', () => {
    const e = estimate(opp({ rate: { ...opp().rate, value: 0 }, rewards: [reward({ kind: 'points' }), reward({ key: '1:c', conditional: true })] }), input());
    expect(e.rewards).toBe(0);
  });

  it('keeps capital that does not fit apart, earning nothing', () => {
    const e = estimate(opp({ capacity: { depositRemainingUsd: 600, withdrawableNowUsd: 1e9 } }), input());
    expect(e.allocatable).toBe(600);
    expect(e.unallocated).toBe(400);
    expect(e.baseIncome).toBeCloseTo(600 * (Math.pow(1.1, 30 / 365) - 1), 9);
    expect(e.unallocatedReason).not.toBeNull();
  });

  it('lists an unknown capacity instead of reading it as zero', () => {
    const e = estimate(opp(), input());
    expect(e.allocatable).toBe(1000);
    expect(e.unknown.some((u) => u.includes('ظرفیت'))).toBe(true);
  });

  it('never shows the profit to a maturity after the horizon as the horizon’s profit', () => {
    const o = opp({ family: 'pt', maturity: inDays(90), poolLiquidityUsd: 1e8 });
    const e = estimate(o, input());
    expect(e.placement).toBe('needs-model');
    expect(e.net).toBeNull();
    const hold = estimate(o, input({ days: 90 }));
    expect(hold.placement).toBe('ranked');
    expect(hold.earningDays).toBe(90);
  });

  it('earns nothing after a maturity inside the period', () => {
    const e = estimate(opp({ family: 'pt', maturity: inDays(10), poolLiquidityUsd: 1e8 }), input());
    expect(e.earningDays).toBe(10);
    expect(e.baseIncome).toBeCloseTo(1000 * (Math.pow(1.1, 10 / 365) - 1), 9);
  });

  it('treats a product without maturity as open, never expired', () => {
    const e = estimate(opp({ maturity: null }), input());
    expect(e.placement).toBe('ranked');
    expect(e.earningDays).toBe(30);
  });

  it('marks an unprofitable amount (fixed costs above income)', () => {
    const e = estimate(opp({ rate: { ...opp().rate, value: 4 } }), input({ capital: 100, entryCosts: [{ key: 'gas', label: 'گس', usd: 3, basis: 'measured' }], exitCosts: [{ key: 'gas-out', label: 'گس', usd: 3, basis: 'measured' }] }));
    expect(e.net).toBeLessThan(0);
    expect(e.placement).toBe('unprofitable');
  });

  it('moves stale data out of the top list', () => {
    const e = estimate(opp({ rate: { ...opp().rate, at: inDays(-3) } }), input());
    expect(e.quality).toBe('stale');
    expect(e.placement).toBe('stale');
  });

  it('gives LP, YT, borrow and a loop without its spec no dollar number', () => {
    for (const family of ['lp', 'leverage', 'yt', 'borrow'] as const) {
      const e = estimate(opp({ family }), input());
      expect(e.placement).toBe('needs-model');
      expect(e.net).toBeNull();
    }
  });

  it('marks an unknown fee basis as partial data', () => {
    const e = estimate(opp({ rate: { ...opp().rate, feesIncluded: 'unknown' } }), input());
    expect(e.quality).toBe('partial');
    expect(e.placement).toBe('ranked');
  });
});

describe('ranking', () => {
  const two = (capital: number, days: number, fixed = 0) =>
    rankEstimates([
      estimate(opp({ key: 'capped', rate: { ...opp().rate, value: 12 }, capacity: { depositRemainingUsd: 5000, withdrawableNowUsd: 1e9 } }), input({ capital, days })),
      estimate(opp({ key: 'open', rate: { ...opp().rate, value: 8 } }), input({ capital, days, entryCosts: fixed ? [{ key: 'gas', label: 'گس', usd: fixed, basis: 'measured' }] : [] })),
    ]);

  it('re-orders with the amount: capacity matters for large capital', () => {
    expect(two(1000, 30).top.map((e) => e.key)).toEqual(['capped', 'open']);
    // The capital that does not fit earns nothing, so the capped market falls behind — still ranked on its dollars.
    const big = two(100_000, 30);
    expect(big.top.map((e) => e.key)).toEqual(['open', 'capped']);
    expect(big.top[1].unallocated).toBeCloseTo(95_000, 6);
  });

  it('re-orders with the period: a fixed cost weighs more on a short one', () => {
    const cheapHigh = (days: number) =>
      rankEstimates([
        estimate(opp({ key: 'high-with-fee', rate: { ...opp().rate, value: 12 } }), input({ days, entryCosts: [{ key: 'gas', label: 'گس', usd: 5, basis: 'measured' }] })),
        estimate(opp({ key: 'low-free', rate: { ...opp().rate, value: 8 } }), input({ days })),
      ]).top.map((e) => e.key);
    expect(cheapHigh(7)).toEqual(['low-free']); // 12% for 7 days minus 5 dollars is below zero
    expect(cheapHigh(180)[0]).toBe('high-with-fee');
  });

  it('shows exactly as many rows as qualify, up to 60, keeping the rest', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => estimate(opp({ key: `k${i}`, rate: { ...opp().rate, value: 5 + i } }), input()));
    expect(rankEstimates(many(23)).top).toHaveLength(23);
    const r = rankEstimates(many(75));
    expect(r.top).toHaveLength(60);
    expect(r.rest).toHaveLength(15);
    expect(r.top[0].key).toBe('k74');
  });

  it('breaks ties by data quality', () => {
    const a: Estimate = { ...estimate(opp({ key: 'a' }), input()), quality: 'partial' };
    const b = estimate(opp({ key: 'b' }), input());
    expect(rankEstimates([a, b]).top.map((e) => e.key)).toEqual(['b', 'a']);
  });
});

describe('lifecycle', () => {
  it('reads no maturity as open, a bad date as invalid, a past one as matured', () => {
    expect(maturityState(null, NOW)).toEqual({ state: 'open', days: null });
    expect(maturityState('', NOW)).toEqual({ state: 'open', days: null });
    expect(maturityState('not a date', NOW)).toEqual({ state: 'invalid', days: null });
    expect(maturityState(inDays(-1), NOW)).toEqual({ state: 'matured', days: 0 });
    expect(maturityState(inDays(2.5), NOW)).toEqual({ state: 'active', days: 3 });
  });

  it('keeps the PT list rule: active first, expired and unreadable last', () => {
    const row = (id: string, maturity: string, liquidity: number) => ({ id, maturity, liquidity }) as unknown as MarketListing;
    const list = withLifecycle([row('old', inDays(-1), 9e9), row('bad', 'x', 9e9), row('a', inDays(5), 1), row('b', inDays(5), 2)], NOW);
    expect(list.map((m) => [m.id, m.expired])).toEqual([
      ['b', false],
      ['a', false],
      ['old', true],
      ['bad', true],
    ]);
  });
});

describe('PT markets in the shared model', () => {
  const listing = (over: Partial<MarketListing> = {}): MarketListing => ({
    id: '1-0xmarket',
    name: 'sUSDe',
    platform: 'Ethena',
    icon: null,
    chain: 'Ethereum',
    maturity: inDays(60),
    impliedAPY: 10,
    baseAPY: 8,
    liquidity: 5e6,
    hasPoints: false,
    ytMultiplier: null,
    points: null,
    categories: [],
    isNew: false,
    asset: { symbol: 'sUSDe', address: '0x9d39' },
    sourceUpdatedAt: new Date(NOW).toISOString(),
    expired: false,
    daysToMaturity: 60,
    ...over,
  });

  it('maps implied APY as a fee-inclusive APY to maturity, keyed by network and address', () => {
    const o = ptOpportunity('pendle', listing(), new Date(NOW).toISOString(), NOW);
    expect(o.key).toBe('pendle:eip155:1:0xmarket:pt');
    expect(o.rate).toMatchObject({ value: 10, kind: 'apy', feesIncluded: true });
    expect(o.maturity).toBe(inDays(60));
    expect(o.poolLiquidityUsd).toBe(5e6);
    // Holding to maturity: 1000 × (1.10^(60/365) − 1).
    const e = estimate(o, input({ days: 60 }));
    expect(e.baseIncome).toBeCloseTo(1000 * (Math.pow(1.1, 60 / 365) - 1), 6);
  });

  it('keeps expired and stale PT data out of the top list', () => {
    expect(ptOpportunity('pendle', listing({ expired: true }), '', NOW).quality).toBe('insufficient');
    expect(ptOpportunity('pendle', listing({ sourceUpdatedAt: inDays(-1) }), '', NOW).quality).toBe('stale');
  });
});

describe('fetchJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a timeout into a 504 upstream error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }));
    await expect(fetchJson('X', 'https://x.test')).rejects.toMatchObject({ name: 'UpstreamError', status: 504 });
  });

  it('turns a network error and an unexpected shape into 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(fetchJson('X', 'https://x.test')).rejects.toBeInstanceOf(UpstreamError);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 200 })));
    await expect(fetchJson('X', 'https://x.test', isArrayOf)).rejects.toMatchObject({ status: 502 });
  });

  it('passes an abort signal so a hung API cannot block the route', async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fn);
    await expect(fetchJson('X', 'https://x.test', isArrayOf)).resolves.toEqual([]);
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
