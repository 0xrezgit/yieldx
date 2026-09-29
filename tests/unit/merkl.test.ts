import { describe, expect, it } from 'vitest';
import raw from '../fixtures/merkl-opportunities.json';
import { normalizeOpportunity, type RawOpportunity } from '../../src/lib/merkl/normalize';
import { applyMerklFilters, defaultMerklFilters, defaultMineSettings, estimateOpportunity, flags, isRow, nativeApr, rankMine, type MineRow } from '../../src/lib/merkl/estimate';
import { merklNetwork, restrictions } from '../../src/lib/merkl/rules';
import type { MerklOpportunity } from '../../src/lib/merkl/types';

/**
 * Real Merkl API responses captured on 2026-09-29 (trimmed to the fields YieldX
 * reads). NOW is shortly after the capture, so every campaign in the file is live.
 */
const NOW = 1_790_680_000;
const ops = (raw as RawOpportunity[]).map((o) => normalizeOpportunity(o, NOW)).filter((o): o is MerklOpportunity => o !== null);
const byId = (id: string) => ops.find((o) => o.id === id)!;
const mine = { ...defaultMineSettings, capital: 1000, costEthereum: 0, costOther: 0 };
const row = (id: string) => {
  const r = estimateOpportunity(byId(id), mine, 0, NOW);
  if (!isRow(r)) throw new Error(`excluded: ${r.reason}`);
  return r as MineRow;
};
const reason = (id: string) => {
  const r = estimateOpportunity(byId(id), mine, 0, NOW);
  return isRow(r) ? null : r.reason;
};

describe('normalizeOpportunity', () => {
  it('keeps every sample with its live campaigns and slim fields', () => {
    expect(ops).toHaveLength(11);
    expect(ops.every((o) => o.campaigns.length > 0)).toBe(true);
  });

  it('classifies reward mechanisms from the distribution parameters', () => {
    expect(byId('9859803059162020148').campaigns[0].rateKind).toBe('pool');
    const capped = byId('11955964678328285026').campaigns[0];
    expect(capped.rateKind).toBe('capped');
    expect(capped.capApr).toBeCloseTo(4.25, 6); // stored by Merkl as 0.0425
    const points = byId('2416353277329385508').campaigns[0];
    expect(points.rateKind).toBe('fixedAmount');
    expect(points.rate).toBe(1825);
    expect(points.rewardToken.type).toBe('POINT');
    expect(points.rewardToken.price).toBeNull();
    expect(byId('15037229969371509598').campaigns[0].rateKind).toBe('airdrop');
    expect(byId('12848640496271100237').campaigns[0].rateKind).toBe('target');
    expect(byId('13207567167701080626').campaigns[0].clmm).toBe(true);
  });

  it('drops campaigns that have not started or have ended', () => {
    const o = raw[0] as RawOpportunity;
    const end = Number(o.campaigns![0].endTimestamp);
    expect(normalizeOpportunity(o, end + 1)!.campaigns).toHaveLength(0);
  });

  it('never shows an absurd native APR', () => {
    const yt = byId('9859803059162020148');
    expect(yt.nativeApr).toBeGreaterThan(1_000_000);
    expect(nativeApr(yt)).toBeNull();
    expect(flags(yt, NOW).map((f) => f.label)).toContain('بازده بومی نامعتبر');
  });
});

describe('personal estimate for $1,000', () => {
  it('dilutes a shared budget by the new capital (Pendle YT, $1.7k TVL)', () => {
    const r = row('9859803059162020148');
    // $15.14/day shared by $1,691 + $1,000 → about $5.63/day, not 326% of $1,000.
    expect(r.usdPerDay).toBeCloseTo(5.6265, 3);
    expect(r.aprAfter).toBeLessThan(byId('9859803059162020148').apr);
    expect(r.aprAfter).toBeCloseTo(205.4, 0);
    expect(r.usdToEnd).toBeCloseTo(5.6265 * 29.16, 0);
  });

  it('caps and dilutes a max-APR campaign (Aave USDT0 on Plasma)', () => {
    const r = row('11955964678328285026');
    expect(r.usdPerDay).toBeGreaterThan(0.022);
    expect(r.usdPerDay).toBeLessThan(0.025);
  });

  it('counts fixed-rate points in units only, never dollars (USDat)', () => {
    const r = estimateOpportunity(byId('2416353277329385508'), mine, 0, NOW);
    expect(isRow(r)).toBe(false);
    if (isRow(r)) return;
    expect(r.reason).toContain('فقط پوینت');
  });

  it('keeps points separate from dollars when both are paid (Morpho Saturn, Monad)', () => {
    const r = row('17488350223115175634');
    expect(r.usdPerDay).toBeCloseTo((8.481 + 47.507) * (1000 / (1_985_173 + 1000)), 3);
    expect(r.points).toHaveLength(1);
    expect(r.points[0].perDay).toBeCloseTo(1000, 6); // 365 points per $ per year
    expect(r.points[0].toEnd).toBeCloseTo(1000 * 70.74, -2);
  });

  it('keeps pre-TGE tokens out of the dollar total (USP → PIKU)', () => {
    const r = estimateOpportunity(byId('17216643690669966223'), mine, 0, NOW);
    expect(isRow(r)).toBe(false);
    if (isRow(r)) return;
    expect(r.reason).toContain('پیش از TGE');
  });

  it('estimates a target top-up at the current rate, flagged as approximate (Upshift, Stellar)', () => {
    const r = row('12848640496271100237');
    expect(r.usdPerDay).toBeCloseTo((1000 * 5.9926) / 100 / 365, 4);
    expect(r.approx).toBe(true);
  });

  it('subtracts entry cost and reports break-even days', () => {
    const r = estimateOpportunity(byId('9859803059162020148'), { ...mine, costEthereum: 20 }, 0, NOW) as MineRow;
    expect(r.net).toBeCloseTo(r.usdToEnd - 20, 6);
    expect(r.breakEvenDays).toBeCloseTo(20 / r.usdPerDay, 6);
  });
});

describe('exclusions', () => {
  it('excludes a campaign that requires leverage (Aave USDe, health-factor hook)', () => {
    expect(restrictions(byId('11521673201667687989').campaigns[0]).join()).toContain('health factor');
    expect(reason('11521673201667687989')).toContain('شرط ویژه');
  });
  it('excludes Robinhood-only rewards', () => expect(reason('5701731715065456649')).toContain('شرط ویژه'));
  it('excludes concentrated liquidity', () => expect(reason('13207567167701080626')).toContain('نقدینگی متمرکز'));
  it('excludes borrowing', () => expect(reason('4081998136546123516')).toContain('وام'));
  it('excludes swap cashback', () => expect(reason('15037229969371509598')).toContain('سواپ'));
});

describe('ranking and filters', () => {
  it('ranks only estimable opportunities and explains the rest', () => {
    const { rows, excluded, total } = rankMine(ops, mine, 0, 15, NOW);
    expect(total).toBe(rows.length);
    expect(rows.length + excluded.length).toBe(ops.length);
    expect(rows[0].o.id).toBe('9859803059162020148');
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].net).toBeGreaterThanOrEqual(rows[i].net);
  });

  it('filters by chain, action, reward type and TVL', () => {
    const f = { ...defaultMerklFilters, minTvl: 0, minDays: 0 };
    expect(applyMerklFilters(ops, { ...f, chain: 4 }, NOW).map((o) => o.id)).toEqual(['12848640496271100237']);
    expect(applyMerklFilters(ops, { ...f, action: 'BORROW' }, NOW)).toHaveLength(1);
    expect(applyMerklFilters(ops, { ...f, reward: 'POINT' }, NOW).map((o) => o.id).sort()).toEqual(['17488350223115175634', '2416353277329385508']);
    expect(applyMerklFilters(ops, { ...f, minTvl: 100_000 }, NOW).some((o) => o.tvl < 100_000)).toBe(false);
    expect(applyMerklFilters(ops, { ...f, hideRestricted: true }, NOW).some((o) => o.id === '5701731715065456649')).toBe(false);
  });

  it('names and draws every network, including ones outside the app registry', () => {
    for (const o of ops) {
      const n = merklNetwork(o.chain);
      expect(n.nameFa).toBeTruthy();
      expect(n.logo).toBeTruthy();
    }
    expect(merklNetwork({ id: 4, name: 'Stellar', icon: 'x' }).nameFa).toBe('استلار');
  });
});
