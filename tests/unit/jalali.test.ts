import { describe, expect, it } from 'vitest';
import { isoToJalaliInput, jalaliMonthLength, parseJalaliInput, toGregorian, toJalali } from '../../src/lib/utils/jalali';

/** Intl's own Persian calendar, as the reference. */
const intl = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
function reference(t: number) {
  const parts = Object.fromEntries(intl.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { jy: Number.parseInt(parts.year, 10), jm: Number(parts.month), jd: Number(parts.day) };
}

describe('Jalali calendar', () => {
  it('matches Intl for every day from 1370 to 1430', () => {
    const start = Date.UTC(1991, 2, 21);
    const end = Date.UTC(2051, 2, 21);
    for (let t = start; t < end; t += 86_400_000) {
      const d = new Date(t);
      const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      expect(j).toEqual(reference(t));
      expect(toGregorian(j.jy, j.jm, j.jd)).toEqual({ gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() });
    }
  });

  it('knows the length of Esfand', () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
  });
});

describe('typing a Jalali date', () => {
  it('shows a stored date the way it is typed', () => {
    expect(isoToJalaliInput('2026-10-13')).toBe('۱۴۰۵/۰۷/۲۱');
    expect(isoToJalaliInput('2026-10-13T00:00:00.000Z')).toBe('۱۴۰۵/۰۷/۲۱');
    expect(isoToJalaliInput('')).toBe('');
  });

  it.each<[string, string]>([
    ['۱۴۰۵/۰۷/۲۱', '2026-10-13'],
    ['۱۴۰۵/۷/۲۱', '2026-10-13'],
    ['1405-07-21', '2026-10-13'],
    ['١٤٠٥.٠٧.٢١', '2026-10-13'],
    [' ۱۴۰۵ / ۷ / ۲۱ ', '2026-10-13'],
    ['۱۴۰۳/۱۲/۳۰', '2025-03-20'],
    ['2026/10/13', '2026-10-13'],
  ])('%s → %s', (input, iso) => {
    expect(parseJalaliInput(input)).toBe(iso);
  });

  it.each(['', '۱۴۰۵', '۱۴۰۵/۱۳/۱', '۱۴۰۴/۱۲/۳۰', '۱۴۰۵/۰۷/۳۱', '۲۱/۰۷/۱۴۰۵', '2026/02/30', 'abc'])('rejects %j', (input) => {
    expect(parseJalaliInput(input)).toBeNull();
  });
});
