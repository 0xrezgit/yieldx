import { describe, expect, it } from 'vitest';
import { breakEven, defaultMoves, inRangeShare, scenario, valueAt, type LpInput } from '../../src/lib/lp/scenarios';
import { calculateImpermanentLoss } from '../../src/lib/risk/impermanent-loss';
import { lpLink, readLpPrefill } from '../../src/components/opportunities/LpAnalyzer';

// Controlled test data for the formulas; not market data.

const full = (over: Partial<LpInput> = {}): LpInput => ({ capital: 1000, days: 30, shape: { kind: 'full' }, feeAprPct: 20, rewardUsd: null, rewardAprPct: 0, costsUsd: 0, ...over });
const range = (low: number, high: number, over: Partial<LpInput> = {}): LpInput => full({ shape: { kind: 'range', low, high }, ...over });

describe('LP value against holding', () => {
  it('full range: value C·√p and HODL C·(1 + p)/2 — a 4× move costs 20% against HODL', () => {
    const v = valueAt({ kind: 'full' }, 1000, 4);
    expect(v.position).toBeCloseTo(2000, 9);
    expect(v.hodl).toBeCloseTo(2500, 9);
    expect(scenario(full(), 3).ilPct).toBeCloseTo(-20, 9);
  });

  it('no price change: no change in value', () => {
    const s = scenario(full(), 0);
    expect(s.positionUsd).toBeCloseTo(1000, 9);
    expect(s.ilUsd).toBeCloseTo(0, 9);
  });

  it('concentrated range matches the existing CLMM function and loses more than full range', () => {
    const r = scenario(range(0.9, 1.1), 0.05);
    expect(-r.ilPct).toBeCloseTo(calculateImpermanentLoss(0.9, 1.1, 1.05, 1), 9);
    expect(r.ilUsd).toBeLessThan(scenario(full(), 0.05).ilUsd);
  });

  it('earns fees only while in range, along a straight path', () => {
    expect(inRangeShare({ kind: 'range', low: 0.9, high: 1.1 }, 1.2)).toBeCloseTo(0.5, 12);
    expect(inRangeShare({ kind: 'range', low: 0.9, high: 1.1 }, 1.05)).toBe(1);
    expect(inRangeShare({ kind: 'full' }, 3)).toBe(1);
    const out = scenario(range(0.9, 1.1), 0.2);
    const inside = scenario(range(0.9, 1.1), 0.05);
    expect(out.inRange).toBeCloseTo(0.5, 12);
    expect(out.feesUsd!).toBeLessThan(inside.feesUsd!);
  });

  it('keeps fees, rewards, value change and costs apart, and never adds a probability', () => {
    const s = scenario(full({ rewardUsd: 7, costsUsd: 2 }), -0.2);
    expect(s.vsHodlUsd!).toBeCloseTo(s.ilUsd + s.feesUsd! + 7 - 2, 9);
    expect(s.vsCashUsd!).toBeCloseTo(s.positionUsd - 1000 + s.feesUsd! + 7 - 2, 9);
    expect(s).not.toHaveProperty('probability');
  });

  it('without a fee rate shows the value change only (no invented fees)', () => {
    const s = scenario(full({ feeAprPct: null }), 0.1);
    expect(s.feesUsd).toBeNull();
    expect(s.vsHodlUsd).toBeNull();
  });

  it('finds the break-even moves where fees and rewards stop covering the value change', () => {
    const input = full({ feeAprPct: 30, days: 90 });
    const be = breakEven(input);
    expect(be.down).not.toBeNull();
    expect(be.up).not.toBeNull();
    expect(scenario(input, be.down!).vsHodlUsd!).toBeCloseTo(0, 6);
    expect(scenario(input, be.up!).vsHodlUsd!).toBeCloseTo(0, 6);
    expect(breakEven(full({ feeAprPct: 0, costsUsd: 1 }))).toEqual({ down: null, up: null });
  });

  it('uses small moves for two stablecoins (depeg) and larger ones otherwise', () => {
    expect(Math.max(...defaultMoves(true).map(Math.abs))).toBeLessThan(Math.max(...defaultMoves(false).map(Math.abs)));
  });
});

describe('analyzer', () => {
  it('opens pre-filled from a link', () => {
    const href = lpLink({ name: 'WETH/USDC 0.05%', a: 'WETH', b: 'USDC', feeApr: 12.345, rewardUsd: 3.2, capital: 1000, days: 30 });
    const p = readLpPrefill(new URL(href, 'http://x').searchParams);
    expect(p).toMatchObject({ name: 'WETH/USDC 0.05%', a: 'WETH', b: 'USDC', feeApr: 12.35, rewardUsd: 3.2, capital: 1000, days: 30, stable: false });
  });

  it('a pool with a measured swing gets usual and sharp scenarios from it, scaled to the period', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LpAnalyzer } = await import('../../src/components/opportunities/LpAnalyzer');
    const html = renderToString(<LpAnalyzer prefill={{ name: 'NVDA/USDG · Uniswap', a: 'NVDA', b: 'USDG', feeApr: 40, capital: 1000, days: 7, chain: 'Robinhood Chain', protocol: 'Uniswap', move7d: { down: 5, up: 8 } }} />);
    for (const t of ['افت شدید', 'افت معمول', 'رشد معمول', 'رشد شدید', 'رابین‌هود چین']) expect(html).toContain(t);
    // 7 days: the usual swing is the measured one itself.
    expect(html).toContain('−۵٪');
    expect(html).toContain('+۸٪');
    expect(html).not.toContain('NaN');
  });

  it('renders dollar results per hypothetical scenario, in Persian', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LpAnalyzer } = await import('../../src/components/opportunities/LpAnalyzer');
    const { assertPersianMoney } = await import('../helpers/text');
    const html = renderToString(<LpAnalyzer prefill={{ a: 'WETH', b: 'USDC', feeApr: 15, rewardUsd: 4, capital: 1000, days: 30 }} />);
    for (const t of ['سناریوی فرضی', 'پیش‌بینی نیست', 'چقدر سرمایه می‌گذارید؟', 'قیمت ثابت', 'کارمزد دریافتی', 'پاداش', 'تغییر ارزش دارایی‌ها', 'در مقایسه با نگه‌داشتن ساده', 'سربه‌سر']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
    expect(html).not.toMatch(/احتمال\s*[۰-۹\d]/);
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/value="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, ''));
  });
});
