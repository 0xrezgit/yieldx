import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../../src/types/opportunity';
import type { OpportunityListing } from '../../src/lib/risk/opportunities';
import { ptOpportunity } from '../../src/lib/opportunity/from-market';
import { evaluate } from '../../src/lib/market/analysis';
import { finishDay, MAX_SHARE, nearestPaths } from '../../src/lib/opportunity/goal-plan';

// Controlled data: two dollar PTs on Solana (cheap gas) and a variable lending reserve. Not market data.
const NOW = Date.parse('2026-10-15T00:00:00Z');
const AT = new Date(NOW).toISOString();

const pt = (name: string, implied: number, liquidity: number): Opportunity =>
  ptOpportunity(
    'exponent',
    {
      protocol: 'exponent', id: name, name, platform: null, icon: null, chain: 'Solana',
      maturity: new Date(NOW + 90 * 86_400_000).toISOString(), impliedAPY: implied, baseAPY: 5, liquidity,
      hasPoints: false, ytMultiplier: null, points: null, categories: ['stablecoins'], isNew: false, expired: false, daysToMaturity: 90,
      ptToken: { symbol: `PT-${name}`, address: `pt-${name}` }, asset: { symbol: name, address: name }, accountingSymbol: name,
    } as OpportunityListing,
    AT,
    NOW,
  );

const lend = (rate: number, room: number): Opportunity => ({
  key: `kamino:solana:mainnet:L${rate}:supply`,
  family: 'lend',
  protocol: { id: 'kamino', version: 'klend', name: 'Kamino' },
  chain: 'solana:mainnet',
  market: { id: `L${rate}`, address: `L${rate}`, name: `USDC ${rate}` },
  assets: { deposit: [{ symbol: 'USDC', address: 'EPj' }] },
  rate: { value: rate, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT },
  maturity: null,
  capacity: { depositRemainingUsd: room, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  quality: 'current',
  sources: [],
});

const run = (opps: Opportunity[], capital: number, target: number) => {
  const a = evaluate({ opportunities: opps, merkl: null, gas: [] }, capital, NOW);
  return nearestPaths(a.rows, a.gas, 90, capital, target, { now: NOW });
};

describe('نزدیک‌ترین راه‌های واقعی', () => {
  const opps = [pt('AUSD', 16, 2_000_000), pt('BUSD', 12, 50_000_000), lend(30, 5_000_000)];

  it('spreads the capital over several markets and never more than half in one', () => {
    const r = run(opps, 10_000, 5_000);
    expect(r.realistic.locked.parts.length).toBeGreaterThanOrEqual(2);
    for (const p of [...r.realistic.locked.parts, ...r.realistic.variable.parts]) expect(p.amount).toBeLessThanOrEqual(10_000 * MAX_SHARE + 1e-6);
    expect(r.realistic.locked.parts.every((p) => p.o.family === 'pt')).toBe(true);
    expect(r.realistic.variable.total).toBeGreaterThan(r.realistic.locked.total);
  });

  it('finds the capital a target needs by re-estimating at each amount, and says when the market cannot take it', () => {
    const r = run(opps, 1_000, 100);
    expect(r.capitalLocked.reachable).toBe(true);
    expect(r.capitalLocked.plan!.total).toBeGreaterThanOrEqual(100);
    expect(r.capitalLocked.capital!).toBeGreaterThan(1_000);
    const none = run([pt('AUSD', 16, 200_000)], 1_000, 1e9);
    expect(none.capitalLocked.reachable).toBe(false);
    expect(none.capitalLocked.maxTotal).toBeGreaterThan(0);
  });

  it('the smallest variable share that reaches the target, only when one does', () => {
    const lockedOnly = run(opps, 10_000, 1).realistic.locked.total;
    const variable = run(opps, 10_000, 1).realistic.variable.total;
    const target = (lockedOnly + variable) / 2;
    const r = run(opps, 10_000, target);
    expect(r.blend).not.toBeNull();
    expect(r.blend!.share).toBeGreaterThan(0);
    expect(r.blend!.share).toBeLessThan(1);
    expect(r.blend!.total).toBeGreaterThanOrEqual(target);
    expect(run(opps, 10_000, variable * 10).blend).toBeNull();
  });

  it('every horizon for the same capital', () => {
    const r = run(opps, 10_000, 5_000);
    expect(r.horizons.map((h) => h.days)).toEqual([30, 60, 90, 125]);
    expect(r.horizons[0].locked).toBe(0); // the PTs mature after 30 days
    expect(r.horizons[2].locked).toBeGreaterThan(0);
  });

  it('the money is back on the last payout day, not at the end of the period; without the diversity rule one market may take it all', () => {
    const a = evaluate({ opportunities: opps, merkl: null, gas: [] }, 10_000, NOW);
    const capped = nearestPaths(a.rows, a.gas, 125, 10_000, 5_000, { now: NOW });
    expect(finishDay(capped.realistic.locked)).toBeLessThanOrEqual(91);
    expect(finishDay(capped.realistic.locked)).toBeGreaterThan(0);
    const free = nearestPaths(a.rows, a.gas, 125, 10_000, 5_000, { now: NOW, maxShare: 1 });
    expect(free.realistic.locked.total).toBeGreaterThanOrEqual(capped.realistic.locked.total - 1e-9);
    expect(Math.max(...free.realistic.locked.parts.map((p) => p.amount))).toBeGreaterThan(10_000 * MAX_SHARE);
  });
});
