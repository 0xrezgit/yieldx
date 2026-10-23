import { describe, expect, it } from 'vitest';
import { isStockToken, logoOf, referencePrices, stockTicker, vetPool, type PoolFeeData, type RawItem } from '../../src/lib/lp/pools';
import { capFactor, chainNotice, fullRangeUsd, positionRewardApr, rewardAprPct, rewardToRevenue, weeklyRevenue, type PoolReward } from '../../src/lib/lp/rewards';
import { expectedDaysInRange, stayInRange, symmetricRange } from '../../src/lib/lp/range-time';
import { estimatePool } from '../../src/lib/lp/estimate';
import { scenario } from '../../src/lib/lp/scenarios';
import { toPrefill } from '../../src/components/tools/LpPools';

// Recorded 2026-10-23 from vfat (/v4/yield-opportunities, /v4/pool-history) and Base
// (stakedLiquidity(), unstakedFee() of the pool): Aero CL EURC/USDC on Base, two days
// after the Aero launch — the pool of the «4,000% AERO APR» post.

const NOW = Date.parse('2026-10-23T09:00:00Z');
const EURC = { address: '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42', symbol: 'EURC', decimals: 6, price: 1.1188688975934744 };
const USDC = { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, price: 0.99983572 };
const STAKED_L = '259134721490251';

const aeroItem = (over: { stake?: boolean; protocol?: string; created?: string } = {}): RawItem => ({
  id: '8453:0x6eaec4f69c92bd16a4b018ceb6fe7a446a113598:poolId=',
  chainId: 8453,
  isWhitelisted: true,
  firstSeenAt: '2026-10-21T14:51:04.329Z',
  pool: {
    address: '0x6eaec4f69c92bd16a4b018ceb6fe7a446a113598',
    type: 'concentrated',
    underlying: [EURC, USDC],
    createdAt: over.created ?? '2026-10-21T05:28:59.000Z',
    currentFee: 100,
    sqrtPrice: '83810287952243311449661264394',
    assetCorrelation: {
      baseTokenAddress: EURC.address,
      relativeRealizedVolatilityAnnualizedPercent: 6.09,
      relativePriceMovePercentiles: [{ horizonHours: 168, p95DownMovePercent: 1.52, p95UpMovePercent: 0.73 }],
    },
  },
  options: [
    { id: '8453:0x6eae…:lp', kind: 'lp', type: 'UNISWAP_V3', totalLiquidity: 366909.79, feesUsd7d: 0, weeklyRewards: [], protocol: { id: over.protocol ?? 'aero', name: 'Aero' } },
    ...(over.stake === false
      ? []
      : [
          {
            id: '8453:0xc9fb…:stake',
            kind: 'lp-stake',
            type: 'AERO_CL_GAUGE',
            totalLiquidity: 345351.23,
            feesUsd7d: 0,
            weeklyRewards: [{ type: 'onchain', token: { symbol: 'AERO' }, amountUsd: 3118.638709692459 }],
            protocol: { id: over.protocol ?? 'aero', name: 'Aero' },
          },
        ]),
  ],
});

const HISTORY: PoolFeeData['history'] = {
  token0: { address: EURC.address, decimals: 6 },
  token1: { address: USDC.address, decimals: 6 },
  points: [
    { timestamp: '2026-10-21T00:00:00.000Z', volumeUsd: 0, feePercent: 0.01, protocolFeesUsd: 0, averageLiquidity: '0', closePriceToken1PerToken0: 1.1226835559342465 },
    { timestamp: '2026-10-22T00:00:00.000Z', volumeUsd: 1517152.0255079535, feePercent: 0.01, protocolFeesUsd: 0, averageLiquidity: '96654947284793.83', closePriceToken1PerToken0: 1.1220480259214234 },
  ],
};
const DATA: PoolFeeData = { history: HISTORY, unstakedFee: 0.05, stakedLiquidity: STAKED_L };

const vet = (it: RawItem, data?: PoolFeeData | null) => vetPool(it, referencePrices([it]), NOW, data);
function kept(it: RawItem, data?: PoolFeeData | null) {
  const r = vet(it, data);
  if (typeof r === 'string') throw new Error(r);
  return r;
}

describe('Aero: a new pool is kept for its staked AERO rate', () => {
  it('EURC/USDC: euro against the dollar, two days old, no fee history — kept, fee rate unknown', () => {
    const p = kept(aeroItem(), DATA);
    expect(p.tokens.map((t) => [t.symbol, t.cls])).toEqual([
      ['EURC', 'eur'],
      ['USDC', 'usd'],
    ]);
    expect(p.stable).toBe(false);
    expect(p.feeAprPct).toBeNull();
    // Base keeps 5% of an unstaked LP's fees: known even before there is a fee rate.
    expect(p.unstakedFee).toBe(0.05);
    expect(p.ageDays).toBeLessThan(3);
    expect(p.venueUrl).toBe('https://app.aero.xyz/pools/8453-0x6eaec4f69c92bd16a4b018ceb6fe7a446a113598');
    expect(p.legacyGauge).toBe(false);
    expect(p.reward?.token).toBe('AERO');
    expect(p.reward?.url).toBe('https://vfat.io/farm?farmId=8453%3A0xc9fb%E2%80%A6%3Astake');
  });

  it('the rate is per unit of staked in-range liquidity: ~0.03%/yr for a full-range dollar, ~85% at ±0.07%', () => {
    const r = kept(aeroItem(), DATA).reward!;
    // 2·L·√P in USDC: ~$548M of full-range liquidity is staked inside the current price.
    expect(r.stakedFullRangeUsd).toBeCloseTo(fullRangeUsd(Number(STAKED_L), 83810287952243311449661264394, 6, USDC.price), 0);
    expect(r.stakedFullRangeUsd / 1e6).toBeGreaterThan(540);
    expect(r.stakedFullRangeUsd / 1e6).toBeLessThan(555);
    expect(r.aprPct).toBeCloseTo(rewardAprPct(3118.638709692459, r.stakedFullRangeUsd), 9);
    expect(r.aprPct).toBeGreaterThan(0.029);
    expect(r.aprPct).toBeLessThan(0.031);
    const narrow = positionRewardApr(r, symmetricRange(0.07), 42.66, false);
    expect(narrow).toBeGreaterThan(80);
    expect(narrow).toBeLessThan(90);
  });

  it('revenue from the history: leading empty days skipped — ~$1,060 a week, so rewards are ~2.9× revenue', () => {
    const r = kept(aeroItem(), DATA).reward!;
    expect(r.revenueDays).toBe(1);
    expect(r.revenueWeeklyUsd!).toBeCloseTo(1517152.0255 * 0.0001 * 7, 2);
    expect(rewardToRevenue(r)!).toBeCloseTo(2.94, 2);
    // At Aero's cap target (1.2× revenue), ~41% of today's rate is left.
    expect(capFactor(r)).toBeCloseTo(1.2 / 2.94, 2);
    expect(positionRewardApr(r, symmetricRange(0.07), 42.66, true)).toBeCloseTo(positionRewardApr(r, symmetricRange(0.07), 42.66, false) * capFactor(r), 9);
  });

  it('a large deposit shares the rewards: $100k at ±0.07% earns about a third less', () => {
    const r = kept(aeroItem(), DATA).reward!;
    const small = positionRewardApr(r, symmetricRange(0.07), 100, false);
    const big = positionRewardApr(r, symmetricRange(0.07), 100_000, false);
    expect(big / small).toBeGreaterThan(0.6);
    expect(big / small).toBeLessThan(0.7);
  });

  it('without the staked liquidity there is no rate: asked again, not shown', () => {
    expect(vet(aeroItem())).toBe('history');
    expect(vet(aeroItem(), { ...DATA, stakedLiquidity: null })).toBe('history');
  });

  it('a young pool without AERO keeps the age rule', () => {
    expect(vet(aeroItem({ stake: false }), DATA)).toBe('age');
    expect(vet(aeroItem({ protocol: 'uniswap' }), DATA)).toBe('age');
  });

  it('an old Aerodrome pool with a gauge is flagged: no AERO since the launch, staked liquidity earns nothing', () => {
    const it = aeroItem({ protocol: 'aerodrome', created: '2026-01-01T00:00:00Z' });
    it.options![1].weeklyRewards = [];
    it.options![0].feesUsd7d = 1000;
    // An old pool still needs its fee history for a fee rate.
    const p = kept(it, { ...DATA, history: { ...HISTORY, points: Array.from({ length: 20 }, () => HISTORY!.points![1]) } });
    expect(p.legacyGauge).toBe(true);
    expect(p.reward).toBeNull();
    expect(p.venueUrl).toBeNull();
    expect(p.feeAprPct!).toBeGreaterThan(0);
  });
});

describe('Aero: stake or not', () => {
  it('only AERO: the estimate is the staked mode, with the cap applied', () => {
    const p = kept(aeroItem(), DATA);
    const e = estimatePool(p, 1000, 30)!;
    expect(e.mode).toBe('stake');
    expect(e.feesUsd).toBe(0);
    expect(e.capped).toBe(true);
    expect(e.otherNetUsd).toBeNull();
    expect(e.rewardsUsd).toBeCloseTo(1000 * (30 / 365) * (positionRewardApr(p.reward!, e.shape, 1000, true) / 100), 9);
  });

  it('both: the better one is the figure, the other is shown beside it', () => {
    const p = { ...kept(aeroItem(), DATA), feeAprPct: 5 };
    const e = estimatePool(p, 1000, 30)!;
    expect(e.mode).toBe('fees');
    expect(e.otherNetUsd).not.toBeNull();
    expect(e.netUsd).toBeGreaterThan(e.otherNetUsd!);
    const rich = { ...p, feeAprPct: 0.001 };
    expect(estimatePool(rich, 1000, 30)!.mode).toBe('stake');
  });

  it('staked rewards are paid only in range, like fees', () => {
    const base = { capital: 1000, days: 30, shape: symmetricRange(1), feeAprPct: 0, rewardUsd: null, rewardAprPct: 50, costsUsd: 0 };
    expect(scenario({ ...base, rewardBasis: 'in-range' }, 0).rewardsUsd).toBeCloseTo(1000 * 0.5 * (30 / 365), 6);
    const out = scenario({ ...base, rewardBasis: 'in-range' }, 0.04);
    expect(out.inRange).toBeCloseTo(0.25, 6);
    expect(out.rewardsUsd).toBeLessThan(scenario(base, 0.04).rewardsUsd * 0.3);
  });

  it('into the analyzer: reward, mode, volatility, chain and the Aero page', () => {
    const p = kept(aeroItem(), DATA);
    const pre = toPrefill(p, 1000, 30, 'stake');
    expect(pre.mode).toBe('stake');
    expect(pre.feeApr).toBeNull();
    expect(pre.reward).toBe(p.reward);
    expect(pre.vol).toBe(6.09);
    expect(pre.chainId).toBe(8453);
    expect(pre.venueUrl).toBe(p.venueUrl);
    expect(toPrefill({ ...p, feeAprPct: 5 }, 1000, 30, 'fees').mode).toBe('fees');
  });
});

describe('how long the price stays in range', () => {
  it('EURC/USDC (σ 6.09%/yr): ±0.07% lasts about an hour on average, ±1% about ten days', () => {
    expect(expectedDaysInRange(symmetricRange(0.07), 6.09) * 24).toBeGreaterThan(1);
    expect(expectedDaysInRange(symmetricRange(0.07), 6.09) * 24).toBeLessThan(1.3);
    // a²/σ² for a symmetric range: (0.01 / 0.0609)² years ≈ 9.8 days.
    expect(expectedDaysInRange(symmetricRange(1), 6.09)).toBeCloseTo(9.84, 1);
    expect(expectedDaysInRange({ kind: 'full' }, 6.09)).toBe(Infinity);
    expect(expectedDaysInRange(symmetricRange(1), 0)).toBeNaN();
  });

  it('the chance falls with time and with a narrower range; full range always stays', () => {
    const r = symmetricRange(0.5);
    const at = [1, 7, 30, 90].map((d) => stayInRange(r, 6.09, d));
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeLessThan(at[i - 1]);
    expect(stayInRange(symmetricRange(0.07), 6.09, 1)).toBeLessThan(0.01);
    expect(stayInRange({ kind: 'full' }, 6.09, 30)).toBe(1);
    expect(stayInRange(r, 6.09, 0)).toBe(1);
  });

  it('series and short-time (images) forms agree where both hold', () => {
    // A wide range over one day: the series needs many terms, the images form is exact there.
    const wide = symmetricRange(20);
    const p = stayInRange(wide, 40, 1);
    expect(p).toBeGreaterThan(0.999);
    // ±5% at σ 40% over 1.43 days (σ√t = 2.5%): the series and 1 − 2Φ(−x₀/σ√t) − 2Φ(−(W−x₀)/σ√t),
    // both computed independently, give 0.90818.
    expect(stayInRange(symmetricRange(5), 40, 1.43)).toBeCloseTo(0.90818, 4);
  });
});

describe('new asset classes and venues', () => {
  it('gold is priced against the median of its kind; a «PAXG» at $1 is not gold', () => {
    const PAXG = { address: '0x00000000000000000000000000000000000a0001', symbol: 'PAXG', decimals: 18, price: 4100 };
    const it = (price: number): RawItem => ({ ...aeroItem({ created: '2026-01-01T00:00:00Z' }), id: `gold-${price}`, pool: { ...aeroItem().pool!, type: 'volatile', underlying: [{ ...PAXG, price }, USDC], assetCorrelation: { ...aeroItem().pool!.assetCorrelation!, baseTokenAddress: PAXG.address } } });
    const good = it(4100);
    good.options![0].feesUsd7d = 2000;
    const p = vetPool(good, referencePrices([good, it(4110), it(4090)]), NOW, null);
    if (typeof p === 'string') throw new Error(p);
    expect(p.tokens[0].cls).toBe('gold');
    const fake = it(1);
    fake.options![0].feesUsd7d = 2000;
    expect(vetPool(fake, referencePrices([good, it(4110), fake]), NOW, null)).toBe('price');
  });

  it('Coinbase stocks on Base are known by address, their logo by the ticker without the «c»', () => {
    expect(isStockToken(8453, '0xb20000000000000000000078ee7ce2fe4908108c')).toBe(true);
    expect(isStockToken(8453, '0xb20000000000000000000078ee7ce2fe4908108d')).toBe(false);
    expect(stockTicker('NVDAc')).toBe('NVDA');
    expect(stockTicker('NVDA')).toBe('NVDA');
    expect(logoOf('NVDAc', 'stock')).toMatch(/\/NVDA\.png$/);
  });

  it('chain-wide notices from the Aero launch', () => {
    expect(chainNotice(1135)).toEqual({ kind: 'withdraw', by: '2026-10-31' });
    expect(chainNotice(42220)).toEqual({ kind: 'sunset' });
    expect(chainNotice(8453)).toBeNull();
  });

  it('weekly revenue: the last seven trading days, none → unknown', () => {
    expect(weeklyRevenue([])).toBeNull();
    expect(weeklyRevenue([{ volumeUsd: 0, feePercent: 0.05 }])).toBeNull();
    const ten = Array.from({ length: 10 }, (_, i) => ({ volumeUsd: (i + 1) * 1000, feePercent: 0.1 }));
    // Days 4…10: mean 7,000 a day × 0.1% × 7.
    expect(weeklyRevenue(ten)).toEqual({ usd: 7000 * 0.001 * 7, days: 7 });
  });

  it('a reward without revenue is not capped', () => {
    const r: Pick<PoolReward, 'weeklyUsd' | 'revenueWeeklyUsd'> = { weeklyUsd: 1000, revenueWeeklyUsd: null };
    expect(capFactor(r)).toBe(1);
    expect(capFactor({ weeklyUsd: 1000, revenueWeeklyUsd: 2000 })).toBe(1);
  });
});
