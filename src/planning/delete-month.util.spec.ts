import {
  clockingRange,
  compareMonths,
  currentMonthInAlgiers,
  parseYearMonth,
  planningRange,
} from './delete-month.util';

const withTz = (tz: string, fn: () => void) => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = before;
  }
};

describe('parseYearMonth', () => {
  it.each([
    ['2026', '12', { year: 2026, month: 12 }],
    ['2026', '1', { year: 2026, month: 1 }],
    ['2026', '01', { year: 2026, month: 1 }],
  ])('reads %s-%s', (year, month, expected) => {
    expect(parseYearMonth(year, month)).toEqual(expected);
  });

  it.each([
    ['no year', undefined, '12'],
    ['no month', '2026', undefined],
    ['an empty month', '2026', ''],
    ['month 0', '2026', '0'],
    ['month 13', '2026', '13'],
    ['a year that is not a year', 'abc', '12'],
    ['a two-digit year', '26', '12'],
    ['numbers instead of text', 2026, 12],
    ['a list (?month=1&month=2)', '2026', ['1', '2']],
  ])('refuses %s', (_name, year, month) => {
    expect(parseYearMonth(year, month)).toBeNull();
  });
});

describe('currentMonthInAlgiers', () => {
  it('is the month of the date in the middle of a month', () => {
    expect(currentMonthInAlgiers(new Date('2026-11-12T10:00:00Z'))).toEqual({
      year: 2026,
      month: 11,
    });
  });

  it('already is the next month at 00:30 in Algiers (23:30 UTC the day before)', () => {
    expect(currentMonthInAlgiers(new Date('2026-11-30T23:30:00Z'))).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it('switches the year on 31 December at midnight in Algiers', () => {
    expect(currentMonthInAlgiers(new Date('2026-12-31T23:00:00Z'))).toEqual({
      year: 2027,
      month: 1,
    });
    expect(currentMonthInAlgiers(new Date('2026-12-31T22:59:59Z'))).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it('does not depend on the time zone of the server', () => {
    withTz('America/New_York', () => {
      expect(currentMonthInAlgiers(new Date('2026-11-30T23:30:00Z'))).toEqual({
        year: 2026,
        month: 12,
      });
    });
  });
});

describe('compareMonths', () => {
  it('orders months across years', () => {
    expect(compareMonths({ year: 2026, month: 11 }, { year: 2026, month: 11 })).toBe(0);
    expect(compareMonths({ year: 2026, month: 10 }, { year: 2026, month: 11 })).toBeLessThan(0);
    expect(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0);
    expect(compareMonths({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBeLessThan(0);
  });
});

describe('planningRange', () => {
  it('covers the month from its 1st to the 1st of the next month, in UTC', () => {
    const { start, end } = planningRange({ year: 2026, month: 12 });
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles February of a leap year', () => {
    const { end } = planningRange({ year: 2028, month: 2 });
    expect(end.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });
});

describe('clockingRange', () => {
  const inside = (d: string, r: { start: Date; end: Date }) =>
    new Date(d) >= r.start && new Date(d) < r.end;

  it('includes a punch at 00:30 in Algiers on the 1st (23:30 UTC the day before)', () => {
    withTz('UTC', () => {
      const r = clockingRange({ year: 2026, month: 12 });
      expect(inside('2026-11-30T23:30:00Z', r)).toBe(true);
    });
  });

  it("includes a worked day saved at the server's local midnight, not the next month's first day", () => {
    withTz('Africa/Algiers', () => {
      const r = clockingRange({ year: 2026, month: 12 });
      // new Date('2026-12-01T00:00:00') in Algiers
      expect(inside('2026-11-30T23:00:00Z', r)).toBe(true);
      expect(inside('2026-12-31T23:00:00Z', r)).toBe(false); // 1 January
    });
  });

  it('includes a worked day saved at UTC midnight, not the next month\'s first day', () => {
    withTz('UTC', () => {
      const r = clockingRange({ year: 2026, month: 12 });
      expect(inside('2026-12-01T00:00:00Z', r)).toBe(true);
      expect(inside('2026-12-31T00:00:00Z', r)).toBe(true);
      expect(inside('2027-01-01T00:00:00Z', r)).toBe(false);
    });
  });

  it('leaves out a punch at 00:30 in Algiers on the 1st of the next month (server in Algiers)', () => {
    withTz('Africa/Algiers', () => {
      const r = clockingRange({ year: 2026, month: 12 });
      expect(inside('2026-12-31T23:30:00Z', r)).toBe(false);
    });
  });

  it('includes the whole last day of the month', () => {
    withTz('UTC', () => {
      const r = clockingRange({ year: 2026, month: 12 });
      expect(inside('2026-12-31T22:59:00Z', r)).toBe(true);
      expect(inside('2027-01-01T00:00:00Z', r)).toBe(false);
    });
  });

  it('works for a server behind UTC too', () => {
    withTz('America/New_York', () => {
      const r = clockingRange({ year: 2026, month: 12 });
      expect(inside('2026-12-01T00:00:00Z', r)).toBe(true);
      // local midnight of 31 December in New York
      expect(inside('2026-12-31T05:00:00Z', r)).toBe(true);
    });
  });
});
