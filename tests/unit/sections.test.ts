import { describe, expect, it } from 'vitest';
import { platformOf } from '../../src/lib/market/platforms';
import { strategyById } from '../../src/lib/market/strategies';

describe('analysis sections', () => {
  it('PT: only PT held to maturity; Loop PT: only leverage with a maturity (a PT loop)', () => {
    const pt = strategyById('pt')!;
    const loop = strategyById('loop')!;
    expect(pt.test({ family: 'pt', maturity: '2027-01-01' })).toBe(true);
    expect(pt.test({ family: 'yt', maturity: '2027-01-01' })).toBe(false);
    expect(loop.test({ family: 'leverage', maturity: '2027-01-01' })).toBe(true);
    // A loop on a perpetual asset (no maturity) is not a PT loop.
    expect(loop.test({ family: 'leverage', maturity: null })).toBe(false);
    expect(strategyById('x')).toBeNull();
  });

  it('platform: the protocol entered on; Merkl-only markets on Merkl', () => {
    expect(platformOf({ key: 'morpho:eip155:1:0xabc:vault', protocol: { id: 'morpho', version: null, name: 'Morpho' } })).toBe('morpho');
    expect(platformOf({ key: 'merkl:123', protocol: { id: 'euler', version: null, name: 'Euler' } })).toBe('merkl');
  });
});
