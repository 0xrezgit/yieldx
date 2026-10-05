import { describe, expect, it } from 'vitest';
import lending from '../../src/config/lending.json';
import { revertOpportunity, type RevertVaultState } from '../../src/lib/lending/revert';
import { realLpStats, revertPoolUrl, revertRef, MIN_POSITIONS, type RawRevertPosition } from '../../src/lib/lp/revert';
import { rateAfterDeposit } from '../../src/lib/opportunity/curve';
import { lpLink, readLpPrefill } from '../../src/components/opportunities/LpAnalyzer';

// Controlled test data shaped like Revert's API and vault reads; not market data.

const NOW = Date.parse('2026-10-05T12:00:00Z');
const AT = new Date(NOW).toISOString();
const ETH_VAULT = lending.revert.vaults[0];
const state = (over: Partial<RevertVaultState> = {}): RevertVaultState => ({
  debt: 575_754,
  lent: 981_392,
  available: 409_810,
  reserves: 4_172,
  lendLimit: 25_000_000,
  dailyLeft: 5_010_705,
  irm: { base: 0, multiplier: 0.1299, jump: 2.9979, kink: 0.9 },
  reserveFactor: 0.1,
  asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ...over,
});
const rates = (days: number, last = '2026-10-05') =>
  Array.from({ length: days }, (_, i) => ({ time: new Date(Date.parse(`${last}T00:00:00Z`) - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10), lend_apr: 4 + i * 0.01 }));

describe('Revert Lend → a lending row in the market analysis', () => {
  it('rate from the latest day, 7-day average, capacity and exit liquidity from the vault', () => {
    const o = revertOpportunity(ETH_VAULT, state(), rates(10), AT, NOW)!;
    expect(o.family).toBe('lend');
    expect(o.chain).toBe('eip155:1');
    expect(o.rate.value).toBeCloseTo(4.09, 9);
    expect(o.rate.kind).toBe('apr');
    expect(o.rate.avg7d).toBeCloseTo(4.06, 9);
    // Room: the lower of the global cap left and today's deposit allowance.
    expect(o.capacity.depositRemainingUsd).toBeCloseTo(5_010_705, 6);
    // Lenders can take out what is idle, less the protocol's reserves.
    expect(o.capacity.withdrawableNowUsd).toBeCloseTo(409_810 - 4_172, 6);
    expect(o.quality).toBe('current');
    expect(o.url).toMatch(/^https:\/\/revert\.finance\//);
  });

  it('the curve reproduces the vault’s own rate model: a deposit lowers the rate', () => {
    const o = revertOpportunity(ETH_VAULT, state(), rates(10), AT, NOW)!;
    const c = o.supplyCurve!;
    expect(c.points).toHaveLength(201);
    const after = rateAfterDeposit(c, 500_000, o.rate.value!)!;
    expect(after).toBeLessThan(o.rate.value!);
    expect(rateAfterDeposit(c, 100, o.rate.value!)!).toBeCloseTo(o.rate.value!, 2);
  });

  it('a vault whose asset is not the configured USDC is left out; an old rate is stale; no rate is insufficient', () => {
    expect(revertOpportunity(ETH_VAULT, state({ asset: '0x0000000000000000000000000000000000000001' }), rates(10), AT, NOW)).toBeNull();
    expect(revertOpportunity(ETH_VAULT, state(), rates(10, '2026-09-30'), AT, NOW)!.quality).toBe('stale');
    expect(revertOpportunity(ETH_VAULT, state(), [], AT, NOW)!.quality).toBe('insufficient');
  });

  it('a full cap leaves no room', () => {
    expect(revertOpportunity(ETH_VAULT, state({ lent: 25_000_000 }), rates(3), AT, NOW)!.capacity.depositRemainingUsd).toBe(0);
  });
});

describe('Revert for LP pools', () => {
  it('maps vfat venues to Revert exchanges; V4 by pool id; unknown venues have no Revert page', () => {
    expect(revertRef(4663, 'uniswap', '0xD4eb21209c4d6093f80b5b84f5c45cc093ea14a3', null)).toMatchObject({ network: 'robinhood', exchange: 'uniswapv3', pool: '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3' });
    const v4 = '0x007a13fa152f6dc383cad20a8eaab4e1e2538b606936eae2a424f8aa47d6db31';
    expect(revertRef(4663, 'uniswap_v4', '0x8366a39cc670b4001a1121b8f6a443a643e40951', v4)?.pool).toBe(v4);
    expect(revertRef(8453, 'aerodrome', '0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59', null)?.exchange).toBe('aerodrome');
    expect(revertRef(4663, 'fables', '0x8366a39cc670b4001a1121b8f6a443a643e40951', v4)).toBeNull();
    expect(revertRef(999, 'uniswap', '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3', null)).toBeNull();
    expect(revertPoolUrl({ network: 'base', exchange: 'aerodrome', pool: '0xb2' })).toBe('https://revert.finance/#/discover?networks=base&exchanges=aerodrome&address=0xb2&expand=true');
  });

  const ref = revertRef(4663, 'uniswap', '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3', null)!;
  const pos = (id: number, fee: number, over: Partial<RawRevertPosition> = {}): RawRevertPosition => ({ nft_id: id, in_range: id % 2 === 0, exited: false, age: 30, underlying_value: '1000', performance: { hodl: { fee_apr: String(fee) } }, ...over });

  it('real-LP figures: open positions ≥ $100 and ≥ 7 days only, quartiles of their fee APR, share in range', () => {
    const rows = [pos(1, 10), pos(2, 20), pos(3, 30), pos(4, 40), pos(5, 50), pos(6, 999, { exited: true }), pos(7, 999, { underlying_value: '50' }), pos(8, 999, { age: 2 }), pos(1, 10)];
    const s = realLpStats(rows, ref)!;
    expect(s.count).toBe(5);
    expect(s.feeApr).toEqual({ p25: 20, median: 30, p75: 40 });
    expect(s.inRangePct).toBeCloseTo(40, 9);
    expect(s.url).toBe(ref.url);
  });

  it('too few positions → no figures', () => {
    expect(realLpStats(Array.from({ length: MIN_POSITIONS - 1 }, (_, i) => pos(i, 10)), ref)).toBeNull();
  });

  it('the analyzer link keeps the Revert page, and accepts only a revert.finance Discover link', () => {
    const p = readLpPrefill(new URL(`https://x${lpLink({ a: 'NVDA', b: 'USDG', revertUrl: ref.url })}`).searchParams);
    expect(p.revertUrl).toBe(ref.url);
    expect(readLpPrefill(new URLSearchParams({ rv: 'https://revert.finance.evil.example/#/discover?x=1' })).revertUrl).toBeUndefined();
    expect(readLpPrefill(new URLSearchParams({ rv: 'javascript:alert(1)' })).revertUrl).toBeUndefined();
  });
});
