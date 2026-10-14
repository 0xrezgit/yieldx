import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../../src/types/opportunity';
import type { OpportunityListing } from '../../src/lib/risk/opportunities';
import { ptOpportunity } from '../../src/lib/opportunity/from-market';
import { buildPtLoops } from '../../src/lib/opportunity/leverage';
import { evaluate } from '../../src/lib/market/analysis';
import { goalOptions, requiredReturn } from '../../src/lib/opportunity/goal';

// Controlled data for the formulas; shapes follow the adapters. Not market data.
const NOW = Date.parse('2026-10-15T00:00:00Z');
const AT = new Date(NOW).toISOString();
const MINT = 'HH7FiYbEfDwQoK2ZJpkMz1T6wG6TqPsWcxWCtEVgigrZ';

const listing = (over: Partial<OpportunityListing> = {}): OpportunityListing => ({
  protocol: 'exponent',
  id: 'vault',
  name: 'ONyc',
  platform: null,
  icon: null,
  chain: 'Solana',
  maturity: new Date(NOW + 80 * 86_400_000).toISOString(),
  impliedAPY: 13,
  baseAPY: 11,
  liquidity: 50_000_000,
  hasPoints: false,
  ytMultiplier: null,
  points: null,
  categories: ['stablecoins'],
  isNew: false,
  expired: false,
  daysToMaturity: 80,
  ptToken: { symbol: 'PT-ONyc', address: MINT },
  asset: { symbol: 'ONyc', address: 'onyc' },
  accountingSymbol: 'ONyc',
  ...over,
});

/** A Kamino USDC reserve whose borrow side takes the PT (fixed-rate reserve when `term` is given). */
const kamino = (term?: number, rate = 5): Opportunity => ({
  key: 'kamino:solana:mainnet:R:supply',
  family: 'lend',
  protocol: { id: 'kamino', version: 'klend', name: 'Kamino' },
  chain: 'solana:mainnet',
  market: { id: 'R', address: 'R', name: 'USDC · PT-ONyc Market' },
  assets: { deposit: [{ symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }] },
  rate: { value: 1, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT },
  maturity: null,
  capacity: { depositRemainingUsd: null, withdrawableNowUsd: 1e7 },
  exit: { type: 'instant' },
  rewards: [],
  borrow: { ratePct: rate, ratePct7d: null, curve: null, availableUsd: 1e7, collateral: [{ token: { symbol: 'PT-ONyc-10JAN27', address: MINT }, maxLtv: 0.75, borrowLtv: 0.6 }], metric: 'ltv', ...(term ? { fixedTermDays: term } : {}) },
  quality: 'current',
  sources: [],
});

describe('Kamino PT loops from Exponent PTs', () => {
  it('matches the PT by its exact mint and carries the borrow limit and the fixed term', () => {
    const pt = ptOpportunity('exponent', listing(), AT, NOW);
    expect(pt.ptToken).toEqual({ symbol: 'PT-ONyc', address: MINT });
    const [loop] = buildPtLoops([pt, kamino(30)]);
    expect(loop.loop).toMatchObject({ maxLtv: 0.75, borrowLtv: 0.6, pairClass: 'usd', pegVerified: true });
    expect(loop.loop!.debt.side.fixedTermDays).toBe(30);
    expect(buildPtLoops([ptOpportunity('exponent', listing({ ptToken: { symbol: 'PT-ONyc', address: 'other' } }), AT, NOW), kamino(30)])).toHaveLength(0);
  });

  it('a 30-day fixed loan under an 80-day PT: the renewal rate is flagged unknown; leverage stays under the borrow limit', () => {
    const a = evaluate({ opportunities: [ptOpportunity('exponent', listing(), AT, NOW), kamino(30)], merkl: null, gas: [] }, 1000, NOW);
    const row = a.rows.find((r) => r.o.family === 'leverage')!;
    const e = row.byHorizon[90];
    expect(e.unknown.some((u) => u.includes('تمدید'))).toBe(true);
    expect(e.leverage!.leverage).toBeLessThanOrEqual(1 / (1 - 0.6) + 1e-9);
  });
});

describe('«هدف سود»', () => {
  it('the rate a target needs: $30 on $100 in 125 days is about 115 % a year', () => {
    const r = requiredReturn(100, 30, 125);
    expect(r.periodPct).toBeCloseTo(30, 12);
    expect(r.apyPct).toBeCloseTo((Math.pow(1.3, 365 / 125) - 1) * 100, 9);
  });

  it('splits dollars by how sure they are, adds up to the net, and reports what reaches the target', () => {
    const a = evaluate({ opportunities: [ptOpportunity('exponent', listing(), AT, NOW), kamino()], merkl: null, gas: [] }, 1000, NOW);
    const g = goalOptions(a.rows, 90, 1000, 10_000);
    const pt = g.groups.locked.find((x) => x.o.family === 'pt')!;
    expect(pt).toBeDefined();
    expect(pt.lockedUsd + pt.variableUsd + pt.speculativeUsd).toBeCloseTo(pt.net, 9);
    const loop = g.groups.variable.find((x) => x.o.family === 'leverage')!;
    expect(loop.lockedUsd + loop.variableUsd + loop.speculativeUsd).toBeCloseTo(loop.net, 9);
    expect(loop.variableUsd).toBeLessThan(0);
    // The loop stops paying above some average borrow rate, and beats the plain PT only below a lower one.
    expect(loop.zeroProfitBorrowPct!).toBeGreaterThan(5);
    expect(loop.ptEqualBorrowPct!).toBeLessThan(loop.zeroProfitBorrowPct!);
    // $10,000 on $1,000 in 90 days: nothing reaches it.
    expect(g.reachedBy).toBeNull();
    expect(goalOptions(a.rows, 90, 1000, 1).reachedBy).toBe('locked');
  });

  it('a fixed-rate loan covering the period makes a PT loop locked on both sides', () => {
    const a = evaluate({ opportunities: [ptOpportunity('exponent', listing({ maturity: new Date(NOW + 25 * 86_400_000).toISOString(), daysToMaturity: 25 }), AT, NOW), kamino(30)], merkl: null, gas: [] }, 1000, NOW);
    const g = goalOptions(a.rows, 30, 1000, 1);
    const loop = g.groups.locked.find((x) => x.o.family === 'leverage');
    expect(loop?.borrowLocked).toBe(true);
    expect(loop?.variableUsd).toBe(0);
  });
});

describe('«قفل‌شده» is in dollars', () => {
  it('a SOL PT fixes its rate in SOL: its dollars are variable, not locked', () => {
    const sol = ptOpportunity('exponent', listing({ name: 'xSOL', categories: ['sol'], asset: { symbol: 'xSOL', address: 'xsol' }, accountingSymbol: 'xSOL', ptToken: { symbol: 'PT-xSOL', address: 'PTX' } }), AT, NOW);
    const a = evaluate({ opportunities: [sol], merkl: null, gas: [] }, 1000, NOW);
    const g = goalOptions(a.rows, 90, 1000, 1);
    expect(g.groups.locked.some((x) => x.o.key === sol.key)).toBe(false);
  });
});
