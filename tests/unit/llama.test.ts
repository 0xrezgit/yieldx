import { describe, expect, it } from 'vitest';
import { isSpike, kinds, matches, presetById, toPool, tokenKind, type RawPool, type YieldPool } from '../../src/lib/llama/yields';
import { annualised, dailyYields, exitLabel, feeBps, fromPrices, growthFromPrices, instantShare, onePerContract, profitOf, stability, type HolderSim, type VerifiedPool } from '../../src/lib/llama/verify';
import { robustRate } from '../../src/lib/opportunity/robust-rate';

const protocols = new Map([
  ['aave-v3', { slug: 'aave-v3', name: 'Aave V3', category: 'Lending', audits: '2' }],
  ['lido', { slug: 'lido', name: 'Lido', category: 'Liquid Staking', audits: '2' }],
  ['shady', { slug: 'shady', name: 'Shady', category: 'Yield', audits: '0' }],
]);
const raw = (over: Partial<RawPool>): RawPool => ({ pool: 'p', chain: 'Ethereum', project: 'aave-v3', symbol: 'USDC', tvlUsd: 5e7, apy: 5, apyBase: 5, apyMean30d: 5, stablecoin: true, exposure: 'single', ilRisk: 'no', ...over });
const pool = (over: Partial<RawPool>) => toPool(raw(over), protocols) as YieldPool;
const sim = (value: number, out: number, status: HolderSim['status'] = out >= value ? 'full' : out > 0 ? 'partial' : 'blocked'): HolderSim => ({ address: '0x1', name: null, contract: false, value, usd: value, sharePct: 10, status, asWallet: false, out, feeBps: feeBps(value, out) });

describe('DefiLlama candidates', () => {
  it('joins protocol name, category and audits', () => {
    const p = pool({});
    expect(p.projectName).toBe('Aave V3');
    expect(p.audited).toBe(true);
    expect(pool({ project: 'shady' }).audited).toBe(false);
    expect(pool({ project: 'unknown' }).audited).toBe(false);
  });

  it('marks one-day spikes of the announced rate', () => {
    expect(isSpike(515, 14.8)).toBe(true);
    expect(isSpike(13.7, 13)).toBe(false);
    expect(isSpike(15, 3)).toBe(false); // under 20 %
  });

  it('classifies tokens', () => {
    expect(kinds('WSTETH-USDC')).toEqual(['eth', 'usd']);
    expect(tokenKind('cbBTC')).toBe('btc');
    expect(tokenKind('JITOSOL')).toBe('sol');
    expect(tokenKind('XAUT0')).toBe('commodity');
    expect(tokenKind('EGLD')).toBe('other');
  });

  it('applies the dashboard presets and search', () => {
    const t = (id: string, p: YieldPool) => presetById(id).test(p);
    expect(t('stables', pool({ tvlUsd: 2e6 }))).toBe(true);
    expect(t('stables', pool({ tvlUsd: 5e5 }))).toBe(false);
    expect(t('majors', pool({ symbol: 'WETH-USDC', exposure: 'multi' }))).toBe(true);
    expect(t('majors', pool({ symbol: 'WETH-PEPE' }))).toBe(false);
    expect(t('majors', pool({ project: 'shady' }))).toBe(false);
    expect(t('commodities', pool({ symbol: 'PAXG', tvlUsd: 2e5 }))).toBe(true);
    expect(t('lst', pool({ project: 'lido', symbol: 'STETH' }))).toBe(true);
    expect(t('safe', pool({ exposure: 'multi' }))).toBe(false);
    expect(t('high', pool({ apy: 12 }))).toBe(true);
    expect(t('high', pool({ apy: 9 }))).toBe(false);
    expect(matches(pool({ symbol: 'USDT' }), 'all', 'usdt aave')).toBe(true);
    expect(matches(pool({ symbol: 'USDT' }), 'all', 'usdc')).toBe(false);
  });
});

describe('own verification', () => {
  it('annualises share-price growth', () => {
    expect(annualised(1, 1.1, 365)).toBeCloseTo(10, 9);
    expect(annualised(1, Math.pow(1.1, 30 / 365), 30)).toBeCloseTo(10, 9);
    expect(annualised(0, 1, 30)).toBeNull();
    // A new vault's price jumping from almost zero is not a yield.
    expect(annualised(1e-9, 1, 7)).toBeNull();
  });

  it('measures yields and stability from share prices at day offsets', () => {
    // A steady 10 % a year: every step the same.
    const pps = new Map<number, number | null>([0, 5, 7, 10, 15, 20, 25, 30, 90].map((d) => [d, Math.pow(1.1, -d / 365)]));
    const r = fromPrices(pps, 5, 30, 90);
    expect(r.measured.d7).toBeCloseTo(10, 6);
    expect(r.measured.d30).toBeCloseTo(10, 6);
    expect(r.measured.d90).toBeCloseTo(10, 6);
    expect(r.stability).toBe(100);
    // A vault younger than 90 days.
    pps.set(90, null);
    expect(fromPrices(pps, 5, 30, 90).measured.d90).toBeNull();
  });

  it('scores swinging yields lower', () => {
    expect(stability([10, 10, 10])).toBe(100);
    expect(stability([5, 15, 5, 15])).toBe(50);
    expect(stability([20, 0, 0, 0])).toBe(0);
    expect(stability([10, 10])).toBeNull();
  });

  it('sums what the simulated holders got out', () => {
    expect(instantShare([sim(100, 99.9), sim(100, 100)])).toBeCloseTo(99.95, 9);
    expect(exitLabel({ instantPct: instantShare([sim(100, 99.9), sim(100, 100)]) })).toBe('instant');
    expect(exitLabel({ instantPct: instantShare([sim(67, 0), sim(33, 33)]) })).toBe('partial');
    expect(exitLabel({ instantPct: instantShare([sim(100, 0)]) })).toBe('queued');
    expect(feeBps(10_000, 9_990)).toBeCloseTo(10, 9);
    expect(feeBps(100, 0)).toBeNull();
  });

  it('grows a deposit by the share price', () => {
    const g = growthFromPrices(1000, 1, 1.0644, 183);
    expect(g?.gain).toBeCloseTo(64.4, 6);
    expect(g?.returnPct).toBeCloseTo(6.44, 6);
    expect(growthFromPrices(0, 1, 1.1, 30)).toBeNull();
  });

  it('keeps one row per contract: the announced rate nearest to the measured one', () => {
    const v = (id: string, apyBase: number, tvlUsd: number, address = '0xAbC'): VerifiedPool => ({
      ...pool({ pool: id, apyBase, tvlUsd }),
      address,
      kind: 'erc4626',
      liquidityPct: null,
      block: 1,
      day: 0,
      measured: { d7: 1, d30: 1.05, d90: null },
      stability: 90,
      robust: robustRate(Array(30).fill(1.05)),
      holdersCount: null,
      holdersFromLogs: null,
      sims: [],
      instantPct: 100,
      coveredPct: 50,
    });
    const { kept, dropped } = onePerContract([v('fixed-1', 4.3, 1.6e6), v('floating', 1.03, 1.6e6, '0xabc'), v('fixed-2', 4.0, 1.6e6), v('other', 5, 1e6, '0xdef')]);
    expect(kept.map((p) => p.id).sort()).toEqual(['floating', 'other']);
    expect(dropped).toHaveLength(2);
  });

  it('turns daily share prices into daily yields, skipping the launch days', () => {
    // A steady 10 % a year for a vault that existed the whole window.
    const steady = new Map<number, number | null>(Array.from({ length: 31 }, (_, d) => [d, Math.pow(1.1, -d / 365)]));
    const y = dailyYields(steady, 30);
    expect(y).toHaveLength(30);
    expect(y[0]).toBeCloseTo(10, 6);
    // Launched 6 days ago: before it null, then its first two days skipped.
    const young = new Map<number, number | null>(Array.from({ length: 31 }, (_, d) => [d, d > 6 ? null : 1 + (6 - d) * 0.0003]));
    const yy = dailyYields(young, 30);
    expect(yy.filter((x) => x !== null)).toHaveLength(4);
    expect(robustRate(yy).young).toBe(true);
  });

  it('leaves Aave loan collateral out of the exit figure', () => {
    expect(instantShare([sim(100, 100), { ...sim(900, 0), status: 'collateral' }])).toBe(100);
  });

  it('prices the profit on the robust rate', () => {
    const base = { sims: [sim(100, 99.9), sim(100, 100), sim(100, 99.8)] };
    const robust = robustRate(Array(30).fill(10));
    const p = profitOf({ ...base, robust }, 1000, 365, 2);
    expect(p?.gross).toBeCloseTo(100, 9);
    expect(p?.exitFee).toBeCloseTo(1, 9); // median 10 bps
    expect(p?.net).toBeCloseTo(97, 9);
    expect(profitOf({ ...base, robust: robustRate([10]) }, 1000, 30, 2)).toBeNull();
  });
});
