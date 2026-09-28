import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  formatPercent,
  formatUSD,
  parseLocaleNumber,
  parseNumberList,
} from '../../src/lib/utils/formatting';
import { validateScenario } from '../../src/lib/utils/validation';
import { daysUntil, linearSlope, stdDev } from '../../src/lib/utils/math';
import { analyzeScenario } from '../../src/lib/analysis';
import { buildInsights, buildVerdict } from '../../src/lib/risk/advisor';
import { evaluateAlerts, isAlertRule, type AlertRule } from '../../src/lib/risk/alerts';
import { ptPriceFromAPY } from '../../src/lib/calculators/implied-apy';
import { defaultScenario, type ScenarioParams } from '../../src/types/scenario';

const NOW = Date.UTC(2026, 0, 1);
const scenario = (over: Partial<ScenarioParams> = {}): ScenarioParams => ({
  ...defaultScenario(),
  maturity: '2026-07-01', // 181 days after NOW
  ...over,
});

describe('Persian formatting', () => {
  it('uses Persian digits and separators', () => {
    expect(formatNumber(1234.5)).toBe('۱٬۲۳۴٫۵');
    // Dollars are written «دلار» after a bidi-isolated number, never «$».
    expect(formatUSD(-1234.5)).toBe('\u2066−۱٬۲۳۴٫۵\u2069 دلار');
    expect(formatUSD(12, 0, true)).toBe('\u2066+۱۲\u2069 دلار');
    expect(formatUSD(-0.001)).toBe('\u2066۰\u2069 دلار');
    // What the app displays can be read back (negative APY history, pasted values).
    expect(parseLocaleNumber(formatNumber(-1.5))).toBe(-1.5);
    expect(parseNumberList(['−۱٫۵', '۲٬۵۰۰'].join('، '))).toEqual([-1.5, 2500]);
    expect(formatPercent(8.5)).toBe('۸٫۵٪');
    expect(formatPercent(2, 0, true)).toBe('+۲٪');
  });

  it('prints a dash for non-finite numbers', () => {
    expect(formatUSD(Infinity)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
  });

  it('parses Persian, Arabic and Latin input', () => {
    expect(parseLocaleNumber('۱٬۲۳۴٫۵')).toBe(1234.5);
    expect(parseLocaleNumber('١٢')).toBe(12);
    expect(parseLocaleNumber('1,000.25')).toBe(1000.25);
    expect(parseLocaleNumber('')).toBeNaN();
    expect(parseLocaleNumber('abc')).toBeNaN();
  });

  it('parses APY history lists with mixed separators', () => {
    expect(parseNumberList('۵٫۱، 6.2, ۷\n8;9')).toEqual([5.1, 6.2, 7, 8, 9]);
    expect(parseNumberList('  ')).toEqual([]);
  });
});

describe('math helpers', () => {
  it('computes days, slope and deviation', () => {
    expect(daysUntil('2026-01-11', NOW)).toBe(10);
    expect(daysUntil('2020-01-01', NOW)).toBe(1);
    expect(linearSlope([2, 4, 6])).toBeCloseTo(2);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });
});

describe('validation', () => {
  it('accepts the default scenario', () => {
    expect(validateScenario(scenario(), NOW).valid).toBe(true);
  });

  it('rejects LTV at or above the liquidation threshold', () => {
    const v = validateScenario(scenario({ ltv: 90, liquidationThreshold: 85 }), NOW);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.field === 'ltv')).toBe(true);
  });

  it('warns (but allows) when PT + YT is far from 1', () => {
    const v = validateScenario(scenario({ ptPrice: 0.9, ytPrice: 0.2 }), NOW);
    expect(v.valid).toBe(true);
    expect(v.issues).toContainEqual(expect.objectContaining({ field: 'ytPrice', level: 'warning' }));
  });

  it('rejects past maturities and PT prices in USD', () => {
    expect(validateScenario(scenario({ maturity: '2025-01-01' }), NOW).valid).toBe(false);
    expect(validateScenario(scenario({ ptPrice: 2500 }), NOW).valid).toBe(false);
  });
});

describe('analyzeScenario', () => {
  it('produces all four strategies and picks a best one', () => {
    const a = analyzeScenario(scenario(), NOW);
    expect(a.days).toBe(181);
    expect(a.strategies.map((s) => s.id)).toEqual(['pt', 'loop', 'yt', 'clmm']);
    expect(a.validation.valid).toBe(true);
    expect(a.best).not.toBeNull();
  });

  it('does not rank strategies when inputs are invalid', () => {
    const a = analyzeScenario(scenario({ capital: 0 }), NOW);
    expect(a.best).toBeNull();
  });
});

describe('advisor', () => {
  it('stops on invalid inputs', () => {
    const p = scenario({ capital: -1 });
    const a = analyzeScenario(p, NOW);
    const insights = buildInsights(p, a);
    expect(insights[0]).toMatchObject({ id: 'invalid-input', severity: 'critical' });
    expect(buildVerdict(a, insights).level).toBe('stop');
  });

  it('raises a critical gap alert when implied APY far exceeds base APY', () => {
    const pt = ptPriceFromAPY(15, 181);
    const p = scenario({ baseAPY: 8, ptPrice: pt, ytPrice: 1 - pt });
    const insights = buildInsights(p, analyzeScenario(p, NOW));
    expect(insights.find((i) => i.id === 'gap')?.severity).toBe('critical');
  });

  it('flags an out-of-range CLMM position', () => {
    const p = scenario({ rangeLowerAPY: 1, rangeUpperAPY: 2 });
    const insights = buildInsights(p, analyzeScenario(p, NOW));
    expect(insights.find((i) => i.id === 'clmm-range')?.severity).toBe('critical');
  });

  it('never recommends a strategy that has a critical issue', () => {
    // Deep loop at LTV close to the threshold: profitable but liquidation risk is critical.
    const p = scenario({ loops: 10, ltv: 84, liquidationThreshold: 85, borrowAPY: 0 });
    const a = analyzeScenario(p, NOW);
    const insights = buildInsights(p, a);
    expect(insights.find((i) => i.id === 'liquidation')).toMatchObject({ strategy: 'loop', severity: 'critical' });
    const verdict = buildVerdict(a, insights);
    expect(verdict.best?.id).not.toBe('loop');
  });

  it('does not let an unrelated strategy’s problem block the verdict', () => {
    const p = scenario({ rangeLowerAPY: 1, rangeUpperAPY: 2 }); // CLMM out of range
    const a = analyzeScenario(p, NOW);
    const verdict = buildVerdict(a, buildInsights(p, a));
    expect(verdict.best).not.toBeNull();
    expect(verdict.best?.id).not.toBe('clmm');
    expect(verdict.level).not.toBe('stop');
  });

  it('orders insights by severity', () => {
    const p = scenario({ rangeLowerAPY: 1, rangeUpperAPY: 2 });
    const rank = { critical: 0, warning: 1, info: 2, positive: 3 };
    const sev = buildInsights(p, analyzeScenario(p, NOW)).map((i) => rank[i.severity]);
    expect(sev).toEqual([...sev].sort((x, y) => x - y));
  });
});

describe('alerts', () => {
  const a = analyzeScenario(scenario(), NOW);
  const rule = (over: Partial<AlertRule>): AlertRule => ({
    id: 'r',
    metric: 'impliedAPY',
    operator: 'gt',
    threshold: 0,
    enabled: true,
    ...over,
  });

  it('fires only enabled rules whose condition holds', () => {
    const hits = evaluateAlerts(
      [rule({ id: 'a' }), rule({ id: 'b', threshold: 1000 }), rule({ id: 'c', enabled: false })],
      a,
    );
    expect(hits.map((h) => h.rule.id)).toEqual(['a']);
    expect(hits[0].value).toBeCloseTo(a.implied.impliedAPY);
  });

  it('never fires on metrics without data', () => {
    expect(evaluateAlerts([rule({ metric: 'apyTrend7d', operator: 'lt', threshold: 100 })], a)).toEqual([]);
  });

  it('validates rule shape', () => {
    expect(isAlertRule(rule({}))).toBe(true);
    expect(isAlertRule({ ...rule({}), metric: 'nope' })).toBe(false);
    expect(isAlertRule({ ...rule({}), threshold: Infinity })).toBe(false);
  });
});
