import { describe, expect, it } from 'vitest';
import { buildLoops } from '../../src/lib/opportunity/leverage';
import type { Opportunity } from '../../src/types/opportunity';

// Controlled rows: a lending market whose borrow side takes wstETH against WETH.
const at = '2026-10-23T00:00:00.000Z';
const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const lender = (collateral: Record<string, unknown> = {}): Opportunity =>
  ({
    key: 'x:eip155:1:m:borrow',
    family: 'borrow',
    protocol: { id: 'fluid', name: 'Fluid' },
    chain: 'eip155:1',
    market: { id: 'm', address: null, name: 'wstETH/WETH' },
    assets: { deposit: [{ symbol: 'WETH', address: WETH }] },
    rate: { value: null, kind: 'apr', at },
    rewards: [],
    quality: 'current',
    sources: [],
    icon: 'https://logo/weth.png',
    borrow: { ratePct: 2, curve: null, availableUsd: null, metric: 'ltv', collateral: [{ token: { symbol: 'wstETH', address: WSTETH }, maxLtv: 0.9, yield: { pct: 3, kind: 'apy', source: 't' }, ...collateral }] },
  }) as unknown as Opportunity;

describe("a loop's logo is its collateral's", () => {
  it('from the source, when it gives one', () => {
    expect(buildLoops([lender({ logo: 'https://logo/wsteth.png' })])[0].icon).toBe('https://logo/wsteth.png');
  });

  it('else from a lending row that takes the same token as its deposit', () => {
    const supply = { ...lender(), key: 'y', family: 'lend', assets: { deposit: [{ symbol: 'wstETH', address: WSTETH }] }, icon: 'https://logo/wsteth-2.png', borrow: null } as unknown as Opportunity;
    expect(buildLoops([lender(), supply])[0].icon).toBe('https://logo/wsteth-2.png');
  });

  it('and never the debt asset\'s logo', () => {
    expect(buildLoops([lender()])[0].icon).toBeNull();
  });
});
