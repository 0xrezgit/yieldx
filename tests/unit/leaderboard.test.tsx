import { describe, expect, it } from 'vitest';
import { buckets, leaderLoop, leaderQuoteKey, leaderYt, YT_EXIT_SHIFT_PP, type LeaderRow } from '../../src/lib/risk/leaderboard';
import { simulateLoop } from '../../src/lib/calculators/trade';
import { defaultScreenSettings, type OpportunityListing } from '../../src/lib/risk/opportunities';
import type { Opportunity } from '../../src/types/opportunity';
import { simulateYt } from '../../src/lib/calculators/trade';

const listing = (over: Partial<OpportunityListing>): OpportunityListing => ({
  protocol: 'pendle',
  id: 'x',
  name: 'USDx',
  platform: null,
  icon: null,
  chain: 'Ethereum',
  maturity: '2027-01-01',
  impliedAPY: 8,
  baseAPY: 8,
  liquidity: 5_000_000,
  hasPoints: true,
  ytMultiplier: null,
  points: null,
  categories: ['stables', 'pt-looping'],
  isNew: false,
  expired: false,
  daysToMaturity: 90,
  ...over,
});

const s = defaultScreenSettings;
const input = { capital: 10_000 };

describe('leaderYt', () => {
  it('a sale before maturity shows the range of the market rate moving on that day', () => {
    const m = listing({ impliedAPY: 10, baseAPY: 9, daysToMaturity: 60 });
    const [r] = leaderYt([m], s, input, true);
    expect(r.days).toBeLessThan(60);
    const at = (exit: number) => simulateYt({ capital: 10_000, underlyingPrice: 1, daysToMaturity: 60, entryAPY: 10, baseAPY: 9, holdDays: r.days, exitAPY: exit, feePercent: s.feePercent, pointsPerDay: 0, ytMultiplier: 1, pointsBasis: 'usd', valuePerPoint: 0, yieldFeePercent: 5 }).cash;
    expect(r.range?.low).toBeCloseTo(Math.min(at(10 - YT_EXIT_SHIFT_PP), r.pnl), 6);
    expect(r.range?.high).toBeCloseTo(Math.max(at(10 + YT_EXIT_SHIFT_PP), r.pnl), 6);
  });

  it('held to maturity: no exit price; the range is the base-yield scenarios', () => {
    const [r] = leaderYt([listing({ impliedAPY: 6, baseAPY: 12, daysToMaturity: 60 })], s, input, true);
    expect(r.days).toBe(60);
    const low = r.scenarios!.find((x) => x.kind === 'low')!;
    expect(r.range).toEqual({ low: low.cash, high: r.pnl });
    // No history: likely is today's base, low a fixed share of it.
    expect(r.scenarios!.find((x) => x.kind === 'likely')!.basePct).toBe(12);
    expect(low.basePct).toBeCloseTo(9, 9);
  });

  it('ranks on the base fading into its own level, not on today held', () => {
    const today = listing({ impliedAPY: 10, baseAPY: 20, daysToMaturity: 90 });
    const [held] = leaderYt([today], s, input, true);
    const [faded] = leaderYt([{ ...today, baseLevels: { d7: 14, d30: 12, d90: null } }], s, input, true);
    expect(faded.pnl).toBeLessThan(held.pnl);
    const likely = faded.scenarios!.find((x) => x.kind === 'likely')!.basePct;
    expect(likely).toBeGreaterThan(12);
    expect(likely).toBeLessThan(20);
  });

  it('a points market published at 0 whose SY grows is ranked on the measured growth', () => {
    const health = { status: 'suspect' as const, reasons: ['x'], conservativePct: 15.2, rankPct: 15.2, pointsOnly: false };
    const [r] = leaderYt([listing({ impliedAPY: 12, baseAPY: 0, daysToMaturity: 60, baseHealth: health })], s, input, true);
    const [zero] = leaderYt([listing({ impliedAPY: 12, baseAPY: 0, daysToMaturity: 60 })], s, input, true);
    expect(r.pnl).toBeGreaterThan(zero.pnl);
  });

  it('picks the day with the best cash result', () => {
    const m = listing({ impliedAPY: 12, baseAPY: 6, daysToMaturity: 60 });
    const [r] = leaderYt([m], s, input, true);
    for (let h = 1; h <= 60; h++) {
      const cash = simulateYt({
        capital: 10_000, underlyingPrice: 1, daysToMaturity: 60, entryAPY: 12, baseAPY: 6, holdDays: h, exitAPY: 12,
        feePercent: s.feePercent, pointsPerDay: 0, ytMultiplier: 1, pointsBasis: 'usd', valuePerPoint: 0, yieldFeePercent: 5,
      }).cash;
      expect(r.pnl).toBeGreaterThanOrEqual(cash - 1e-9);
    }
    expect(r.verdict).not.toBe('free');
    expect(r.freeUntil).toBeNull();
  });

  it('cheap YT is free to hold to maturity', () => {
    const [r] = leaderYt([listing({ impliedAPY: 5, baseAPY: 9, daysToMaturity: 60 })], s, input, true);
    expect(r.verdict).toBe('free');
    expect(r.days).toBe(60);
    expect(r.freeUntil).toBe(60);
    expect(r.pnl).toBeGreaterThan(0);
  });

  it('judges YT size by the notional bought, not the capital (superWETH-like: tiny YT price, thin pool)', () => {
    const m = listing({ impliedAPY: 4.74, baseAPY: 25.17, daysToMaturity: 57, liquidity: 372_000 });
    const [r] = leaderYt([m], s, { capital: 1000 }, false);
    expect(1000 / 372_000).toBeLessThan(0.02);
    expect(r.pointsExposure! / (m.points?.ytMultiplier ?? m.ytMultiplier ?? 1) / 372_000).toBeGreaterThan(0.02);
    expect(r.tooBig).toBe(true);
  });

  it('reads Spectra base yield as simple APR, Pendle as APY — the market analysis rule', () => {
    const base = { capital: 1000, underlyingPrice: 1, daysToMaturity: 90, entryAPY: 8, baseAPY: 12, holdDays: 90, exitAPY: 8, feePercent: 0, pointsPerDay: 0, ytMultiplier: 1, pointsBasis: 'usd' as const, valuePerPoint: 0 };
    const apr = simulateYt({ ...base, baseRateKind: 'apr' });
    const apy = simulateYt(base);
    expect(apr.yieldEarned).toBeCloseTo(apr.notional * 0.12 * (90 / 365), 9);
    expect(apy.yieldEarned).toBeCloseTo(apy.notional * (Math.pow(1.12, 90 / 365) - 1), 9);
    const m = { impliedAPY: 8, baseAPY: 12, daysToMaturity: 90 };
    const [sp] = leaderYt([listing({ ...m, protocol: 'spectra' })], s, { capital: 1000 }, false);
    const [ex] = leaderYt([listing({ ...m, protocol: 'exponent' })], s, { capital: 1000 }, false);
    // Same numbers, no yield fee on either: only the base-rate reading differs.
    expect(sp.pnl).toBeGreaterThan(ex.pnl);
  });

  it('keeps broken data and points-only YTs out of the dollar ranking, ranks a suspect one on its conservative base', async () => {
    const { ytExcluded } = await import('../../src/lib/risk/leaderboard');
    const broken = listing({ id: 'b', baseAPY: 27, impliedAPY: 4.6, baseHealth: { status: 'broken', reasons: ['x'], conservativePct: null, pointsOnly: false } });
    const points = listing({ id: 'p', baseAPY: 0, baseHealth: { status: 'ok', reasons: [], conservativePct: 0, pointsOnly: true } });
    const suspect = listing({ id: 's', baseAPY: 12, impliedAPY: 8, baseHealth: { status: 'suspect', reasons: ['jump'], conservativePct: 6, pointsOnly: false } });
    const rows = leaderYt([broken, points, suspect], s, { capital: 1000 }, false);
    expect(rows.map((r) => r.m.id)).toEqual(['s']);
    const atSix = leaderYt([listing({ id: 's', baseAPY: 6, impliedAPY: 8 })], s, { capital: 1000 }, false)[0];
    expect(rows[0].pnl).toBeCloseTo(atSix.pnl, 9);
    expect(rows[0].confidence).toBe('suspect');
    expect(rows[0].range!.high).toBeGreaterThan(rows[0].range!.low);
    const ex = ytExcluded([broken, points, suspect], s);
    expect(ex.broken.map((x) => x.m.id)).toEqual(['b']);
    expect(ex.pointsOnly.map((m) => m.id)).toEqual(['p']);
  });

  it('a quote for this capital replaces the mid entry price (fees and impact are in it)', () => {
    const m = listing({ id: '1-0xpool', impliedAPY: 8, baseAPY: 12, daysToMaturity: 60 });
    // A YT price consistent with 8 % for 60 days (mid 0.01257), 3 % worse for the impact.
    const q = { side: 'yt' as const, usd: 1000, units: 77_000, unitUsd: 1, priceImpactPct: 3, at: '', source: 'Pendle' as const };
    const [r] = leaderYt([m], s, { capital: 1000, quotes: { [leaderQuoteKey('1-0xpool', 'yt', 1000)]: q } }, false);
    expect(r.confidence).toBe('executable');
    // 77,000 units of yield exposure bought: the notional the points ride on.
    expect(r.pointsExposure).toBeCloseTo(77_000, 6);
  });

  it('a quote far from the market’s own rate is ignored (a data error, not a price)', () => {
    const m = listing({ id: '1-0xpool', impliedAPY: 8, baseAPY: 12, daysToMaturity: 60 });
    const bad = { side: 'yt' as const, usd: 1000, units: 20_000, unitUsd: 1, priceImpactPct: 3, at: '', source: 'Pendle' as const };
    const [r] = leaderYt([m], s, { capital: 1000, quotes: { [leaderQuoteKey('1-0xpool', 'yt', 1000)]: bad } }, false);
    expect(r.confidence).not.toBe('executable');
  });

  it('skips markets without points when asked', () => {
    expect(leaderYt([listing({ hasPoints: false })], s, input, true)).toHaveLength(0);
    expect(leaderYt([listing({ hasPoints: false })], s, input, false)).toHaveLength(1);
  });
});

describe('buckets', () => {
  const row = (id: string, pnl: number, days = 10): LeaderRow => ({
    m: listing({ id }), pnl, pnlPercent: pnl / 100, days, annualized: 0, perDay: pnl / days,
    verdict: 'free', tooBig: false, freeUntil: null, pointsExposure: null,
  });
  const rows = [30, 10, 50, 0, 20, 5, 40, 60, 70, -5, -50, -1, -20].map((p, i) => row(`r${i}`, p));

  it('splits into four ordered lists without repeats', () => {
    const b = buckets(rows, 'total', 3);
    expect(b.topProfit.map((r) => r.pnl)).toEqual([70, 60, 50]);
    expect(b.leastProfit.map((r) => r.pnl)).toEqual([0, 5, 10]);
    expect(b.topLoss.map((r) => r.pnl)).toEqual([-50, -20, -5]);
    expect(b.leastLoss.map((r) => r.pnl)).toEqual([-1]);
  });

  it('can rank by profit per day', () => {
    const b = buckets([row('slow', 100, 100), row('fast', 50, 5)], 'perDay', 1);
    expect(b.topProfit[0].m.id).toBe('fast');
    expect(b.leastProfit[0].m.id).toBe('slow');
  });
});

describe('bucket size', () => {
  it('lists up to 15 markets per bucket by default', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ m: { id: String(i), protocol: 'pendle' }, pnl: i - 20, perDay: i - 20 }) as unknown as LeaderRow);
    const b = buckets(many);
    expect(b.topProfit).toHaveLength(15);
    expect(b.topLoss).toHaveLength(15);
    expect(b.leastProfit).toHaveLength(5);
    expect(b.leastLoss).toHaveLength(5);
  });
});

const PT = `0x${'ab'.repeat(20)}`;
const ptListing = (over: Partial<OpportunityListing> = {}) =>
  listing({ ptToken: { symbol: 'PT-USDx', address: PT }, asset: { symbol: 'USDx', address: `0x${'11'.repeat(20)}` }, ...over });
/** A Morpho-like market lending USDC against the PT above. */
const lender = (borrow: Partial<NonNullable<Opportunity['borrow']>> = {}, over: Partial<Opportunity> = {}) =>
  ({
    key: 'morpho:eip155:1:0xm:supply',
    family: 'lend',
    protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
    chain: 'eip155:1',
    market: { id: '0xm', address: null, name: 'USDC · وثیقه PT-USDx' },
    assets: { deposit: [{ symbol: 'USDC', address: `0x${'22'.repeat(20)}` }] },
    rate: { value: 4, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: null },
    url: 'https://app.morpho.org/ethereum/market/0xm',
    borrow: { ratePct: 5, curve: null, availableUsd: 10_000_000, collateral: [{ token: { symbol: 'PT-USDx', address: PT }, maxLtv: 0.915 }], metric: 'ltv', ...borrow },
    quality: 'current',
    sources: [],
    ...over,
  }) as unknown as Opportunity;

describe('leaderLoop', () => {
  it('builds the loop on the lending market that takes this PT: its rate and LLTV, not a guess', () => {
    const [r] = leaderLoop([ptListing({ impliedAPY: 12 })], s, [lender()], { capital: 10_000, hurdle: 8 }).rows;
    const sim = simulateLoop({ capital: 10_000, daysToMaturity: 90, entryAPY: 12, leverage: 3, borrowAPY: 5, lltv: 91.5, feePercent: s.feePercent });
    expect(r.pnl).toBeCloseTo(sim.profit, 9);
    expect(r.health).toBeCloseTo(sim.healthFactor, 9);
    expect(r.verdict).toBe('worth');
    expect(r.lender).toMatchObject({ protocol: 'Morpho', debtSymbol: 'USDC', borrowPct: 5, lltvPct: 91.5, url: 'https://app.morpho.org/ethereum/market/0xm', rateModelled: false });
    const [loss] = leaderLoop([ptListing({ impliedAPY: 3 })], s, [lender({ ratePct: 12 })], { capital: 10_000 }).rows;
    expect(loss.verdict).toBe('loss');
  });

  it('gives no dollar figure without a lending market for the PT', () => {
    const b = leaderLoop([ptListing()], s, [], { capital: 10_000 });
    expect(b.rows).toHaveLength(0);
    expect(b.noLender.map((x) => x.pendleLoop)).toEqual([true]);
    // Another network, another address or another asset class is not this PT's market.
    expect(leaderLoop([ptListing()], s, [lender({}, { chain: 'eip155:8453' })], { capital: 10_000 }).rows).toHaveLength(0);
    expect(leaderLoop([ptListing()], s, [lender({ collateral: [{ token: { symbol: 'PT-X', address: `0x${'cd'.repeat(20)}` }, maxLtv: 0.9 }] })], { capital: 10_000 }).rows).toHaveLength(0);
    expect(leaderLoop([ptListing()], s, [lender({}, { assets: { deposit: [{ symbol: 'WETH', address: `0x${'33'.repeat(20)}` }] } })], { capital: 10_000 }).rows).toHaveLength(0);
    // Not a loop candidate at all: neither a row nor in the no-lender list.
    expect(leaderLoop([ptListing({ categories: [], name: 'ETHx', liquidity: 200_000 })], s, [], { capital: 1000 }).noLender).toHaveLength(0);
  });

  it('one row per lending market, even for a PT outside the old candidate rule', () => {
    const second = lender({ ratePct: 3 }, { key: 'morpho:eip155:1:0xn:supply', url: 'https://app.morpho.org/ethereum/market/0xn' });
    const rows = leaderLoop([ptListing({ categories: [], name: 'ETHx', liquidity: 200_000 })], s, [lender(), second], { capital: 1000 }).rows;
    expect(rows.map((r) => r.lender!.borrowPct).sort()).toEqual([3, 5]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('levers at most 3×, less where the LLTV needs it to keep health at 1.25; counts markets that cannot lend enough', () => {
    const [capped] = leaderLoop([ptListing()], s, [lender()], { capital: 10_000 }).rows;
    expect(capped.leverage).toBe(3);
    expect(capped.health!).toBeGreaterThanOrEqual(1.25);
    // LLTV 60%: 3× would put LTV near 67%; the policy lowers leverage instead.
    const [low] = leaderLoop([ptListing()], s, [lender({ collateral: [{ token: { symbol: 'PT-USDx', address: PT }, maxLtv: 0.6 }] })], { capital: 10_000 }).rows;
    expect(low.leverage!).toBeLessThan(2);
    expect(low.health!).toBeCloseTo(1.25, 9);
    // 3× on $10,000 borrows $20,000; the market has $15,000.
    const short = leaderLoop([ptListing()], s, [lender({ availableUsd: 15_000 })], { capital: 10_000 });
    expect(short).toMatchObject({ rows: [], shortLiquidity: 1 });
  });

  it('pairs yield-bearing dollars by accounting asset or stablecoin tag, and marks a dollar name alone as unverified', async () => {
    const { ptClassOf } = await import('../../src/lib/opportunity/from-market');
    const { tokenClass } = await import('../../src/lib/merkl/vetting');
    const tok = (symbol: string) => ({ symbol, address: `0x${'44'.repeat(20)}` });
    // reUSD: not in the plain-stablecoin list, but Pendle accounts it in USDC.
    expect(ptClassOf({ asset: tok('reUSD'), accountingSymbol: 'USDC', categories: [], name: 'reUSD' })).toEqual({ class: 'usd', pegVerified: true });
    // sUSDD: tagged stables by the protocol.
    expect(ptClassOf({ asset: tok('sUSDD'), accountingSymbol: 'USDD', categories: ['stables'], name: 'sUSDD' })).toEqual({ class: 'usd', pegVerified: true });
    // sUSDat: only its name says dollar.
    expect(ptClassOf({ asset: tok('sUSDat'), accountingSymbol: 'USDat', categories: ['rwa', 'strc'], name: 'sUSDat' })).toEqual({ class: 'usd', pegVerified: false });
    expect(ptClassOf({ asset: tok('weETH'), accountingSymbol: 'ETH', categories: [], name: 'weETH' })).toEqual({ class: 'eth', pegVerified: true });
    expect(ptClassOf({ asset: tok('HYPE'), accountingSymbol: 'HYPE', categories: [], name: 'kHYPE' })).toBeNull();
    expect(tokenClass({ symbol: 'apyUSD' })).toBe('other');
    expect(tokenClass({ symbol: 'aPYUSD' })).toBe('other');
    expect(tokenClass({ symbol: 'PYUSD' })).toBe('usd');
    const unverified = leaderLoop([ptListing({ name: 'sUSDat', asset: tok('sUSDat'), accountingSymbol: 'USDat', categories: ['rwa'] })], s, [lender()], { capital: 1000 }).rows[0];
    expect(unverified.pegVerified).toBe(false);
  });

  it('picks 3× or 2.5× per market from its own live data, and says why', async () => {
    const { ptLoopLeverage } = await import('../../src/lib/opportunity/leverage');
    const base = { impliedPct: 12, borrowPct: 5, days: 60, lltvPct: 91.5, pegVerified: true, feePercent: 0.5 };
    expect(ptLoopLeverage(base)).toEqual({ leverage: 3, reason: 'full' });
    expect(ptLoopLeverage({ ...base, pegVerified: false })).toEqual({ leverage: 2.5, reason: 'peg' });
    expect(ptLoopLeverage({ ...base, borrowPct: 10 })).toEqual({ leverage: 2.5, reason: 'spread' });
    expect(ptLoopLeverage({ ...base, days: 200 })).toEqual({ leverage: 2.5, reason: 'long' });
    // LLTV 70%: health 1.25 allows only about 2.2×.
    const low = ptLoopLeverage({ ...base, lltvPct: 70 });
    expect(low.reason).toBe('health');
    expect(low.leverage).toBeLessThan(2.5);
    // A four-year PT at 3%: its price falls far on a rate jump; leverage drops until it survives +10 points.
    const far = ptLoopLeverage({ ...base, impliedPct: 3, borrowPct: -2, days: 1460, lltvPct: 86 });
    expect(far.reason).toBe('rate');
    expect(far.leverage).toBeLessThan(2.5);
    const r = simulateLoop({ capital: 1, daysToMaturity: 1460, entryAPY: 3, leverage: far.leverage, borrowAPY: -2, lltv: 86, feePercent: 0.5 });
    expect(r.liquidationAPY - 3).toBeGreaterThanOrEqual(10 - 1e-6);
  });

  it('uses the borrow rate after the user\'s own borrow when the market publishes its curve', () => {
    const curve = { suppliedUsd: 100_000, borrowedUsd: 50_000, points: [{ u: 0, rate: 0.02 }, { u: 0.5, rate: 0.05 }, { u: 1, rate: 0.5 }], source: 'test' };
    const [r] = leaderLoop([ptListing()], s, [lender({ curve })], { capital: 10_000 }).rows;
    expect(r.lender!.rateModelled).toBe(true);
    expect(r.lender!.borrowNowPct).toBe(5);
    expect(r.lender!.borrowPct).toBeGreaterThan(5);
  });
});

describe('YT dollar ranking view', () => {
  it('shows no loop dollar figure while the lending data is missing', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LeaderRanking } = await import('../../src/components/market/LeaderRanking');
    const html = renderToString(<LeaderRanking markets={[ptListing()]} capital={1000} strategy="loop" lending={{ opportunities: null, loading: false, failed: true }} />);
    expect(html).toContain('داده‌ی بازارهای وام در دسترس نیست');
    expect(html).not.toContain('بیشترین سود');
  });

  it('lists all three protocols with symbol and protocol, four buckets, in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LeaderRanking } = await import('../../src/components/market/LeaderRanking');
    const { assertPersianMoney } = await import('../helpers/text');
    const markets = [
      listing({ id: 'p1', name: 'sUSDe', impliedAPY: 5, baseAPY: 9 }),
      listing({ id: 's1', protocol: 'spectra', name: 'stUSR', impliedAPY: 12, baseAPY: 6, hasPoints: false }),
      listing({ id: 'e1', protocol: 'exponent', name: 'ONyc', chain: 'Solana', impliedAPY: 14, baseAPY: 9 }),
    ];
    const lending = { opportunities: [lender()], loading: false, failed: false };
    const loopMarkets = [...markets, ptListing({ id: 'p2', name: 'USDx' })];
    const html = renderToString(<LeaderRanking markets={markets} capital={1000} strategy="yt" />) + renderToString(<LeaderRanking markets={loopMarkets} capital={1000} strategy="loop" lending={lending} />);
    for (const t of ['پیشنهاد', 'بازار وام', 'بدون بازار وام در منابع یلدایکس', 'بیشترین سود', 'کمترین سود', 'کمترین ضرر', 'بیشترین ضرر', 'sUSDe', 'stUSR', 'ONyc', 'Pendle', 'Spectra', 'Exponent']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, '').replace(/alt="[^"]*"/g, ''));
  });
});

describe('entry links', () => {
  it('opens the exact market where the format is known, the app and its address elsewhere', async () => {
    const { listingLink, morphoLink, isAppRoot } = await import('../../src/lib/market/links');
    // Format taken from a live Merkl depositUrl for a Pendle market.
    expect(listingLink('pendle', { id: '1-0x3FFDF143CBE1E594FBA183E2B9035EB027A732EC', chain: 'Ethereum' }, 'yt')).toEqual({ url: 'https://app.pendle.finance/trade/markets/0x3ffdf143cbe1e594fba183e2b9035eb027a732ec/swap?view=yt&chain=ethereum', exact: true });
    expect(listingLink('pendle', { id: '42161-0x3ffdf143cbe1e594fba183e2b9035eb027a732ec', chain: 'Arbitrum' }, 'pt').url).toContain('view=pt&chain=arbitrum');
    expect(listingLink('spectra', { id: 'base-0xabc', chain: 'Base' }, 'yt').exact).toBe(false);
    expect(morphoLink(8453, 'vault', '0xbeef')!.url).toBe('https://app.morpho.org/base/vault/0xbeef');
    // Each app's own chain names, not the network's common name.
    expect(morphoLink(10, 'vault', '0xbeef')!.url).toBe('https://app.morpho.org/opmainnet/vault/0xbeef');
    expect(listingLink('pendle', { id: '80094-0x3ffdf143cbe1e594fba183e2b9035eb027a732ec', chain: 'Berachain' }, 'yt').url).toContain('chain=bera');
    expect(listingLink('pendle', { id: '143-0x3ffdf143cbe1e594fba183e2b9035eb027a732ec', chain: 'Monad' }, 'yt').url).toContain('chain=monad');
    expect(isAppRoot('https://app.spectra.finance')).toBe(true);
    expect(isAppRoot('https://app.morpho.org/ethereum/market/0xabc')).toBe(false);
  });

  it('each ranked row and suggestion carries its entry link', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LeaderRanking } = await import('../../src/components/market/LeaderRanking');
    const markets = [listing({ id: '1-0x3ffdf143cbe1e594fba183e2b9035eb027a732ec', impliedAPY: 5, baseAPY: 9 }), listing({ id: 'base-0x0000000000000000000000000000000000000abc', protocol: 'spectra', name: 'stUSR', impliedAPY: 5, baseAPY: 9 })];
    const html = renderToString(<LeaderRanking markets={markets} capital={1000} strategy="yt" />);
    expect(html).toContain('href="https://app.pendle.finance/trade/markets/0x3ffdf143cbe1e594fba183e2b9035eb027a732ec/swap?view=yt&amp;chain=ethereum"');
    expect(html).toContain('ورود به بازار');
    expect(html).toContain('href="https://app.spectra.finance"');
    expect(html).toContain('0x0000000000000000000000000000000000000abc');
  });

  it('never suggests a market whose base yield looks like a temporary boost', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LeaderRanking } = await import('../../src/components/market/LeaderRanking');
    // A pool deep enough for the mid price: the row is ranked, labelled, and still not suggested.
    const html = renderToString(<LeaderRanking markets={[listing({ name: 'superWETH', impliedAPY: 4, baseAPY: 40, liquidity: 5e9 })]} capital={10_000} strategy="yt" />);
    expect(html).toContain('با این فرض‌ها هیچ YTی بی‌ضرر نیست');
    expect(html).toContain('بازده پایه احتمالاً موقت');
  });

  it('a YT too large for its pool shows no dollar figure until an executable quote arrives', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LeaderRanking } = await import('../../src/components/market/LeaderRanking');
    const html = renderToString(<LeaderRanking markets={[listing({ name: 'thinYT', impliedAPY: 1, baseAPY: 5, liquidity: 200_000 })]} capital={1000} strategy="yt" />);
    expect(html).toContain('نیازمند قیمت اجرایی');
    expect(html).toMatch(/بیشترین سود<\/span><span class="[^"]*"><bdi dir="ltr" class="num ">۰<\/bdi>/);
  });
});
