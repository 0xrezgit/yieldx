import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import protocols from '../../src/config/protocols.json';
import {
  formatDate,
  formatGregorian,
  formatMoneyNumber,
  formatNumber,
  formatPercent,
  formatRateCapped,
  formatToken,
  formatUSD,
  isPartialNumber,
  normalizeSearch,
  parseLocaleNumber,
} from '../../src/lib/utils/formatting';
import { NETWORKS, networkByChainId, networkByName } from '../../src/lib/registry/networks';
import { PROTOCOLS, tokenKeyFor } from '../../src/lib/registry/identity';
import { clearListCache, clearMarket, fetchMarketsShared, markManual, mergeMarketData } from '../../src/lib/data/market-data';
import { applyIfCurrent } from '../../src/components/dashboard/useDashboard';
import { applyFilters, defaultFilters } from '../../src/components/opportunities/filters';
import { defaultScenario, type ScenarioParams } from '../../src/types/scenario';
import type { MarketData } from '../../src/types/market';
import type { OpportunityListing } from '../../src/lib/risk/opportunities';

const LRI = '⁦';
const PDI = '⁩';

describe('Persian number display', () => {
  it('matches the reference examples', () => {
    expect(formatUSD(12345.67)).toBe(`${LRI}۱۲٬۳۴۵٫۶۷${PDI} دلار`);
    expect(formatUSD(-123.45)).toBe(`${LRI}−۱۲۳٫۴۵${PDI} دلار`);
    expect(formatPercent(3.25, 2, true)).toBe('+۳٫۲۵٪');
    expect(formatToken(0.00003456, 'ETH')).toBe(`${LRI}۰٫۰۰۰۰۳۴۵۶${PDI} ${LRI}ETH${PDI}`);
  });

  it('never shows a negative zero', () => {
    expect(formatPercent(-0.001, 2)).toBe('۰٪');
    expect(formatUSD(-0.001)).toBe(`${LRI}۰${PDI} دلار`);
    expect(formatMoneyNumber(-0.004)).toBe('۰');
    expect(formatNumber(-0)).toBe('۰');
    expect(formatNumber(0)).toBe('۰');
  });

  it('shows a small non-zero quantity instead of a misleading ۰', () => {
    expect(formatNumber(0.0004, 2)).toBe('۰٫۰۰۰۴');
    expect(formatNumber(-0.0004, 2)).toBe('−۰٫۰۰۰۴');
    expect(formatNumber(1e-15)).toMatch(/^</);
  });

  it('uses only Persian digits', () => {
    for (const s of [formatUSD(9876543.21), formatPercent(-12.5), formatNumber(0.000123), formatDate('2026-10-13')]) expect(s).not.toMatch(/[0-9]/);
  });

  it('caps astronomically high trigger rates', () => {
    expect(formatRateCapped(218_802.7)).toBe('بیش از ۱٬۰۰۰٪');
    expect(formatRateCapped(12.34)).toBe('۱۲٫۳٪');
    expect(formatRateCapped(Infinity)).toBe('دور از دسترس');
  });
});

describe('number input parsing', () => {
  it.each<[string, number]>([
    ['۱۲٬۳۴۵٫۶۷', 12345.67],
    ['١٢٣٫٤٥', 123.45],
    ['12345.67', 12345.67],
    ['1,234.5', 1234.5],
    ['1,234', 1234],
    ['12,5', 12.5],
    ['۱/۵', 1.5],
    ['−۵', -5],
    ['-0.00003456', -0.00003456],
    ['  ۱۰ ۰۰۰ ', 10000],
    ['⁦−۱۲۳٫۴۵⁩', -123.45],
    ['.5', 0.5],
  ])('%s → %d', (input, expected) => {
    expect(parseLocaleNumber(input)).toBeCloseTo(expected, 12);
  });

  it.each(['', 'abc', '1,2,3', '12a', '--1', '1.2.3'])('rejects %j', (input) => {
    expect(parseLocaleNumber(input)).toBeNaN();
  });

  it('round-trips every formatted number', () => {
    for (const x of [0, 1, -1, 0.5, 1234.5678, -98765.4321, 1e-6, 123456789]) expect(parseLocaleNumber(formatNumber(x, 8))).toBeCloseTo(x, 8);
  });

  it('keeps partial input while typing', () => {
    for (const s of ['', '-', '−', '۰٫', '0.', '12.', '٫']) expect(isPartialNumber(s)).toBe(true);
    for (const s of ['12a', 'x']) expect(isPartialNumber(s)).toBe(false);
  });
});

describe('dates', () => {
  it('shows the same maturity day for a date and its UTC midnight (no time-zone shift)', () => {
    expect(formatDate('2026-10-13T00:00:00.000Z')).toBe(formatDate('2026-10-13'));
    expect(formatDate('2026-10-13')).toBe('۲۱ مهر ۱۴۰۵');
    expect(formatGregorian('2026-10-13')).toBe('۱۳ اکتبر ۲۰۲۶');
  });
});

describe('identity registry', () => {
  const chainNames = [...Object.values(protocols.pendle.chainNames), ...Object.values(protocols.spectra.networks), 'Solana'];

  it('knows every network present in the adapters’ data, with a local logo file', () => {
    for (const name of chainNames) {
      const n = networkByName(name);
      expect(n.key, name).not.toMatch(/^unknown/);
      expect(n.nameFa, name).toMatch(/[؀-ۿ]/);
      expect(n.logo && existsSync(join(process.cwd(), 'public', n.logo)), `${name} logo`).toBe(true);
    }
    for (const p of Object.values(PROTOCOLS)) expect(existsSync(join(process.cwd(), 'public', p.logo))).toBe(true);
  });

  it('keys EVM networks by chainId and resolves API aliases', () => {
    expect(networkByName('mainnet').key).toBe('eip155:1');
    expect(networkByName('bsc').chainId).toBe(56);
    expect(networkByChainId(42161).name).toBe('Arbitrum');
    expect(new Set(NETWORKS.map((n) => n.key)).size).toBe(NETWORKS.length);
  });

  it('still shows an unknown network, without a logo', () => {
    const n = networkByName('Chain 123456');
    expect(n.logo).toBeNull();
    expect(n.chainId).toBe(123456);
  });

  it('lower-cases EVM addresses but keeps Solana mints exactly', () => {
    expect(tokenKeyFor('Ethereum', '0xAbC')).toBe('eip155:1/0xabc');
    expect(tokenKeyFor('Solana', 'WFRGSWjaz8tbAxsJitmbfRuFV2mSNwy7BMWcCwaA28U')).toBe('solana:mainnet/WFRGSWjaz8tbAxsJitmbfRuFV2mSNwy7BMWcCwaA28U');
  });
});

// ─── Market switching ───────────────────────────────────────────────────────────

const md = (over: Partial<MarketData>): MarketData => ({
  protocol: 'exponent',
  marketId: 'm',
  name: 'X',
  underlyingPrice: 1,
  ptPrice: 0.97,
  ytPrice: 0.03,
  impliedAPY: 9,
  baseAPY: 8,
  maturity: '2027-01-10T00:00:00.000Z',
  daysToMaturity: 100,
  liquidity: 1e6,
  marketSizeUnits: null,
  volume24h: null,
  pointsStatus: 'unknown',
  points: null,
  platform: null,
  icon: null,
  chain: 'Solana',
  fetchedAt: '2026-09-29T00:00:00.000Z',
  ...over,
});

const onyc = md({ protocol: 'exponent', marketId: 'onyc', name: 'ONyc', platform: 'OnRe', pointsStatus: 'active', points: { name: 'Onre Points', pointsPerDay: 1, basis: 'usd', ytMultiplier: 8, lpMultiplier: 2, season: 1 } });
const susdai = md({ protocol: 'pendle', marketId: '42161-0xcbf6', name: 'sUSDai', chain: 'Arbitrum', pointsStatus: 'active', baseAPY: 7.6 });
const sjeur = md({ protocol: 'spectra', marketId: 'base-0xa108', name: 'sjEUR', chain: 'Base', pointsStatus: 'unknown', baseAPY: NaN, underlyingPrice: 1.17 });

/** What pickMarket does: clear, select, then merge the response if still current. */
function pick(prev: ScenarioParams, m: MarketData, history: number[] | null, carry = false): ScenarioParams {
  const selected = { ...clearMarket(prev), ...(carry ? { fdv: prev.fdv, pointsName: prev.pointsName, pointsPerDay: prev.pointsPerDay } : {}), protocol: m.protocol as ScenarioParams['protocol'], marketId: m.marketId };
  return applyIfCurrent(selected, selected.protocol, m.marketId, (x) => mergeMarketData(x, m, history, { carryAssumptions: carry }));
}

describe('switching markets never leaks the previous market', () => {
  it('Exponent ONyc → Pendle sUSDai → Spectra sjEUR', () => {
    let p: ScenarioParams = { ...defaultScenario(), capital: 25_000 };
    p = pick(p, onyc, null);
    expect(p.pointsName).toBe('Onre Points');
    p = { ...p, fdv: 3e9, snapshotDate: '2026-12-01' }; // the user's ONyc assumptions

    p = pick(p, susdai, [7.1, 7.3, 7.6, 7.5, 7.4, 7.6, 7.7, 7.6]);
    expect(p.pointsName).toBe('');
    expect(p.pointsPerDay).toBe(0);
    expect(p.ytMultiplier).toBe(1);
    expect(p.fdv).toBe(defaultScenario().fdv);
    expect(p.snapshotDate).toBe('');
    expect(p.apyHistory).toHaveLength(8);

    p = pick(p, sjeur, null);
    expect(p.marketName).toBe('sjEUR');
    expect(p.apyHistory).toEqual([]); // sUSDai's history must not stay
    expect(p.baseAPY).toBeNaN(); // unknown, not sUSDai's 7.6
    expect(p.dataMeta?.missing).toEqual(expect.arrayContaining(['baseAPY', 'apyHistory']));
    expect(p.pointsStatus).toBe('unknown');
    expect(JSON.stringify(p)).not.toMatch(/onre|ONyc|sUSDai/i);
    expect(p.capital).toBe(25_000); // general input survives
  });

  it('carries market assumptions only when the user asks', () => {
    const a = { ...pick(defaultScenario(), onyc, null), fdv: 3e9 };
    expect(pick(a, susdai, null, true).fdv).toBe(3e9);
    expect(pick(a, susdai, null, false).fdv).toBe(defaultScenario().fdv);
  });

  it('drops a late response for a market the user has left', () => {
    const now = { ...clearMarket(defaultScenario()), protocol: 'spectra' as const, marketId: sjeur.marketId };
    const late = applyIfCurrent(now, 'pendle', susdai.marketId, (x) => mergeMarketData(x, susdai, [1, 2, 3]));
    expect(late).toBe(now);
    expect(late.marketName).not.toBe('sUSDai');
  });

  it('keeps manual overrides and assumptions on a refresh of the same market', () => {
    const p = markManual({ ...pick(defaultScenario(), onyc, null), ptPrice: 0.95, fdv: 2e9 }, 'ptPrice');
    const r = mergeMarketData(p, { ...onyc, ptPrice: 0.99, ytPrice: 0.01 }, null);
    expect(r.ptPrice).toBe(0.95);
    expect(r.ytPrice).toBe(0.01);
    expect(r.fdv).toBe(2e9);
    expect(r.dataMeta?.manual).toContain('ptPrice');
  });

  it('keeps the source timestamp separate from the receive time', () => {
    const p = mergeMarketData(defaultScenario(), { ...susdai, sourceUpdatedAt: '2026-09-28T23:59:00.000Z' }, null);
    expect(p.dataMeta?.sourceUpdatedAt).toBe('2026-09-28T23:59:00.000Z');
    expect(p.dataMeta?.fetchedAt).toBe(susdai.fetchedAt);
    expect(p.dataMeta?.source).toBe('api');
  });
});

describe('shared market-list cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearListCache();
  });
  const listing = { id: 'a', name: 'A', platform: null, icon: null, chain: 'Ethereum', maturity: '2027-01-01', impliedAPY: 5, baseAPY: 4, liquidity: 1, hasPoints: false, ytMultiplier: null, points: null, categories: [], isNew: false, expired: false, daysToMaturity: 90 };

  it('sends one request for concurrent callers, and serves the last good list (stale) on failure', async () => {
    let calls = 0;
    let fail = false;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (fail) return new Response(JSON.stringify({ error: 'upstream_error' }), { status: 502 });
      return new Response(JSON.stringify({ markets: [listing] }), { status: 200 });
    });
    const [a, b] = await Promise.all([fetchMarketsShared('pendle'), fetchMarketsShared('pendle')]);
    expect(calls).toBe(1);
    expect(a.markets).toHaveLength(1);
    expect(b.stale).toBe(false);
    fail = true;
    const c = await fetchMarketsShared('pendle', { force: true });
    expect(c.stale).toBe(true);
    expect(c.markets).toHaveLength(1);
  });
});

describe('opportunity filters and search', () => {
  const row = (over: Partial<OpportunityListing>): OpportunityListing => ({
    protocol: 'pendle', id: 'x', name: 'sUSDe', platform: 'Ethena', icon: null, chain: 'Ethereum', maturity: '2027-01-01', impliedAPY: 8, baseAPY: 5,
    liquidity: 1e6, hasPoints: true, ytMultiplier: null, points: null, categories: ['stables'], isNew: false, expired: false, daysToMaturity: 90, ...over,
  });
  const rows = [
    row({ id: '1-0xabc', asset: { symbol: 'sUSDe', address: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' } }),
    row({ id: '42161-0xdef', chain: 'Arbitrum', daysToMaturity: 20 }),
    row({ id: 'solana-1', protocol: 'exponent', chain: 'Solana', name: 'ONyc', categories: [], hasPoints: false }),
  ];

  it('finds by Persian network name, symbol and token address (case-insensitive)', () => {
    expect(applyFilters(rows, { ...defaultFilters, q: 'آربیتروم' }).map((r) => r.id)).toEqual(['42161-0xdef']);
    expect(applyFilters(rows, { ...defaultFilters, q: 'onyc' }).map((r) => r.id)).toEqual(['solana-1']);
    expect(applyFilters(rows, { ...defaultFilters, q: '0x9d39a5de' }).map((r) => r.id)).toEqual(['1-0xabc']);
  });

  it('normalises Arabic ي/ك for search only', () => {
    expect(normalizeSearch('سولانا كيف')).toBe(normalizeSearch('سولانا کیف'));
  });

  it('applies independent filters', () => {
    expect(applyFilters(rows, { ...defaultFilters, protocol: 'exponent' })).toHaveLength(1);
    expect(applyFilters(rows, { ...defaultFilters, maturity: 'lt30' }).map((r) => r.id)).toEqual(['42161-0xdef']);
    expect(applyFilters(rows, { ...defaultFilters, points: 'none' }).map((r) => r.id)).toEqual(['solana-1']);
    expect(applyFilters(rows, { ...defaultFilters, asset: 'stable', chain: 'Ethereum' }).map((r) => r.id)).toEqual(['1-0xabc']);
  });
});

describe('bidi: words never inside an LTR number run', () => {
  it('isolates only the number of a compact amount', async () => {
    const { formatUSDCompact, formatCompact } = await import('../../src/lib/utils/formatting');
    expect(formatUSDCompact(371_500)).toBe(`${LRI}۳۷۱٫۵${PDI} هزار دلار`);
    expect(formatUSDCompact(-11_300_000)).toBe(`${LRI}−۱۱٫۳${PDI} میلیون دلار`);
    expect(formatCompact(950)).toBe(`${LRI}۹۵۰${PDI}`);
  });

  it('<Num> keeps Persian words in RTL and numbers in LTR isolates', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { Num } = await import('../../src/components/ui/num');
    const { formatUSDCompact } = await import('../../src/lib/utils/formatting');
    const html = renderToString(createElement(Num, null, formatUSDCompact(371_500)));
    expect(html).toMatch(/<bdi dir="ltr">۳۷۱٫۵<\/bdi> هزار/);
    expect(html).not.toMatch(/<bdi dir="ltr">[^<]*هزار/);
    const capped = renderToString(createElement(Num, null, 'بیش از ۱٬۰۰۰٪'));
    expect(capped).toMatch(/بیش از <bdi dir="ltr">۱٬۰۰۰٪<\/bdi>/);
  });
});
