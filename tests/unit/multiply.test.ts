import { describe, expect, it } from 'vitest';
import { amplitudeOf, analyzeMultiply, maxLeverageOf, pathOf, realizedVol, SCENARIOS, simulate, type MultiplyPairInput } from '../../src/lib/multiply/model';

// Controlled pair for the formulas (rates and limits of the shape Kamino publishes). Not market data.
const pair = (over: Partial<MultiplyPairInput> = {}): MultiplyPairInput => ({
  collateralYieldPct: 0,
  borrowPct: 0,
  liqLtv: 0.8,
  maxLtv: 0.75,
  liqBonus: 0.05,
  closeFactor: 0.2,
  volPct: 60,
  ...over,
});
const set = { capital: 1000, leverage: 2, days: 30, swapPct: 0 };
const straight = (end: number, days = 30) => Array.from({ length: days + 1 }, (_, i) => 1 + ((end - 1) * i) / days);
const by = (a: ReturnType<typeof analyzeMultiply>, id: string) => a.scenarios.find((s) => s.scenario === id)!;

describe('Multiply on a volatile collateral', () => {
  it('liquidation price: price₀ × (L − 1) ÷ (L × liqLtv); 2× at 80 % → a 37.5 % fall', () => {
    const a = analyzeMultiply(pair(), set);
    expect(a.liqPrice).toBeCloseTo(0.625, 12);
    expect(a.liqDrop).toBeCloseTo(0.375, 12);
    expect(a.health).toBeCloseTo(1.6, 12);
  });

  it('interest alone lifts the liquidation price over the period', () => {
    const a = analyzeMultiply(pair({ borrowPct: 10 }), { ...set, days: 365 });
    expect(a.liqPriceEnd).toBeCloseTo(0.625 * 1.1, 10);
  });

  it('never runs above the protocol’s borrowing limit', () => {
    expect(maxLeverageOf(0.75)).toBeCloseTo(4, 12);
    expect(analyzeMultiply(pair(), { ...set, leverage: 10 }).leverage).toBeCloseTo(4, 12);
  });

  it('without costs or rates: spot follows the price, leverage multiplies the move', () => {
    const path = straight(1.1);
    expect(simulate(pair(), set, 'spot', path).pnl).toBeCloseTo(100, 8);
    expect(simulate(pair(), set, 'hold', path).pnl).toBeCloseTo(200, 8);
  });

  it('liquidates as the protocol does: part of the debt at a time, with the bonus taken from the collateral', () => {
    const r = simulate(pair(), set, 'hold', straight(0.6, 4));
    expect(r.liquidated).toBe(true);
    expect(r.liquidationLoss).toBeGreaterThan(0);
    // Below the plain 2× result (2 × 0.6 − 1 = 0.2 of the capital) by the bonus paid.
    expect(r.equity).toBeLessThan(200);
  });

  it('a slow fall: the guard deleverages in time and avoids liquidation; set-and-forget does not', () => {
    const path = straight(0.6, 60);
    const L = { ...set, leverage: 3, days: 60 };
    expect(simulate(pair(), L, 'hold', path).liquidated).toBe(true);
    const g = simulate(pair(), L, 'guard', path);
    expect(g.liquidated).toBe(false);
    expect(g.actions).toBeGreaterThan(0);
  });

  it('the stop-loss closes once and keeps the cash', () => {
    const r = simulate(pair(), { ...set, leverage: 3 }, 'stop', straight(0.7));
    expect(r.closedEarly).toBe(true);
    expect(r.actions).toBe(1);
    expect(r.pnlPct).toBeLessThanOrEqual(-30);
    expect(r.pnlPct).toBeGreaterThan(-45);
  });

  it('six paths sized by the pair’s volatility; the chop and the dip end where they started', () => {
    const amp = amplitudeOf(60, 30);
    expect(amp).toBeCloseTo(0.6 * Math.sqrt(30 / 365), 12);
    for (const id of ['chop', 'dip'] as const) {
      const p = pathOf(SCENARIOS.find((s) => s.id === id)!, amp, 30);
      expect(p[p.length - 1]).toBeCloseTo(1, 9);
      expect(Math.min(...p)).toBeLessThan(1);
    }
    const a = analyzeMultiply(pair(), set);
    expect(a.scenarios).toHaveLength(6);
    expect(by(a, 'crash').endPrice).toBeLessThan(by(a, 'bear').endPrice);
    expect(by(a, 'rally').endPrice).toBeGreaterThan(by(a, 'bull').endPrice);
    for (const s of a.scenarios) expect(s.results.map((r) => r.strategy)).toEqual(['spot', 'hold', 'guard', 'constant', 'stop']);
  });

  it('realised volatility: annualised σ of daily log returns, null on a short series', () => {
    expect(realizedVol([1, 1.01, 1])).toBeNull();
    const flat = Array.from({ length: 30 }, () => 1);
    expect(realizedVol(flat)).toBe(0);
    const alt = Array.from({ length: 31 }, (_, i) => (i % 2 ? 1.01 : 1));
    expect(realizedVol(alt)!).toBeGreaterThan(15);
  });
});

describe('render', () => {
  it('shows the liquidation price, the payoff chart and each scenario’s strategies in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement: h } = await import('react');
    const { Summary, PayoffChart, ScenarioCard } = await import('../../src/components/tools/MultiplyTool');
    const { assertPersianMoney } = await import('../helpers/text');
    const row = {
      ...pair({ collateralYieldPct: 4, borrowPct: 7 }),
      key: 'k', market: { address: 'M', name: 'Main Market' },
      collateral: { symbol: 'SOL', mint: 'So1', priceUsd: 104, icon: null }, debt: { symbol: 'USDC', mint: 'EPj', priceUsd: 1, icon: null },
      elevationGroup: 0, borrowNowPct: 7, borrow7dPct: 6, ownYieldPct: 0, supplyPct: 4, availableUsd: 1e6, depositUsd: 1e8, volDays: 90, history: [], url: 'https://kamino.com',
    };
    const a = analyzeMultiply(row, { capital: 10000, leverage: 3, days: 30, swapPct: 0.2 });
    const html = [h(Summary, { row, a, capital: 10000 }), h(PayoffChart, { row, a, capital: 10000, days: 30 }), ...a.scenarios.map((sc) => h(ScenarioCard, { key: sc.scenario, sc, row, liq: a.liqPrice }))].map((e) => renderToString(e)).join('');
    for (const t of ['قیمت لیکوییدشدن', 'سقوط ناگهانی', 'رالی تند', 'محافظ سلامت', 'حد ضرر', 'درس این مسیر']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ''));
  });
});
