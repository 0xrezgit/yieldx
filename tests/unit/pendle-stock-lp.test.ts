import { describe, expect, it } from 'vitest';
import type { MarketListing } from '../../src/types/market';
import type { MerklOpportunity } from '../../src/lib/merkl/types';
import { lpOpportunity, ptClassOf, ptOpportunity, ytOpportunity } from '../../src/lib/opportunity/from-market';
import { estimate } from '../../src/lib/opportunity/estimate';
import { linkMerkl } from '../../src/lib/opportunity/merkl-link';
import { unitOf } from '../../src/lib/opportunity/goal';
import { monthlyEligible } from '../../src/lib/monthly/plan';

// Controlled test data shaped like Pendle's Base list rows for Coinbase tokenized stocks
// (GOOGLc 24 Dec 2026: «rwa», «stocks», base yield 0, a pool almost all SY).

const NOW = Date.parse('2026-10-18T00:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const ADDR = '0x9d91977cba597d910b1755b8acb3b616e3552f17';

const listing = (over: Partial<MarketListing> = {}): MarketListing => ({
  id: `8453-${ADDR}`,
  name: 'GOOGLc',
  platform: 'Coinbase',
  icon: 'https://example.test/googlc.svg',
  chain: 'Base',
  maturity: inDays(67),
  impliedAPY: 0.11,
  baseAPY: 0,
  liquidity: 150_000,
  hasPoints: false,
  ytMultiplier: null,
  points: null,
  categories: ['rwa', 'stocks'],
  isNew: true,
  asset: { symbol: 'GOOGLc-scaled18', address: '0xa84f' },
  accountingSymbol: 'GOOGLc-scaled18',
  sourceUpdatedAt: new Date(NOW).toISOString(),
  pool: { ptShare: 0.01, swapFeePct: 0.004, pendlePct: 1.3 },
  expired: false,
  daysToMaturity: 67,
  ...over,
});

const at = new Date(NOW).toISOString();

describe('Pendle tokenized-stock markets', () => {
  it('classes the PT as a stock and says its yield is in the stock’s units', () => {
    expect(ptClassOf(listing())).toEqual({ class: 'stock', pegVerified: true });
    const pt = ptOpportunity('pendle', listing(), at, NOW);
    expect(pt.notes?.[0]).toMatch(/واحد سهم/);
    expect(unitOf(pt)).toBe('stock');
    // A stock pays no base yield on-chain: the YT has nothing to earn.
    const yt = ytOpportunity('pendle', listing(), at, NOW)!;
    expect(estimate(yt, { capital: 500, days: 90, now: NOW }).net ?? 0).toBeLessThanOrEqual(0);
  });

  it('builds the LP from the pool: PT share × implied + swap fee, PENDLE until maturity, Pendle’s zap-in page', () => {
    const lp = lpOpportunity('pendle', listing(), at, NOW)!;
    expect(lp.key).toBe(`pendle:eip155:8453:${ADDR}:lp`);
    expect(lp.family).toBe('lp');
    expect(lp.url).toBe(`https://app.pendle.finance/trade/pools/${ADDR}/zap/in?chain=base`);
    expect(lp.rate.value).toBeCloseTo(0.01 * 0.11 + 0.004, 10);
    expect(lp.rate.rewardsIncluded).toBe(false);
    expect(lp.rewards).toHaveLength(1);
    expect(lp.rewards[0]).toMatchObject({ source: 'protocol', aprUsd: 1.3, eligibleTvlUsd: 150_000, endsAt: inDays(67) });
    expect(unitOf(lp)).toBe('stock');
  });

  it('builds no LP outside stock markets or when the PT side is large', () => {
    expect(lpOpportunity('pendle', listing({ categories: ['stables'] }), at, NOW)).toBeNull();
    expect(lpOpportunity('pendle', listing({ pool: { ptShare: 0.4, swapFeePct: 0, pendlePct: 1 } }), at, NOW)).toBeNull();
    expect(lpOpportunity('pendle', listing({ pool: null }), at, NOW)).toBeNull();
    expect(lpOpportunity('spectra', listing(), at, NOW)).toBeNull();
  });

  it('estimates the LP like a deposit, also for a horizon shorter than maturity, PENDLE diluted by the deposit', () => {
    const lp = lpOpportunity('pendle', listing(), at, NOW)!;
    const e = estimate(lp, { capital: 500, days: 30, now: NOW });
    expect(e.placement).toBe('ranked');
    expect(e.earningDays).toBe(30);
    const pendle = 0.013 * (150_000 / 365) * (500 / 150_500) * 30;
    expect(e.rewards).toBeCloseTo(pendle, 6);
    expect(e.unknown.join(' ')).toMatch(/quote/);
  });

  it('links a Merkl liquidity campaign to the LP only, never to the PT or YT of the same market', () => {
    const pool = { id: 'm1', action: 'POOL', identifier: ADDR, explorerAddress: ADDR, protocol: { id: 'pendle' }, chain: { id: 8453 } } as unknown as MerklOpportunity;
    const hold = { ...pool, id: 'm2', action: 'HOLD' } as unknown as MerklOpportunity;
    const pt = ptOpportunity('pendle', listing(), at, NOW);
    const yt = ytOpportunity('pendle', listing(), at, NOW)!;
    const lp = lpOpportunity('pendle', listing(), at, NOW)!;
    const links = linkMerkl([pt, yt, lp], [pool, hold]);
    expect(links.get(lp.key)?.map((m) => m.id)).toEqual(['m1']);
    expect(links.get(pt.key)?.map((m) => m.id)).toEqual(['m2']);
    expect(links.get(yt.key)?.map((m) => m.id)).toEqual(['m2']);
  });

  it('takes the LP into the monthly income only when opted in, and never at «stable» risk', () => {
    const lp = lpOpportunity('pendle', listing(), at, NOW)!;
    expect(monthlyEligible(lp, 'balanced', false)).toBe(false);
    expect(monthlyEligible(lp, 'balanced', false, { lp: true })).toBe(true);
    expect(monthlyEligible(lp, 'stable', false, { lp: true })).toBe(false);
    // The PT pays at maturity in stock units: never a dollar monthly income.
    expect(monthlyEligible(ptOpportunity('pendle', listing(), at, NOW), 'balanced', false, { pt: true })).toBe(false);
  });
});
