import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { fetchTokens } from '../../src/lib/lending/midnight';
import { LogoWithNetwork } from '../../src/components/ui/asset-identity';
import { networkByChainId } from '../../src/lib/registry/networks';
import { revertOpportunity } from '../../src/lib/lending/revert';
import lending from '../../src/config/lending.json';

afterEach(() => vi.unstubAllGlobals());

describe('logos and names everywhere', () => {
  it('Midnight asks Morpho for at most 100 addresses at a time (101 fails the whole query)', async () => {
    const sizes: number[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { variables } = JSON.parse(String(init.body));
      sizes.push(variables.addresses.length);
      const items = variables.addresses.map((a: string) => ({ address: a, symbol: 'T', decimals: 18, logoURI: 'https://x/t.svg', price: { usd: 1 } }));
      return new Response(JSON.stringify({ data: { assets: { items } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const pairs = Array.from({ length: 150 }, (_, i) => ({ chainId: 1, address: `0x${(i + 1).toString(16).padStart(40, '0')}` }));
    const out = await fetchTokens(pairs);
    expect(sizes.sort((a, b) => b - a)).toEqual([100, 50]);
    expect(out.size).toBe(150);
  });

  it('a row without its own logo still shows a well-known token’s logo, with the network badge', () => {
    const html = renderToString(<LogoWithNetwork icon={null} name="USDC" chain="Base" size={32} />);
    expect(html).toMatch(/<img[^>]+src="https:\/\/[^"]+USDC[^"]*"/i);
    expect(html).toContain('/logos/networks/base.webp');
  });

  it('Polygon, Unichain and Arc are known networks with a logo', () => {
    for (const id of [137, 130, 5042]) {
      const n = networkByChainId(id);
      expect(n.name).not.toMatch(/^Chain /);
      expect(n.logo).toMatch(/^\/logos\/networks\/.+\.webp$/);
    }
  });

  it('Revert Lend rows carry the USDC logo', () => {
    const v = lending.revert.vaults[0];
    const o = revertOpportunity(v, { debt: 1, lent: 2, available: 1, reserves: 0, lendLimit: 10, dailyLeft: 5, irm: { base: 0, multiplier: 0.1, jump: 1, kink: 0.9 }, reserveFactor: 0.1, asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }, [{ time: '2026-10-06', lend_apr: 4 }], '2026-10-06T00:00:00Z', Date.parse('2026-10-06T00:00:00Z'))!;
    expect(o.icon).toMatch(/^https:\/\//);
  });
});
