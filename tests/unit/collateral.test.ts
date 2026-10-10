import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../../src/types/opportunity';
import { borrowReadings, COLLATERAL_POLICY, fundingOptions, holdingClass, holdingOptions } from '../../src/lib/opportunity/collateral';

/** A variable dollar loan against one collateral, with a flat curve unless given. */
function loan(over: { key?: string; protocol?: string; symbol?: string; collateral?: string; lltv?: number; rate?: number; rate7d?: number | null; supplied?: number; borrowed?: number; available?: number | null; chain?: string } = {}): Opportunity {
  const supplied = over.supplied ?? 10_000_000;
  const borrowed = over.borrowed ?? 5_000_000;
  return {
    key: over.key ?? 'm1',
    family: 'lend',
    chain: over.chain ?? 'eip155:1',
    protocol: { id: over.protocol ?? 'morpho', version: null, name: over.protocol === 'aave' ? 'Aave' : 'Morpho' },
    market: { id: over.key ?? 'm1', name: 'USDC market' },
    assets: { deposit: [{ symbol: over.symbol ?? 'USDC', address: '0x1' }] },
    borrow: {
      ratePct: over.rate ?? 4,
      ratePct7d: over.rate7d ?? null,
      curve: { suppliedUsd: supplied, borrowedUsd: borrowed, points: [{ u: 0, rate: 1 }, { u: 1, rate: 1 }], source: 't' },
      availableUsd: over.available === undefined ? supplied - borrowed : over.available,
      collateral: [{ token: { symbol: over.collateral ?? 'WBTC', address: '0x2' }, maxLtv: over.lltv ?? 0.86 }],
      metric: 'ltv',
    },
  } as unknown as Opportunity;
}

describe('collateral strategy: funding leg', () => {
  it('groups BTC- and ETH-like collateral, cirBTC included', () => {
    expect(holdingClass('cirBTC')).toBe('btc');
    expect(holdingClass('WBTC')).toBe('btc');
    expect(holdingClass('wstETH')).toBe('eth');
    const opts = holdingOptions([loan({ key: 'a', collateral: 'cirBTC' }), loan({ key: 'b', collateral: 'WBTC' }), loan({ key: 'c', symbol: 'WETH', collateral: 'WBTC' })]);
    // The WETH loan is not a dollar loan: only two markets count.
    expect(opts[0]).toMatchObject({ label: 'هر نوع BTC', markets: 2 });
    expect(opts.map((o) => o.label)).toEqual(expect.arrayContaining(['cirBTC', 'WBTC']));
  });

  it('borrows value × LTV; the liquidation fall is 1 − LTV ÷ LLTV; cheapest likely cost first', () => {
    const f = fundingOptions([loan({ key: 'dear', rate: 6 }), loan({ key: 'cheap', rate: 3 })], { holding: { kind: 'symbol', symbol: 'wbtc' }, valueUsd: 10_000, ltv: 0.5, days: 60 });
    expect(f.map((x) => x.o.key)).toEqual(['cheap', 'dear']);
    expect(f[0].borrowUsd).toBe(5_000);
    expect(f[0].liquidationDrop).toBeCloseTo(1 - 0.5 / 0.86, 9);
    expect(f[0].cost.likely).toBeCloseTo(5_000 * (Math.pow(1.03, 60 / 365) - 1), 6);
  });

  it('a market listed twice by its source counts once', () => {
    const f = fundingOptions([loan({ key: 'x' }), loan({ key: 'x' })], { holding: { kind: 'symbol', symbol: 'WBTC' }, valueUsd: 1_000, ltv: 0.5, days: 30 });
    expect(f).toHaveLength(1);
  });

  it('leaves out markets that cannot lend the amount or allow the LTV', () => {
    const i = { holding: { kind: 'class', cls: 'btc' } as const, valueUsd: 10_000, ltv: 0.5, days: 30 };
    expect(fundingOptions([loan({ available: 1_000 })], i)).toEqual([]);
    expect(fundingOptions([loan({ lltv: 0.45 })], i)).toEqual([]);
    expect(fundingOptions([loan({ collateral: 'wstETH' })], i)).toEqual([]);
  });

  it('a full Morpho market: the rate keeps rising (AdaptiveCurveIRM), likely < high; one below target stays', () => {
    const o = loan();
    const full = borrowReadings(o, 2.31, 0.995, 60);
    expect(full.rising).toBe(true);
    expect(full.likely).toBeGreaterThan(2.31);
    expect(full.high).toBeGreaterThan(full.likely);
    // At ~100% the formula rises ~1.15× a day — what the Arc cirBTC market showed (0.57% → 2.31% in 10 days).
    expect(Math.exp(COLLATERAL_POLICY.irmSpeed / 365)).toBeCloseTo(1.147, 2);
    const calm = borrowReadings(o, 4, 0.8, 60);
    expect(calm).toMatchObject({ today: 4, likely: 4, rising: false });
  });

  it('without the adaptive model: likely is the higher of today and the week, high a margin over it', () => {
    const r = borrowReadings(loan({ protocol: 'aave', rate7d: 5 }), 4, 0.95, 30);
    expect(r.likely).toBe(5);
    expect(r.high).toBeCloseTo(5 * COLLATERAL_POLICY.highShare, 9);
  });
});
