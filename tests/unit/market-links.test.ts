import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('market pages built by the adapters', () => {
  it('Exponent: /{farm|fixed}/{name}-{DDMONYY}, «+» as «plus» (checked on its app)', async () => {
    const { exponentLinks } = await import('../../src/lib/protocols/exponent');
    // ONyc matures 2027-01-10 13:00 UTC → onyc-10JAN27 (the page the user shared).
    expect(exponentLinks({ tokenName: 'ONyc', maturityDateUnixTs: 1799586000 })).toEqual({
      pt: 'https://app.exponent.finance/en/market/fixed/onyc-10JAN27',
      yt: 'https://app.exponent.finance/en/market/farm/onyc-10JAN27',
    });
    expect(exponentLinks({ tokenName: 'hyloSOL+', maturityDateUnixTs: Date.UTC(2026, 11, 12) / 1000 })?.yt).toBe('https://app.exponent.finance/en/market/farm/hylosolplus-12DEC26');
  });

  it('Spectra: /{fixed-rate|trade-yield}/{network}:{pool}, only networks checked on its app', async () => {
    const { spectraLinks } = await import('../../src/lib/protocols/spectra');
    const pool = '0xD0aad31C66b459A37f306c19C11c7a9b0654c1fa';
    expect(spectraLinks('mainnet', pool)).toEqual({ pt: `https://app.spectra.finance/fixed-rate/eth:${pool.toLowerCase()}`, yt: `https://app.spectra.finance/trade-yield/eth:${pool.toLowerCase()}` });
    expect(spectraLinks('avalanche', pool)?.pt).toContain('/fixed-rate/avax:');
    expect(spectraLinks('bsc', pool)).toBeNull();
    expect(spectraLinks('base', null)).toBeNull();
  });

  it('listingLink uses the adapter link as an exact market page', async () => {
    const { listingLink } = await import('../../src/lib/market/links');
    const m = { id: 'x', chain: 'Solana', links: { pt: 'https://p', yt: 'https://y' } };
    expect(listingLink('exponent', m, 'yt')).toEqual({ url: 'https://y', exact: true });
    expect(listingLink('exponent', { id: 'x', chain: 'Solana' }, 'yt').exact).toBe(false);
  });
});
