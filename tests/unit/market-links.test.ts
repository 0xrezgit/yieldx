import { describe, expect, it } from 'vitest';
import { morphoFixedLink, pathSlug } from '../../src/lib/market/links';

describe('each market opens its own page', () => {
  it('slugs like fluid.io and Aave Pro do', () => {
    expect(pathSlug('USDai+USDC')).toBe('usdai-usdc');
    expect(pathSlug(' Core Hub ')).toBe('core-hub');
    expect(pathSlug('USDT0')).toBe('usdt0');
  });

  it("opens Morpho's fixed-rate market page (Midnight)", () => {
    expect(morphoFixedLink(42161, '0xabc')!.url).toBe('https://markets.morpho.org/fixed/arbitrum/0xabc');
    expect(morphoFixedLink(999999, '0xabc')).toBeNull();
  });
});
