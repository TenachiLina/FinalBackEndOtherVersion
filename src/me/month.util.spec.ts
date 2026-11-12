import { BadRequestException } from '@nestjs/common';
import { dayOf, parseMonth } from './month.util';

describe('parseMonth', () => {
  it('gives the UTC bounds and the first and last day', () => {
    const r = parseMonth('2026', '2');
    expect(r).toMatchObject({ year: 2026, month: 2 });
    expect(r.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.firstDay).toBe('2026-02-01');
    expect(r.lastDay).toBe('2026-02-28');
  });

  it('handles December and leap years', () => {
    expect(parseMonth(2024, 2).lastDay).toBe('2024-02-29');
    const dec = parseMonth('2026', '12');
    expect(dec.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(dec.lastDay).toBe('2026-12-31');
  });

  it.each([
    [undefined, undefined],
    ['2026', undefined],
    [undefined, '5'],
    ['2026', '0'],
    ['2026', '13'],
    ['26', '5'],
    ['1999', '5'],
    ['2101', '5'],
    ['abcd', '5'],
    ['2026', '5.5'],
    [['2026', '2027'], '5'],
  ])('refuses year=%p month=%p', (y, m) => {
    expect(() => parseMonth(y, m)).toThrow(BadRequestException);
  });
});

describe('dayOf', () => {
  it('formats dates and date strings as YYYY-MM-DD', () => {
    expect(dayOf(new Date('2026-11-05T00:00:00Z'))).toBe('2026-11-05');
    expect(dayOf('2026-11-05')).toBe('2026-11-05');
  });
  it('returns null for missing or invalid values', () => {
    expect(dayOf(null)).toBeNull();
    expect(dayOf(undefined)).toBeNull();
    expect(dayOf('')).toBeNull();
    expect(dayOf('not a date')).toBeNull();
  });
});
