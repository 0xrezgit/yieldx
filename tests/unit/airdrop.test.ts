import { describe, expect, it } from 'vitest';
import type { AirdropProgram } from '../../src/types/airdrop';
import { emptyProgram, normalizeProgram, pastValues, shares, stageOf, summarize } from '../../src/lib/portfolio/airdrop';
import { mergeAirdrops, parseBackup } from '../../src/lib/portfolio/portfolio';
import { coinId } from '../../src/hooks/useCoinPrice';

const base = (over: Partial<AirdropProgram> = {}): AirdropProgram => ({ ...emptyProgram('a1', 'Hylo XP', 1, 'p1'), ...over });
const claim = (amount: number, usdRate: number | null, extra = {}) => ({ id: `c${amount}`, at: '2026-08-01T00:00:00.000Z', amount, usdRate, feeUsd: 2, lockedAmount: 0, unlockAt: null, ...extra });
const sale = (amount: number, received: number, usdRate: number | null = 1) => ({ id: `s${amount}`, at: '2026-08-10T00:00:00.000Z', amount, received: { amount: received, token: 'USDC', usdRate, rateSource: 'manual' as const }, feeUsd: 1 });

describe('airdrop stages', () => {
  it('follows the lifecycle', () => {
    expect(stageOf(base())).toBe('collecting');
    expect(stageOf(base({ finalPoints: { amount: 12e6, at: '2026-07-01T00:00:00.000Z' } }))).toBe('pending');
    expect(stageOf(base({ claims: [claim(1000, 0.5)] }))).toBe('received');
    expect(stageOf(base({ claims: [claim(1000, 0.5)], sales: [sale(400, 300)] }))).toBe('selling');
    expect(stageOf(base({ claims: [claim(1000, 0.5)], sales: [sale(1000, 700)] }))).toBe('closed');
    expect(stageOf(base({ noAirdrop: true, claims: [claim(1, 1)] }))).toBe('none');
  });
});

describe('airdrop result', () => {
  const p = base({ finalPoints: { amount: 10e6, at: '2026-07-01T00:00:00.000Z' }, claims: [claim(1000, 0.5)], sales: [sale(400, 300)] });

  it('realized = proceeds − sale and claim fees; unrealized = remaining × price', () => {
    const s = summarize(p, 0.8);
    expect(s.sold).toBe(400);
    expect(s.remaining).toBe(600);
    expect(s.realizedUsd).toBeCloseTo(300 - 1 - 2, 9);
    expect(s.unrealizedUsd).toBeCloseTo(480, 9);
    expect(s.totalUsd).toBeCloseTo(777, 9);
    expect(s.avgSaleUsd).toBeCloseTo(0.75, 9);
  });

  it('actual value of 1M points = token value at claim ÷ millions of points', () => {
    expect(summarize(p, null).valuePerMillion).toBeCloseTo(50, 9); // 1000 × 0.5 / 10
  });

  it('keeps an unknown price unknown, never 0', () => {
    const s = summarize(p, null);
    expect(s.unrealizedUsd).toBeNull();
    expect(s.totalUsd).toBeNull();
    expect(summarize(base({ claims: [claim(100, null)] }), 1).valuePerMillion).toBeNull();
  });

  it('a fully sold airdrop needs no current price', () => {
    expect(summarize(base({ claims: [claim(100, 1)], sales: [sale(100, 90)] }), null).totalUsd).toBeCloseTo(87, 9);
  });

  it('reports locked tokens until they unlock', () => {
    const q = base({ claims: [claim(1000, 1, { lockedAmount: 300, unlockAt: '2026-12-01T00:00:00.000Z' })] });
    expect(summarize(q, 1, Date.UTC(2026, 9, 1)).locked).toBe(300);
    expect(summarize(q, 1, Date.UTC(2027, 0, 1)).locked).toBe(0);
  });

  it('"no airdrop" is a settled zero, not unknown', () => {
    expect(summarize(base({ noAirdrop: true }), null).totalUsd).toBe(0);
  });
});

describe('splitting one program between positions', () => {
  const p = base({ positionIds: ['p1', 'p2'] });
  it('pro rata by estimated points, or equal without estimates', () => {
    expect(shares(p, { p1: 300, p2: 100 })).toEqual({ p1: 0.75, p2: 0.25 });
    expect(shares(p, {})).toEqual({ p1: 0.5, p2: 0.5 });
  });
  it('a manual split wins and is normalised', () => {
    expect(shares({ ...p, shares: { p1: 20, p2: 60 } }, { p1: 300, p2: 100 })).toEqual({ p1: 0.25, p2: 0.75 });
  });
});

describe('last season as the next estimate', () => {
  it('finds earlier seasons of the same program (name normalised), latest first', () => {
    const s1 = base({ id: 's1', season: 1, finalPoints: { amount: 1e6, at: '2026-01-01T00:00:00.000Z' }, claims: [claim(100, 2)] });
    const s2 = base({ id: 's2', name: 'hylo  xp', season: 2, finalPoints: { amount: 2e6, at: '2026-05-01T00:00:00.000Z' }, claims: [claim(100, 3)] });
    const other = base({ id: 'o', name: 'Other', finalPoints: { amount: 1e6, at: '2026-01-01T00:00:00.000Z' }, claims: [claim(100, 9)] });
    const v = pastValues([s1, s2, other], 'Hylo XP', 'current');
    expect(v.map((x) => x.season)).toEqual([2, 1]);
    expect(v[0].valuePerMillion).toBeCloseTo(150, 9);
  });
});

describe('storage and backup', () => {
  it('round-trips through the backup file; old files without airdrops still load', () => {
    const p = base({ claims: [claim(10, 1)], token: { symbol: 'XYZ', chain: 'Solana', address: 'AbCdEfGhIjKlMnOpQrStUvWxYz123456789' } });
    const file = parseBackup(JSON.stringify({ version: 1, positions: [], history: [], airdrops: [p] }));
    expect(file?.airdrops?.[0].token?.address).toBe('AbCdEfGhIjKlMnOpQrStUvWxYz123456789');
    expect(parseBackup(JSON.stringify({ version: 1, positions: [], history: [] }))?.airdrops).toEqual([]);
    expect(parseBackup(JSON.stringify({ version: 1, positions: [], history: [], airdrops: [{ nope: 1 }] }))).toBeNull();
    expect(mergeAirdrops([base({ name: 'old' })], [base({ name: 'new' })]).map((a) => a.name)).toEqual(['new']);
  });
  it('drops invalid rates to unknown', () => {
    expect(normalizeProgram({ ...base(), claims: [{ ...claim(5, 1), usdRate: -3 }] })?.claims[0].usdRate).toBeNull();
  });
});

describe('automatic pricing by contract address', () => {
  it('builds a price id only for networks with a price source', () => {
    expect(coinId('Base', '0xabc0000000000000000000000000000000000001')).toBe('base:0xabc0000000000000000000000000000000000001');
    expect(coinId('Solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(coinId('X Layer', '0xabc0000000000000000000000000000000000001')).toBeNull();
    expect(coinId('Base', '')).toBeNull();
  });
});
