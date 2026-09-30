import { describe, expect, it } from 'vitest';
import raw from '../fixtures/merkl-live-2026-09-30.json';
import { normalizeOpportunity, type RawOpportunity } from '../../src/lib/merkl/normalize';
import { DEX_CHAINS } from '../../src/lib/merkl/markets';
import { buildContext } from '../../src/lib/merkl/vetting';
import { estimate as merklEstimate } from '../../src/lib/merkl/profit';
import type { GasQuote, MerklOpportunity, TokenMarket } from '../../src/lib/merkl/types';
import type { Opportunity } from '../../src/types/opportunity';
import { linkMerkl, merklAddress, withoutMerklDuplicates } from '../../src/lib/opportunity/merkl-link';
import { evaluate, selectHorizon, type FamilyFilter, type MerklInput } from '../../src/lib/market/analysis';
import { FALLBACK_TX_USD } from '../../src/lib/opportunity/costs';
import type { HorizonDays } from '../../src/lib/opportunity/policy';

/**
 * Real Merkl API v4 data captured on 2026-09-30 (the same fixture as the Merkl
 * tests). The protocol-side opportunities are test data shaped like the Morpho
 * adapter's output, placed at the real vault addresses so the linking rule is
 * checked against how Merkl actually identifies them.
 */
const fx = raw as unknown as { capturedAt: number; opportunities: RawOpportunity[]; markets: Record<string, TokenMarket | null> };
const NOW = fx.capturedAt;
const ops = fx.opportunities.map((o) => normalizeOpportunity(o, NOW)).filter((o): o is MerklOpportunity => o !== null);
const ctx = buildContext(ops, fx.markets, Object.keys(DEX_CHAINS).map(Number), NOW);
const gas: GasQuote[] = [{ chainId: 1, gwei: 0.263, nativeUsd: 2700, at: NOW * 1000 }];
const merkl: MerklInput = { list: ops, ctx, stale: false, fetchedAt: new Date(NOW * 1000).toISOString() };

const ROCKAWAY = '0x2cA22cb25558fa2018ecb1CE4eD8AF92Ee7ea423';
const STEAKHOUSE_BASE = '0xbeeff2490FEffa212faC2f6553682C219E6a8845';
const FXN = '0x365AccFCa291e7D3914637ABf1F7635dB165Bb09';

const vault = (address: string, chain = 'eip155:1', over: Partial<Opportunity> = {}): Opportunity => ({
  key: `morpho:${chain}:${address.toLowerCase()}:vault`,
  family: 'vault',
  protocol: { id: 'morpho', version: 'vault-v2', name: 'Morpho' },
  chain,
  market: { id: address, address, name: 'Vault' },
  assets: { deposit: [{ symbol: 'USDC', address: '0xa0b8' }] },
  rate: { value: 4, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: null },
  maturity: null,
  capacity: { depositRemainingUsd: null, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  quality: 'current',
  sources: [],
  ...over,
});

const rank = (list: Opportunity[], days: HorizonDays = 30, m: MerklInput | null = merkl, filter: FamilyFilter = 'all') => {
  const a = evaluate({ opportunities: list, merkl: m, gas }, 1000, NOW * 1000);
  return { ...selectHorizon(a, days, filter), byKey: a.byKey, linked: a.linked, rows: a.rows };
};
const row = (r: ReturnType<typeof rank>, key: string) => [...r.ranking.top, ...Object.values(r.ranking.aside).flat()].find((e) => e.key === key)!;

describe('linking Merkl to protocol opportunities', () => {
  it('links by chain, protocol and exact contract address only', () => {
    const links = linkMerkl([vault(ROCKAWAY), vault(ROCKAWAY, 'eip155:8453'), vault(ROCKAWAY, 'eip155:1', { protocol: { id: 'aave', version: 'v4', name: 'Aave' } })], ops);
    expect([...links.keys()]).toEqual([vault(ROCKAWAY).key]);
    expect(links.get(vault(ROCKAWAY).key)!.map((m) => m.explorerAddress)).toEqual([ROCKAWAY]);
  });

  it('reads the address from the start of an identifier with a suffix', () => {
    const steak = ops.find((m) => m.explorerAddress === STEAKHOUSE_BASE)!;
    expect(steak.identifier).toMatch(/WHITELIST_CAMPAIGN$/);
    expect(merklAddress(steak)).toBe(STEAKHOUSE_BASE.toLowerCase());
  });

  it('never links a Morpho Blue market: Merkl’s id for it is not the market id', () => {
    const blue = ops.find((m) => m.type === 'MORPHOSUPPLY')!;
    const market: Opportunity = { ...vault('0x0'), key: 'morpho:eip155:1:0xmarket:supply', family: 'lend', market: { id: '0x' + 'ab'.repeat(32), address: null, name: 'Blue' } };
    expect(linkMerkl([market], [blue]).size).toBe(0);
  });

  it('drops the protocol’s own report of a reward Merkl also pays, so it counts once', () => {
    const withProtocolReward = vault(ROCKAWAY, 'eip155:1', {
      rewards: [{ key: 'morpho:1:x:fxn', source: 'protocol', kind: 'token', token: { symbol: 'FXN', address: FXN, chain: 'eip155:1' }, aprUsd: 5, endsAt: null, conditional: false, vesting: false }],
    });
    const linked = linkMerkl([withProtocolReward], ops).get(withProtocolReward.key)!;
    expect(withoutMerklDuplicates(withProtocolReward, linked).rewards).toEqual([]);
  });
});

describe('Merkl rewards on a linked vault', () => {
  it('adds each campaign with Merkl’s rule until its own end, plus claim gas', () => {
    const r = rank([vault(ROCKAWAY)]);
    const e = row(r, vault(ROCKAWAY).key);
    const merklLines = e.rewardLines.filter((l) => l.source === 'merkl');
    expect(merklLines).toHaveLength(2);
    // The two FXN campaigns end in about 17 and 26 days: never counted for the full 30.
    expect(merklLines.map((l) => Math.floor(l.days)).sort()).toEqual([17, 26]);
    for (const l of merklLines) expect(l.days).toBeLessThan(30);
    expect(e.costs.some((c) => c.key === 'claim-1')).toBe(true);
    const costs = e.costs.reduce((a, c) => a + c.usd, 0);
    expect(e.net).toBeCloseTo(e.baseIncome! + e.rewards - costs, 9);
    expect(r.linked).toBe(1);
  });

  it('lists but does not add a campaign Merkl’s gate rejects (access restricted)', () => {
    const e = row(rank([vault(STEAKHOUSE_BASE, 'eip155:8453')]), vault(STEAKHOUSE_BASE, 'eip155:8453').key);
    expect(e.rewards).toBe(0);
    expect(e.assumptions.some((a) => a.includes('کنار گذاشته شد'))).toBe(true);
  });

  it('is the same estimate without Merkl, minus the rewards', () => {
    const without = row(rank([vault(ROCKAWAY)], 30, null), vault(ROCKAWAY).key);
    const withM = row(rank([vault(ROCKAWAY)]), vault(ROCKAWAY).key);
    expect(withM.baseIncome).toBeCloseTo(without.baseIncome!, 12);
    expect(withM.rewards).toBeGreaterThan(0);
  });
});

describe('one list for every family', () => {
  it('brings Merkl markets of protocols without a YieldX adapter, once, with Merkl’s own numbers', () => {
    const r = rank([]);
    const keys = new Set([...r.ranking.top, ...Object.values(r.ranking.aside).flat()].map((e) => e.key));
    const aaveLend = ops.find((m) => m.protocol?.id === 'aave' && m.action === 'LEND')!;
    expect(keys.has(`merkl:${aaveLend.id}`)).toBe(true);
    // Morpho has an adapter: its Merkl markets are not listed a second time.
    for (const m of ops.filter((x) => x.protocol?.id === 'morpho')) expect(keys.has(`merkl:${m.id}`)).toBe(false);
    const e = row(r, `merkl:${aaveLend.id}`);
    const direct = merklEstimate(aaveLend, { capital: 1000, horizon: 30, txEthereum: FALLBACK_TX_USD.ethereum, txOther: FALLBACK_TX_USD.evm }, ctx, gas);
    if (direct.ok) expect(e.net).toBeCloseTo(direct.net, 9);
  });

  it('gives borrowing, pools and leverage no dollar number of their own', () => {
    const r = rank([]);
    const borrow = ops.find((m) => m.action === 'BORROW' && m.protocol?.id === 'aave')!;
    expect(r.ranking.aside['needs-model'].some((e) => e.key === `merkl:${borrow.id}`)).toBe(true);
    expect(r.ranking.top.every((e) => r.byKey.get(e.key)!.family !== 'lp')).toBe(true);
  });

  it('filters to what pays a priced reward', () => {
    const r = rank([vault(ROCKAWAY), vault('0x1111111111111111111111111111111111111111')], 30, merkl, 'rewards');
    expect(r.total).toBeGreaterThan(0);
    for (const e of [...r.ranking.top, ...Object.values(r.ranking.aside).flat()]) expect(e.rewards).toBeGreaterThan(0);
  });

  it('marks Merkl rows stale when the Merkl feed is the last good copy', () => {
    const r = rank([], 30, { ...merkl, stale: true });
    const aaveLend = ops.find((m) => m.protocol?.id === 'aave' && m.action === 'LEND')!;
    const e = row(r, `merkl:${aaveLend.id}`);
    if (e.net !== null) expect(e.placement).toBe('stale');
  });
});

describe('Merkl campaigns per horizon', () => {
  it('counts each campaign only until its end, so a later horizon never loses reward days', () => {
    const r30 = rank([vault(ROCKAWAY)], 30);
    const r125 = rank([vault(ROCKAWAY)], 125);
    const k = vault(ROCKAWAY).key;
    const d30 = row(r30, k).rewardLines.filter((l) => l.source === 'merkl').map((l) => l.days);
    const d125 = row(r125, k).rewardLines.filter((l) => l.source === 'merkl').map((l) => l.days);
    // Both campaigns end inside 30 days: the reward is the same at 125 — never extended.
    expect(d125).toEqual(d30);
    expect(row(r125, k).rewards).toBeCloseTo(row(r30, k).rewards, 6);
  });
});
