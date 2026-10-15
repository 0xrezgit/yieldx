import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../../src/types/opportunity';
import { evaluate } from '../../src/lib/market/analysis';
import { monthlyEligible, monthlyIncome, MONTHLY_MAX_SHARE } from '../../src/lib/monthly/plan';

// Controlled lending reserves on Solana (cheap gas). Not market data.
const NOW = Date.parse('2026-10-15T00:00:00Z');
const AT = new Date(NOW).toISOString();
const lend = (id: string, rate: number, room = 1e9, chain = 'solana:mainnet'): Opportunity => ({
  key: `kamino:${chain}:${id}:supply`,
  family: 'lend',
  protocol: { id: 'kamino', version: 'klend', name: 'Kamino' },
  chain,
  market: { id, address: id, name: `USDC ${id}` },
  assets: { deposit: [{ symbol: 'USDC', address: 'EPj' }] },
  rate: { value: rate, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT, avg7d: rate * 0.6 },
  maturity: null,
  capacity: { depositRemainingUsd: room, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  quality: 'current',
  sources: [],
});

describe('درآمد ماهانه', () => {
  it('only what pays every month, in dollars; Ethereum only when asked', () => {
    expect(monthlyEligible(lend('a', 8), 'stable', false)).toBe(true);
    expect(monthlyEligible(lend('a', 8, 1e9, 'eip155:1'), 'stable', false)).toBe(false);
    expect(monthlyEligible(lend('a', 8, 1e9, 'eip155:1'), 'stable', true)).toBe(true);
    expect(monthlyEligible({ ...lend('p', 12), family: 'pt' }, 'balanced', true)).toBe(false);
    expect(monthlyEligible({ ...lend('y', 12), family: 'yt' }, 'balanced', true)).toBe(false);
  });

  it('a month of income on the capital, spread out, a bad month from the lowest rate seen, and the capital a target needs', () => {
    const opps = [lend('a', 10), lend('b', 8), lend('c', 6)];
    const a = evaluate({ opportunities: opps, merkl: null, gas: [] }, 3000, NOW);
    const r = monthlyIncome(a.rows, a.gas, 3000, 300, { risk: 'stable', ethereum: false, now: NOW });
    expect(r.plan.parts.length).toBeGreaterThanOrEqual(2);
    for (const p of r.plan.parts) expect(p.amount).toBeLessThanOrEqual(3000 * MONTHLY_MAX_SHARE + 1e-6);
    // A twelfth of the rates the estimate uses — the lower of today and the 7-day average
    // (6 % and 4.8 %) — on half the money each: about $13.
    expect(r.plan.monthly).toBeGreaterThan(11);
    expect(r.plan.monthly).toBeLessThan(15);
    // The bad month is not cut twice for the same low average.
    expect(r.plan.bad).toBeCloseTo(r.plan.monthly, 6);
    expect(r.capitalForTarget).not.toBeNull();
    const at = monthlyIncome(a.rows, a.gas, r.capitalForTarget as number, 300, { risk: 'stable', ethereum: false, now: NOW });
    expect(at.plan.monthly).toBeGreaterThan(0);
  });

  it('PTs and loops on an unverified dollar peg come in only when asked', () => {
    const pt = { ...lend('p', 12), family: 'pt' as const, ptClass: { class: 'usd' as const, pegVerified: true } };
    expect(monthlyEligible(pt, 'stable', false)).toBe(false);
    expect(monthlyEligible(pt, 'stable', false, { pt: true })).toBe(true);
    expect(monthlyEligible({ ...pt, ptClass: { class: 'usd', pegVerified: false } }, 'stable', false, { pt: true })).toBe(false);
    const loop = { ...lend('l', 10), family: 'leverage' as const, loop: { pairClass: 'usd', pegVerified: false } } as unknown as Opportunity;
    expect(monthlyEligible(loop, 'balanced', false)).toBe(false);
    expect(monthlyEligible(loop, 'balanced', false, { unverified: true })).toBe(true);
    expect(monthlyEligible(loop, 'stable', false, { unverified: true })).toBe(false);
  });
});
