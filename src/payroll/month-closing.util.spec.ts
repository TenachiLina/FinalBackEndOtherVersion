import {
  autoCloseAt,
  closeDelayDays,
  isAutoCloseDue,
  isMonth,
  isOver,
  monthEnd,
  monthOf,
  monthsOfYear,
  nextMonth,
  offsetMinutes,
} from './month-closing.util';

describe('isMonth', () => {
  it.each(['2026-01', '2026-12', '1999-07'])('accepts %s', (m) => {
    expect(isMonth(m)).toBe(true);
  });

  it.each([
    '2026-13',
    '2026-00',
    '2026-1',
    '26-01',
    '2026/01',
    '',
    null,
    202601,
  ])('refuses %p', (m) => {
    expect(isMonth(m)).toBe(false);
  });
});

describe('offsetMinutes', () => {
  it.each([
    ['+01:00', 60],
    ['-05:30', -330],
    ['+00:00', 0],
    ['+14:00', 840],
    ['', 0],
    [undefined, 0],
    ['1:00', 0],
    ['UTC+1', 0],
  ])('%p → %p', (offset, minutes) => {
    expect(offsetMinutes(offset)).toBe(minutes);
  });
});

describe('monthOf', () => {
  it('reads a date stored at midnight UTC of the day', () => {
    expect(monthOf(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10');
    expect(monthOf(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11');
  });

  it('reads "YYYY-MM-DD" text and ISO text', () => {
    expect(monthOf('2026-10-05')).toBe('2026-10');
    expect(monthOf('2026-10-05T00:00:00.000Z')).toBe('2026-10');
    expect(monthOf('2026-10')).toBe('2026-10');
  });

  it('reads a timestamp', () => {
    expect(monthOf(Date.UTC(2026, 0, 15))).toBe('2026-01');
  });

  it.each([null, undefined, '', 'yesterday', '2026-13-01', new Date('x')])(
    'gives null for %p',
    (value) => {
      expect(monthOf(value)).toBeNull();
    },
  );
});

describe('nextMonth', () => {
  it('goes to the next month, and to January after December', () => {
    expect(nextMonth('2026-01')).toBe('2026-02');
    expect(nextMonth('2026-09')).toBe('2026-10');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});

describe('monthEnd and isOver', () => {
  it('is midnight of the 1st of the next month in the company time zone', () => {
    // Algeria (UTC+1): November starts at 23:00 UTC on 31 October
    expect(monthEnd('2026-10', '+01:00').toISOString()).toBe(
      '2026-10-31T23:00:00.000Z',
    );
    expect(monthEnd('2026-10', '+00:00').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(monthEnd('2026-12', '-05:00').toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
  });

  it('a month is over from that moment on', () => {
    expect(isOver('2026-10', '+01:00', new Date('2026-10-31T22:59:59Z'))).toBe(
      false,
    );
    expect(isOver('2026-10', '+01:00', new Date('2026-10-31T23:00:00Z'))).toBe(
      true,
    );
  });
});

describe('closeDelayDays', () => {
  it.each([
    [0, 0],
    [10, 10],
    ['7', 7],
    [365, 365],
  ])('%p → %p days', (value, days) => {
    expect(closeDelayDays(value)).toBe(days);
  });

  it.each([null, undefined, '', -1, 366, 2.5, 'soon', NaN])(
    '%p means "never automatically"',
    (value) => {
      expect(closeDelayDays(value)).toBeNull();
    },
  );
});

describe('autoCloseAt and isAutoCloseDue', () => {
  it('closes N days after the end of the month', () => {
    expect(autoCloseAt('2026-10', 10, '+01:00')!.toISOString()).toBe(
      '2026-11-10T23:00:00.000Z',
    );
    expect(autoCloseAt('2026-10', 0, '+01:00')!.toISOString()).toBe(
      '2026-10-31T23:00:00.000Z',
    );
  });

  it('never closes by itself without a delay', () => {
    expect(autoCloseAt('2026-10', null, '+01:00')).toBeNull();
    expect(
      isAutoCloseDue('2026-10', undefined, '+01:00', new Date('2030-01-01')),
    ).toBe(false);
  });

  it('is due from the closing moment on', () => {
    const before = new Date('2026-11-10T22:59:59Z');
    const at = new Date('2026-11-10T23:00:00Z');
    expect(isAutoCloseDue('2026-10', 10, '+01:00', before)).toBe(false);
    expect(isAutoCloseDue('2026-10', 10, '+01:00', at)).toBe(true);
  });

  it('the current month is never due, even with a delay of 0', () => {
    expect(
      isAutoCloseDue('2026-11', 0, '+01:00', new Date('2026-11-14T10:00:00Z')),
    ).toBe(false);
  });
});

describe('monthsOfYear', () => {
  it('lists the 12 months', () => {
    const months = monthsOfYear(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01');
    expect(months[11]).toBe('2026-12');
  });
});
