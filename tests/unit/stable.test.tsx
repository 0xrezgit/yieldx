import { describe, expect, it } from 'vitest';
import type { MarketListing } from '../../src/types/market';
import type { ProtocolId } from '../../src/types/protocol';
import { defaultPtLoopSettings, rankPtLoops, type PtLoopSettings } from '../../src/lib/stable/pt-loop';
import { maxLoopLeverage } from '../../src/lib/calculators/trade';

// Controlled test data for the formulas; not market data.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const mkt = (id: string, over: Partial<MarketListing> = {}): MarketListing & { protocol: ProtocolId } => ({
  protocol: 'pendle',
  id: `1-0x${id.padStart(40, '0')}`,
  name: 'sUSDe',
  platform: 'Ethena',
  icon: null,
  chain: 'Ethereum',
  maturity: inDays(60),
  impliedAPY: 10,
  baseAPY: 8,
  liquidity: 5e7,
  hasPoints: false,
  ytMultiplier: null,
  points: null,
  categories: ['stables'],
  isNew: false,
  asset: { symbol: 'sUSDe', address: '0x9d39' },
  accountingSymbol: 'USDe',
  sourceUpdatedAt: new Date(NOW).toISOString(),
  expired: false,
  daysToMaturity: 60,
  ...over,
});

const S: PtLoopSettings = { ...defaultPtLoopSettings, capital: 1000, days: 90, leverage: 3, borrowRate: 6, lltv: 86, minHealth: 1.05, txEthereum: 0, txOther: 0 };
const g = (r: number, d: number) => Math.pow(1 + r / 100, d / 365) - 1;
const all = (r: ReturnType<typeof rankPtLoops>) => [...r.ranking.top, ...Object.values(r.ranking.aside).flat()];

describe('PT Loop on stablecoins with the user’s borrow rate', () => {
  it('3×, implied 10%, borrow 6%, 60 days to maturity: profit on own money', () => {
    const r = rankPtLoops([mkt('a')], S, NOW);
    const e = r.ranking.top[0];
    const days = 60;
    expect(e.leverage!.leverage).toBe(3);
    expect(e.net!).toBeCloseTo(3000 * g(10, days) - 2000 * g(6, days), 6);
    expect(e.earningDays).toBeCloseTo(days, 6);
    expect(e.leverage!.equity).toBe(1000);
  });

  it('covers only stablecoin markets that are live', () => {
    const r = rankPtLoops([mkt('a'), mkt('b', { name: 'wstETH', categories: ['eth'], accountingSymbol: 'ETH' }), mkt('c', { expired: true })], S, NOW);
    expect(r.total).toBe(1);
  });

  it('asks for the borrow rate instead of inventing one', () => {
    const r = rankPtLoops([mkt('a')], { ...S, borrowRate: null }, NOW);
    expect(r.ranking.top).toHaveLength(0);
    expect(r.ranking.aside.insufficient[0].assumptions).toContain('نرخ وام را وارد کنید.');
  });

  it('ranks by dollar profit, or by profit per day when terms differ', () => {
    const long = mkt('l', { maturity: inDays(80), impliedAPY: 9 });
    const short = mkt('s', { maturity: inDays(20), impliedAPY: 12 });
    const byTotal = rankPtLoops([long, short], S, NOW).ranking.top.map((e) => e.key);
    const byDay = rankPtLoops([long, short], { ...S, sort: 'daily' }, NOW).ranking.top.map((e) => e.key);
    expect(byTotal[0]).toContain(long.id.slice(2));
    expect(byDay[0]).toContain(short.id.slice(2));
  });

  it('a maturity after the period is set aside only when an early exit may be needed', () => {
    const late = mkt('x', { maturity: inDays(200) });
    expect(rankPtLoops([late], { ...S, days: 30, needsEarlyExit: true }, NOW).ranking.aside['beyond-horizon']).toHaveLength(1);
    const held = rankPtLoops([late], { ...S, days: 30, needsEarlyExit: false }, NOW).ranking.top[0];
    expect(held.earningDays).toBeCloseTo(200, 6);
    expect(held.assumptions.some((a) => a.includes('بعد از مدت شما'))).toBe(true);
  });

  it('never goes above the leverage the LLTV and minimum health allow', () => {
    const r = rankPtLoops([mkt('a')], { ...S, lltv: 70, leverage: 4 }, NOW);
    expect(r.maxSafe).toBeCloseTo(maxLoopLeverage(70, 1.05), 12);
    expect(r.ranking.top[0].leverage!.leverage).toBeCloseTo(r.maxSafe, 12);
  });

  it('a borrow rate above the PT yield loses money and leaves the top list', () => {
    const r = rankPtLoops([mkt('a', { impliedAPY: 8 })], { ...S, borrowRate: 15 }, NOW);
    expect(r.ranking.top).toHaveLength(0);
    expect(all(r)[0].placement).toBe('unprofitable');
  });

  it('can keep to markets Pendle lists for PT looping', () => {
    const r = rankPtLoops([mkt('a', { categories: ['stables', 'pt-looping'] }), mkt('b')], { ...S, loopListedOnly: true }, NOW);
    expect(r.total).toBe(1);
  });
});

describe('render', () => {
  it('shows the loop row with its maturity and leverage in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LendingRow, LendingDetails } = await import('../../src/components/lending/LendingOpportunities');
    const { SectionSwitch } = await import('../../src/components/opportunities/SectionSwitch');
    const { assertPersianMoney } = await import('../helpers/text');
    const r = rankPtLoops([mkt('a')], S, NOW);
    const e = r.ranking.top[0];
    const o = r.byKey.get(e.key)!;
    const html = renderToString(<LendingRow e={e} o={o} rank={1} />) + renderToString(<LendingDetails e={e} o={o} />) + renderToString(<SectionSwitch current="stable" />);
    for (const t of ['اهرم', 'سررسید', 'با وام USDe', 'بدهی', 'افت قیمت نسبی تا لیکوییدشدن', 'پیشنهاد استیبل‌کوین']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, ''));
  });
});
