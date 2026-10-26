import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OpportunityListing } from '../../src/lib/risk/opportunities';
import type { Opportunity } from '../../src/types/opportunity';
import { defaultCalc } from '../../src/components/opportunities/Calculator';

// Controlled test data; not market data.

const PT = `0x${'ab'.repeat(20)}`;
const row = {
  protocol: 'pendle',
  id: 'x',
  name: 'reUSD',
  platform: null,
  icon: null,
  chain: 'Ethereum',
  maturity: '2026-12-10',
  impliedAPY: 12.08,
  baseAPY: 8,
  liquidity: 5_000_000,
  hasPoints: false,
  ytMultiplier: null,
  points: null,
  categories: ['stables', 'pt-looping'],
  isNew: false,
  expired: false,
  daysToMaturity: 44,
  ptToken: { symbol: 'PT-reUSD', address: PT },
  asset: { symbol: 'reUSD', address: `0x${'11'.repeat(20)}` },
  accountingSymbol: 'USDC',
} as unknown as OpportunityListing;

const lender = (key: string, ratePct: number, maxLtv: number, pendleLoop?: string) =>
  ({
    key,
    family: 'lend',
    protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
    chain: 'eip155:1',
    market: { id: key, address: null, name: 'USDT · وثیقه PT-reUSD' },
    assets: { deposit: [{ symbol: 'USDT', address: `0x${'22'.repeat(20)}` }] },
    rate: { value: 4, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: null },
    url: `https://app.morpho.org/ethereum/market/${key}`,
    borrow: { ratePct, curve: null, availableUsd: 3_300_000, collateral: [{ token: { symbol: 'PT-reUSD', address: PT }, maxLtv, ...(pendleLoop ? { pendleLoop } : {}) }], metric: 'ltv' },
    quality: 'current',
    sources: [],
  }) as unknown as Opportunity;

vi.mock('../../src/hooks/useLending', () => ({
  useLending: () => ({ feed: { opportunities: [lender('0xa', 9, 0.86), lender('0xb', 7.08, 0.915, 'https://app.pendle.finance/trade/loop/box/1')] }, loading: false }),
}));

describe('PT loop position', () => {
  it('lists the lending markets that take the PT, best first, with their LLTV, rate, liquidity and PendleLoop link', async () => {
    const { PtLoopPosition } = await import('../../src/components/opportunities/PtLoopPosition');
    const c = { ...defaultCalc, mode: 'loop' as const, days: 44, entryAPY: 12.08, leverage: 4, borrowAPY: 7.08, lltv: 91.5, loopLender: '0xb|' + PT };
    const html = renderToStaticMarkup(<PtLoopPosition c={c} set={() => {}} row={row} />);
    const radios = html.match(/role="radio" aria-checked="(true|false)"/g) ?? [];
    expect(radios).toEqual(['role="radio" aria-checked="true"', 'role="radio" aria-checked="false"']);
    // The cheaper loan with the higher LLTV ranks first.
    expect(html.indexOf('market/0xb')).toBeGreaterThan(-1);
    expect(html.indexOf('market/0xb')).toBeLessThan(html.indexOf('market/0xa'));
    expect(html).toContain('https://app.pendle.finance/trade/loop/box/1');
    // The slider reaches near liquidation (LLTV 91.5% → ~10.8×) and marks the safe limit.
    expect(html).toMatch(/type="range" min="1" max="10.\d" step="0.1"/);
    expect(html).toContain('حد امن');
  });

  it('says so when no lending market takes the PT', async () => {
    const { PtLoopPosition } = await import('../../src/components/opportunities/PtLoopPosition');
    const other = { ...row, ptToken: { symbol: 'PT-X', address: `0x${'cd'.repeat(20)}` } } as OpportunityListing;
    const html = renderToStaticMarkup(<PtLoopPosition c={{ ...defaultCalc, mode: 'loop' }} set={() => {}} row={other} />);
    expect(html).toContain('دستی وارد کنید');
    expect(html).not.toContain('role="radio"');
  });

  it('fills a Pendle market\'s rate after its AMM fee and no extra buying cost; others keep a cost', async () => {
    const { loopMarketFill } = await import('../../src/components/opportunities/PtLoopPosition');
    const pendle = loopMarketFill({ protocol: 'pendle', impliedAPY: 14.28, ammFeeLn: 0.001 });
    expect(pendle.loopFee).toBe(0);
    expect(pendle.entryAPY).toBeCloseTo((Math.exp(Math.log(1.1428) - 0.001) - 1) * 100, 2);
    expect(loopMarketFill({ protocol: 'pendle', impliedAPY: 14.28, ammFeeLn: null })).toEqual({ entryAPY: 14.28, loopFee: 0 });
    expect(loopMarketFill({ protocol: 'exponent', impliedAPY: 10, ammFeeLn: null }).loopFee).toBe(0.05);
    expect(loopMarketFill({ protocol: 'spectra', impliedAPY: 10, ammFeeLn: null }).loopFee).toBe(0.5);
  });

  it('shows the buying cost of the PT as its own field', async () => {
    const { PtLoopPosition } = await import('../../src/components/opportunities/PtLoopPosition');
    const html = renderToStaticMarkup(<PtLoopPosition c={{ ...defaultCalc, mode: 'loop', loopFee: 0 }} set={() => {}} row={row} />);
    expect(html).toContain('کارمزد خرید PT');
    expect(html).toContain('کارمزد پندل در نرخ PT است');
  });
});
