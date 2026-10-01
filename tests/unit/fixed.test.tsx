import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { Opportunity, OrderBook } from '../../src/types/opportunity';
import { fillAsks, sellIntoBids, settlementFeeAt, impliedApy } from '../../src/lib/opportunity/book';
import { estimate } from '../../src/lib/opportunity/estimate';
import { evaluate, selectHorizon } from '../../src/lib/market/analysis';
import { fetchMidnight, midnightOpportunity, MIDNIGHT_FEE_BREAKPOINTS_SEC, MIDNIGHT_MAX_CONTINUOUS_FEE_YEAR, MIDNIGHT_MAX_SETTLEMENT_FEES, type RawBook } from '../../src/lib/lending/midnight';

// Controlled test data for the formulas and schema-shaped fixtures (official
// @morpho-org/midnight-sdk API types); not market data.

const NOW = Date.parse('2026-09-30T00:00:00Z');
const AT = new Date(NOW).toISOString();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const noFees: Pick<OrderBook, 'settlementFee' | 'continuousFeePerYear'> = {
  settlementFee: { breakpointsSec: [0, 86_400], values: [0, 0], basis: 'market' },
  continuousFeePerYear: { value: 0, basis: 'market' },
};

const fixed = (over: Partial<OrderBook> = {}, maturityDays = 20, o: Partial<Opportunity> = {}): Opportunity => ({
  key: `morpho:eip155:1:0xm${maturityDays}:fixed`,
  family: 'fixed-lend',
  protocol: { id: 'morpho', version: 'midnight', name: 'Morpho Midnight' },
  chain: 'eip155:1',
  market: { id: '0xm', address: null, name: 'USDC · وثیقه WBTC' },
  assets: { deposit: [{ symbol: 'USDC', address: '0xusdc' }] },
  rate: { value: null, kind: 'quote', feesIncluded: true, rewardsIncluded: false, at: null },
  maturity: inDays(maturityDays),
  capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
  exit: { type: 'maturity' },
  rewards: [],
  book: {
    // 3000 of money at 0.99 and 5000 at 0.985, as units.
    asks: [
      { price: 0.985, units: 5000 / 0.985 },
      { price: 0.99, units: 3000 / 0.99 },
    ],
    bids: [{ price: 0.98, units: 1e9 }],
    unitUsd: 1,
    loanSymbol: 'USDC',
    gated: false,
    ...noFees,
    ...over,
  },
  quality: 'current',
  sources: [],
  ...o,
});

const input = (over = {}) => ({ capital: 10_000, days: 30, now: NOW, ...over });

describe('order book fill (report test 6)', () => {
  it('walks the book instead of using the best price, and keeps the rest unallocated', () => {
    const f = fillAsks(fixed().book!.asks, 10_000, 0);
    expect(f.spent).toBeCloseTo(8000, 6);
    expect(f.left).toBeCloseTo(2000, 6);
    expect(f.units).toBeCloseTo(3030.303 + 5076.142, 2);
    expect(f.averagePrice!).toBeCloseTo(0.98688, 4);
    // Best price for everything would have claimed 10 000 / 0.985 units.
    expect(f.units).toBeLessThan(10_000 / 0.985);
  });

  it('estimates the result held to maturity; unallocated money earns nothing', () => {
    const e = estimate(fixed(), input());
    expect(e.allocatable).toBeCloseTo(8000, 6);
    expect(e.unallocated).toBeCloseTo(2000, 6);
    expect(e.baseIncome!).toBeCloseTo(8106.445 - 8000, 2);
    expect(e.earningDays).toBe(20);
    expect(e.placement).toBe('ranked');
    expect(e.unallocatedReason).not.toBeNull();
  });

  it('adds the settlement fee to the price paid and never deducts it again', () => {
    const f = fillAsks([{ price: 0.99, units: 100 }], 50, 0.001);
    expect(f.spent / f.units).toBeCloseTo(0.991, 12);
    expect(f.feePaid).toBeCloseTo(f.units * 0.001, 12);
    const withFee = fixed({ settlementFee: { breakpointsSec: [0, 86_400], values: [0.001, 0.001], basis: 'market' } });
    const e = estimate(withFee, input());
    expect(e.costs.some((c) => c.key.includes('settlement'))).toBe(false);
  });

  it('charges the continuous fee on units until maturity', () => {
    const e = estimate(fixed({ continuousFeePerYear: { value: 0.01, basis: 'max' } }), input());
    const units = 3030.303 + 5076.142;
    expect(e.costs.find((c) => c.key === 'continuous-fee')!.usd).toBeCloseTo(units * 0.01 * (20 / 365), 2);
  });

  it('sells into bids net of the settlement fee', () => {
    expect(sellIntoBids([{ price: 0.98, units: 10 }, { price: 0.99, units: 5 }], 8, 0.001)).toEqual({ proceeds: 5 * 0.989 + 3 * 0.979, sold: 8 });
  });
});

describe('fees taken at the protocol maximum', () => {
  it('interpolates the settlement fee between breakpoints like Midnight', () => {
    const fee = { breakpointsSec: MIDNIGHT_FEE_BREAKPOINTS_SEC, values: MIDNIGHT_MAX_SETTLEMENT_FEES, basis: 'max' as const };
    expect(settlementFeeAt(fee, 30 * 86_400)).toBeCloseTo(0.000417, 12);
    expect(settlementFeeAt(fee, 60 * 86_400)).toBeCloseTo((0.000417 + 0.00125) / 2, 12);
    expect(settlementFeeAt(fee, 400 * 86_400)).toBeCloseTo(0.005, 12);
  });

  it('caps the continuous fee at 1% a year', () => {
    expect(MIDNIGHT_MAX_CONTINUOUS_FEE_YEAR).toBeCloseTo(0.01, 6);
  });

  it('annualises a fixed return as APY', () => {
    expect(impliedApy(0.99, 1, 365)).toBeCloseTo((1 / 0.99 - 1) * 100, 9);
  });
});

describe('maturity against the user’s period (report test 7)', () => {
  it('gives a maturity after the horizon no number for that horizon (today’s bids are not an exit model)', () => {
    const e = estimate(fixed({}, 90), input({ capital: 1000 }));
    expect(e.placement).toBe('needs-model');
    expect(e.net).toBeNull();
  });

  it('ranks it at the horizon that reaches its maturity', () => {
    const e = estimate(fixed({}, 90), input({ capital: 1000, days: 90 }));
    expect(e.placement).toBe('ranked');
    expect(e.earningDays).toBe(90);
  });

  it('each horizon selects its own candidates', () => {
    const a = evaluate({ opportunities: [fixed({}, 90), fixed({}, 20)], merkl: null, gas: [] }, 1000, NOW);
    expect(selectHorizon(a, 30, 'fixed').ranking.top).toHaveLength(1);
    expect(selectHorizon(a, 90, 'fixed').ranking.top).toHaveLength(2);
  });

  it('marks a gated market as partial data and an empty book as without capacity', () => {
    expect(estimate(fixed({ gated: true }), input()).quality).toBe('partial');
    expect(estimate(fixed({ asks: [] }), input()).placement).toBe('no-capacity');
  });
});

// ─── Adapter ────────────────────────────────────────────────────────────────

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WBTC = '0x0555e30da8f98308edb960aa94c0db47230d2b9c';
const level = (price: number, units: number) => ({ tick: 0, price: (BigInt(Math.round(price * 1e6)) * BigInt(1e12)).toString(), units: BigInt(Math.round(units * 1e6)) + '', assets: '0', count: 1 });
const rawBook = (over: Partial<RawBook> = {}): RawBook => ({
  market_id: '0xMARKET',
  chain_id: 8453,
  midnight: '0x0000000000000000000000000000000000001000',
  loan_token: USDC,
  collaterals: [{ token: WBTC, lltv: '860000000000000000', liquidation_cursor: '0', oracle: '0x0000000000000000000000000000000000000002' }],
  maturity: Math.floor((NOW + 60 * 86_400_000) / 1000),
  rcf_threshold: '0',
  enter_gate: '0x0000000000000000000000000000000000000000',
  liquidator_gate: '0x0000000000000000000000000000000000000000',
  asks: [level(0.99, 1000)],
  bids: [level(0.98, 1000)],
  ...over,
});
const tokens = new Map([
  [`8453:${USDC}`, { symbol: 'USDC', decimals: 6, priceUsd: 1, logoURI: null }],
  [`8453:${WBTC}`, { symbol: 'WBTC', decimals: 8, priceUsd: 100_000, logoURI: null }],
]);

describe('Midnight adapter', () => {
  it('reads WAD prices and raw units with the loan token’s decimals', () => {
    const o = midnightOpportunity(rawBook(), tokens, AT)!;
    expect(o.key).toBe('morpho:eip155:8453:0xmarket:fixed');
    expect(o.family).toBe('fixed-lend');
    expect(o.book!.asks[0]).toEqual({ price: 0.99, units: 1000 });
    expect(o.book!.settlementFee.basis).toBe('max');
    expect(o.market.name).toBe('USDC · وثیقه WBTC');
    expect(o.book!.gated).toBe(false);
  });

  it('flags an entry gate and refuses an unpriced loan token', () => {
    expect(midnightOpportunity(rawBook({ enter_gate: '0x00000000000000000000000000000000000000aa' }), tokens, AT)!.book!.gated).toBe(true);
    expect(midnightOpportunity(rawBook(), new Map(), AT)!.quality).toBe('insufficient');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fetches books, full depth per side and token details; drops matured books', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (String(url).includes('/books?')) {
        // Only Base has books here; an unquoted book and one past the longest horizon get no row.
        if (new URL(String(url)).searchParams.get('chain_ids') !== '8453') return json({ cursor: null, data: [] });
        return json({
          cursor: null,
          data: [
            rawBook(),
            rawBook({ market_id: '0xOLD', maturity: Math.floor(NOW / 1000) - 10 }),
            rawBook({ market_id: '0xEMPTY', asks: [], bids: [] }),
            rawBook({ market_id: '0xFAR', maturity: Math.floor((NOW + 400 * 86_400_000) / 1000) }),
          ],
        });
      }
      if (String(url).endsWith('/asks?depth=100')) return json({ data: [level(0.99, 1000), level(0.995, 5000)] });
      if (String(url).endsWith('/bids?depth=100')) return json({ data: [level(0.98, 1000)] });
      if (String(url).includes('graphql')) {
        // One filtered list per chain; a token Morpho does not know is simply missing from it.
        expect(JSON.parse(String(init?.body)).variables).toMatchObject({ chain: 8453 });
        return json({ data: { assets: { items: [{ address: USDC, symbol: 'USDC', decimals: 6, price: { usd: 1 }, logoURI: null }, { address: WBTC, symbol: 'WBTC', decimals: 8, price: { usd: 1e5 }, logoURI: null }] } } });
      }
      return new Response('{}', { status: 404 });
    }));
    const list = await fetchMidnight(AT, NOW);
    expect(list).toHaveLength(1);
    expect(list[0].book!.asks).toHaveLength(2);
    // One chain per request, 20 books per page (the API's limits).
    expect(calls.filter((c) => c.includes('/books?')).map((c) => new URL(c).searchParams.get('chain_ids')).sort()).toEqual(['1', '8453']);
    expect(calls.every((c) => !c.includes('/books?') || new URL(c).searchParams.get('limit') === '20')).toBe(true);
    for (const id of ['0xOLD', '0xEMPTY', '0xFAR']) expect(calls.some((c) => c.includes(id))).toBe(false);
  });
});

describe('fixed-rate row render', () => {
  it('shows the maturity, today’s sale value and the effective rate in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { RankingRow } = await import('../../src/components/market/MarketAnalysis');
    const { OpportunityDetails } = await import('../../src/components/market/OpportunityDetails');
    const { assertPersianMoney } = await import('../helpers/text');
    const o = midnightOpportunity(rawBook(), tokens, AT)!;
    const row = evaluate({ opportunities: [o], merkl: null, gas: [] }, 500, NOW).rows[0];
    expect(row.byHorizon[90].placement).toBe('ranked');
    expect(row.byHorizon[30].placement).toBe('needs-model');
    const html = renderToString(<RankingRow row={row} rank={1} days={90} open={false} onToggle={() => {}} modelVersion="t" />) + renderToString(<OpportunityDetails row={row} days={90} modelVersion="t" />);
    expect(html).toContain('نرخ ثابت');
    expect(html).toContain('در سررسید');
    expect(html).toContain('سررسید روز');
    expect(html).toContain('نیازمند مدل خروج');
    expect(html).toContain('نه تضمین بازگشت اصل سرمایه');
    expect(html).not.toContain('NaN');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, ''));
  });
});
