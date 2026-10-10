import { describe, expect, it } from 'vitest';
import { GLOSSARY, WALKTHROUGHS } from '../../src/lib/learn/content';
import { COMPARE, LESSONS } from '../../src/lib/learn/lessons';

const TOOL_TABS = ['yt', 'calc', 'lp', 'borrow', 'verified'];

/** Every in-app link the learn section points to resolves to a real page or tab. */
function resolves(href: string): boolean {
  if (href === '/' || href === '/portfolio/new' || href === '/portfolio') return true;
  const tab = /^\/tools\?tab=(\w+)$/.exec(href);
  if (tab) return TOOL_TABS.includes(tab[1]);
  // The market analysis: a view (YT dollar, PT loop) or a search.
  return /^\/\?(view=(yt|loop)|q=\w+)$/.test(href);
}

const years = (days: number) => days / 365;

describe('learn section', () => {
  it('every lesson explains source, formula, example, method, skills, English terms, risks and exit', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      for (const part of [l.source, l.formula, l.example, l.yieldx, l.skills, l.vocab, l.risks]) expect(part.length, l.id).toBeGreaterThan(0);
      expect(l.exit, l.id).toBeTruthy();
      for (const v of l.vocab) expect(v.en && v.fa && v.means, `${l.id}: ${v.en}`).toBeTruthy();
    }
    // The comparison table covers each way of earning (pool types is a part of LP).
    expect(COMPARE.map((c) => c.id).sort()).toEqual(LESSONS.map((l) => l.id).filter((id) => id !== 'pool-types').sort());
  });

  it('links go to real pages and tabs', () => {
    const links = [
      ...LESSONS.flatMap((l) => (l.link ? [l.link.href] : [])),
      ...GLOSSARY.flatMap((g) => g.terms.flatMap((t) => (t.where ? [t.where.href] : []))),
      ...WALKTHROUGHS.flatMap((w) => w.steps.flatMap((s) => (s.link ? [s.link.href] : []))),
    ];
    for (const href of links) expect(resolves(href), href).toBe(true);
  });

  it('glossary ids are unique', () => {
    const ids = GLOSSARY.flatMap((g) => g.terms.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The worked examples, recomputed from the lessons' formulas.
  it('lending, vault, LP and Merkl examples', () => {
    expect(6 * 0.8 * 0.9).toBeCloseTo(4.32, 6);
    expect((0.6 * 5 + 0.4 * 8) * 0.9).toBeCloseTo(5.58, 6);
    expect((1000 / 1.05) * 1.06415).toBeCloseTo(1013.48, 1);
    expect((1e6 * 0.0005 * 365) / 2e6).toBeCloseTo(0.09125, 6);
    for (const r of [2, 0.5]) expect((2 * Math.sqrt(r)) / (1 + r) - 1).toBeCloseTo(-0.0572, 3);
    expect(0.5 ** 2 / 8).toBeCloseTo(0.03125, 6);
    expect(1 / (1 - (1 / 1.1 / 1.1) ** 0.25)).toBeCloseTo(21.5, 0);
    expect((1000 * 365) / 5e6).toBeCloseTo(0.073, 6);
    expect((1000 * 365) / 5.1e6).toBeCloseTo(0.0716, 4);
  });

  it('PT and YT examples (10 % implied, 90 days)', () => {
    const pt = 1 / 1.1 ** years(90);
    expect(pt).toBeCloseTo(0.9768, 4);
    expect(1000 / pt - 1000).toBeCloseTo(23.78, 2);
    const notional = 1000 / (1 - pt);
    expect(notional).toBeCloseTo(43053, -1);
    const income = (base: number) => notional * ((1 + base) ** years(90) - 1) * 0.95;
    expect(income(0.12) - 1000).toBeCloseTo(159, 0);
    expect(income(0.08) - 1000).toBeCloseTo(-216, 0);
    expect(income(0.1029)).toBeCloseTo(1000, -1);
  });

  it('PT loop example (3×, 12 % PT, 7 % borrow, 90 days, LLTV 91.5 %)', () => {
    const [E, L, y, r, t] = [1000, 3, 0.12, 0.07, years(90)];
    const G = E * L;
    const B = E * (L - 1);
    const gain = G * ((1 + y) ** t - 1);
    const cost = B * ((1 + r) ** t - 1);
    expect(gain).toBeCloseTo(85.01, 2);
    expect(cost).toBeCloseTo(33.65, 2);
    expect(gain - cost).toBeCloseTo(51.37, 1);
    expect(E * ((1 + y) ** t - 1)).toBeCloseTo(28.34, 2);
    expect(L * 12 - (L - 1) * 7).toBe(22);
    expect((0.915 * G) / B).toBeCloseTo(1.37, 2);
    expect(1 - B / (G * 0.915)).toBeCloseTo(0.271, 3);
  });
});
