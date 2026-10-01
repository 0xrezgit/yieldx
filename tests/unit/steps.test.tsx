import { describe, expect, it } from 'vitest';
import type { Estimate, Opportunity } from '../../src/types/opportunity';
import { isPlainDollar, loopLeaderSteps, stepsFor, ytLeaderSteps } from '../../src/lib/market/steps';

const NOW = Date.parse('2026-10-01T00:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const o = (over: Partial<Opportunity>): Opportunity =>
  ({
    key: 'k',
    family: 'lend',
    protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
    chain: 'eip155:1',
    market: { id: 'm', address: null, name: 'USDC · وثیقه WBTC' },
    assets: { deposit: [{ symbol: 'USDC', address: '0x1' }] },
    rate: { value: 5, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: null },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'instant' },
    rewards: [],
    quality: 'current',
    sources: [],
    url: 'https://app.morpho.org/ethereum/market/m',
    ...over,
  }) as Opportunity;
const e = (over: Partial<Estimate> = {}): Estimate => ({ earningDays: 30, rewardLines: [], leverage: null, ...over }) as Estimate;
const kinds = (s: { kind: string }[]) => s.map((x) => x.kind);

describe('step-by-step guide', () => {
  it('lending: deposit, wait, withdraw — no swap for a plain dollar, a swap otherwise', () => {
    expect(kinds(stepsFor(o({}), e()))).toEqual(['deposit', 'wait', 'withdraw']);
    expect(kinds(stepsFor(o({ assets: { deposit: [{ symbol: 'sUSDe', address: '0x2' }] } }), e()))).toEqual(['deposit', 'wait', 'withdraw', 'swap']);
    expect(stepsFor(o({}), e())[0].href).toBe('https://app.morpho.org/ethereum/market/m');
  });

  it('PT: buy, hold to the maturity date with the day count, redeem, then swap the underlying to dollars', () => {
    const s = stepsFor(o({ family: 'pt', protocol: { id: 'pendle', version: null, name: 'Pendle' }, maturity: inDays(45), assets: { deposit: [{ symbol: 'sUSDe', address: '0x2' }] }, ptToken: { symbol: 'PT-sUSDe', address: '0x3' } }), e({ earningDays: 45 }));
    expect(kinds(s)).toEqual(['buy', 'wait', 'redeem', 'swap']);
    expect(s[1].title).toContain('۴۵ روز');
    expect(s[0].title).toContain('PT-sUSDe');
  });

  it('YT: buy, hold, claim the yield (the YT ends at zero)', () => {
    expect(kinds(stepsFor(o({ family: 'yt', maturity: inDays(45) }), e({ earningDays: 45 })))).toEqual(['buy', 'wait', 'claim']);
  });

  it('PT loop: buy PT, post it, loop to the policy leverage, watch until maturity, close', () => {
    const lev = { leverage: 2.5, health: { metric: 'ltv', value: 1.3, min: 1.25 } } as Estimate['leverage'];
    const loop = { collateral: { token: { symbol: 'PT-reUSD', address: '0x4' }, yield: { pct: 11, kind: 'apy', source: '' } }, debt: { token: { symbol: 'USDC', address: '0x1' }, side: {} }, maxLtv: 0.915, pairClass: 'usd', entryUrl: 'https://app.pendle.finance/x' } as unknown as Opportunity['loop'];
    const s = stepsFor(o({ family: 'leverage', maturity: inDays(70), loop }), e({ earningDays: 70, leverage: lev }));
    expect(kinds(s)).toEqual(['buy', 'collateral', 'loop', 'watch', 'repay']);
    expect(s[0].href).toBe('https://app.pendle.finance/x');
    expect(s[2].title).toContain('۲٫۵×');
  });

  it('Merkl rewards: claim on Merkl, then sell any reward that is not already dollars', () => {
    const s = stepsFor(o({}), e({ rewardLines: [{ key: 'r', label: 'پاداش MORPHO (Merkl)', usd: 3, days: 30, source: 'merkl' }] }));
    expect(kinds(s)).toEqual(['deposit', 'wait', 'claim', 'sell', 'withdraw']);
    expect(s[2].href).toContain('merkl.xyz');
  });

  it('dollar rankings: YT sold on its best day or claimed at maturity; Loop PT closed at maturity', () => {
    expect(kinds(ytLeaderSteps({ asset: 'USDe', protocol: 'Pendle', url: 'u', days: 20, toMaturity: false, maturity: inDays(60) }))).toEqual(['buy', 'wait', 'sell', 'swap']);
    expect(kinds(ytLeaderSteps({ asset: 'USDC', protocol: 'Pendle', url: 'u', days: 60, toMaturity: true, maturity: inDays(60) }))).toEqual(['buy', 'wait', 'claim']);
    expect(kinds(loopLeaderSteps({ pt: 'PT-x', ptUrl: 'p', lender: 'Morpho', lenderUrl: 'l', debt: 'USDC', leverage: 3, health: 1.37, days: 70, maturity: inDays(70) }))).toEqual(['buy', 'collateral', 'loop', 'watch', 'repay']);
    expect(isPlainDollar('usdt0')).toBe(true);
    expect(isPlainDollar('sUSDe')).toBe(false);
  });
});
