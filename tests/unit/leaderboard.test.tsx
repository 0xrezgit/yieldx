import { describe, expect, it } from 'vitest';
import { buckets, leaderLoop, leaderYt, type LeaderRow } from '../../src/lib/risk/leaderboard';
import { simulateLoop } from '../../src/lib/calculators/trade';
import { defaultLoopSettings } from '../../src/lib/risk/opportunities';
import { defaultScreenSettings, type OpportunityListing } from '../../src/lib/risk/opportunities';
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

describe('leaderLoop', () => {
  it('matches the loop simulator at maturity and judges against the minimum return', () => {
    const m = listing({ impliedAPY: 12, daysToMaturity: 90 });
    const [r] = leaderLoop([m], s, defaultLoopSettings, { capital: 10_000, hurdle: 8 });
    const sim = simulateLoop({ capital: 10_000, daysToMaturity: 90, entryAPY: 12, leverage: defaultLoopSettings.leverage, borrowAPY: defaultLoopSettings.borrowAPY, lltv: defaultLoopSettings.lltv, feePercent: s.feePercent });
    expect(r.pnl).toBeCloseTo(sim.profit, 9);
    expect(r.days).toBe(90);
    expect(r.verdict).toBe('worth');
    const [loss] = leaderLoop([listing({ impliedAPY: 3 })], s, { ...defaultLoopSettings, borrowAPY: 12 }, { capital: 10_000 });
    expect(loss.verdict).toBe('loss');
  });

  it('keeps loops to markets listed for looping or deep stablecoin markets', () => {
    expect(leaderLoop([listing({ categories: [], name: 'ETHx' })], s, defaultLoopSettings, { capital: 1000 })).toHaveLength(0);
  });
});

describe('YT dollar ranking view', () => {
  it('lists all three protocols with symbol and protocol, four buckets, in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LeaderRanking } = await import('../../src/components/market/LeaderRanking');
    const { assertPersianMoney } = await import('../helpers/text');
    const markets = [
      listing({ id: 'p1', name: 'sUSDe', impliedAPY: 5, baseAPY: 9 }),
      listing({ id: 's1', protocol: 'spectra', name: 'stUSR', impliedAPY: 12, baseAPY: 6, hasPoints: false }),
      listing({ id: 'e1', protocol: 'exponent', name: 'ONyc', chain: 'Solana', impliedAPY: 14, baseAPY: 9 }),
    ];
    const html = renderToString(<LeaderRanking markets={markets} capital={1000} strategy="yt" />) + renderToString(<LeaderRanking markets={markets} capital={1000} strategy="loop" />);
    for (const t of ['پیشنهاد', 'بهره‌ی وام', 'بیشترین سود', 'کمترین سود', 'کمترین ضرر', 'بیشترین ضرر', 'sUSDe', 'stUSR', 'ONyc', 'Pendle', 'Spectra', 'Exponent']) expect(html).toContain(t);
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
    const html = renderToString(<LeaderRanking markets={[listing({ name: 'superWETH', impliedAPY: 4, baseAPY: 40 })]} capital={10_000} strategy="yt" />);
    expect(html).toContain('با این فرض‌ها هیچ YTی بی‌ضرر نیست');
    expect(html).toContain('بازده پایه احتمالاً موقت');
  });
});
