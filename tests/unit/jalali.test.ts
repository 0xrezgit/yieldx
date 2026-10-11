import { describe, expect, it } from 'vitest';
import { isoToJalali, JALALI_MONTHS, jalaliMonthLength, jalaliToIso, toGregorian, toJalali } from '../../src/lib/utils/jalali';

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

describe('a date entered as day, month and year', () => {
  it('splits a stored date into its Jalali day, month and year', () => {
    expect(isoToJalali('2026-10-13')).toEqual({ jy: 1405, jm: 7, jd: 21 });
    expect(isoToJalali('2026-10-13T00:00:00.000Z')).toEqual({ jy: 1405, jm: 7, jd: 21 });
    expect(isoToJalali('')).toBeNull();
  });

  it('turns a real Jalali day into the stored Gregorian date', () => {
    expect(jalaliToIso({ jy: 1405, jm: 7, jd: 21 })).toBe('2026-10-13');
    expect(jalaliToIso({ jy: 1403, jm: 12, jd: 30 })).toBe('2025-03-20');
  });

  it.each<[number, number, number]>([
    [1404, 12, 30],
    [1405, 7, 31],
    [1405, 13, 1],
    [1405, 0, 1],
    [1405, 1, 0],
    [999, 1, 1],
    [1405, 1.5, 1],
  ])('rejects %i / %i / %i', (jy, jm, jd) => {
    expect(jalaliToIso({ jy, jm, jd })).toBeNull();
  });

  it('names the months in order', () => {
    expect(JALALI_MONTHS[6]).toBe('مهر');
    expect(JALALI_MONTHS).toHaveLength(12);
  });
});
