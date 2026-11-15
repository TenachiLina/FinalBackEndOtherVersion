import {
  attendanceToday,
  fingerprint,
  localNow,
  minutesOf,
  silentDevices,
} from './notifications.util';

describe('localNow', () => {
  it("gives the company's own day and time", () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in Algeria
    expect(localNow(new Date('2026-11-14T23:30:00Z'), '+01:00')).toEqual({
      day: '2026-11-15',
      minutes: 30,
    });
    expect(localNow(new Date('2026-11-14T08:05:00Z'), '+00:00')).toEqual({
      day: '2026-11-14',
      minutes: 485,
    });
    expect(localNow(new Date('2026-11-14T02:00:00Z'), '-05:00')).toEqual({
      day: '2026-11-13',
      minutes: 21 * 60,
    });
  });

  it('counts an unreadable offset as UTC', () => {
    expect(localNow(new Date('2026-11-14T08:00:00Z'), 'Algiers').day).toBe(
      '2026-11-14',
    );
    expect(localNow(new Date('2026-11-14T08:00:00Z'), undefined).minutes).toBe(
      480,
    );
  });
});

describe('minutesOf', () => {
  it.each([
    ['08:30', 510],
    ['8:05', 485],
    ['00:00', 0],
    ['23:59:30', 1439],
  ])('%s → %i', (time, minutes) => {
    expect(minutesOf(time)).toBe(minutes);
  });

  it.each(['', null, undefined, 'noon', '25:00', '08:75'])(
    '%p is not a time',
    (time) => {
      expect(minutesOf(time)).toBeNull();
    },
  );
});

describe('attendanceToday', () => {
  const planned = [
    { empNumber: 1, name: 'Amine B', start: '08:00' },
    { empNumber: 2, name: 'Sara H', start: '08:00' },
    { empNumber: 3, name: 'Karim M', start: '14:00' },
  ];

  it('names who arrived late', () => {
    const { late } = attendanceToday(
      planned,
      [
        { empNumber: 1, name: 'Amine B', clockIn: '08:20', lateMinutes: '20' },
        { empNumber: 2, name: 'Sara H', clockIn: '08:00', lateMinutes: '0' },
      ],
      9 * 60,
    );
    expect(late).toEqual(['Amine B']);
  });

  it('names who is planned, half an hour into the shift, without a clock-in', () => {
    const at = (time: string) =>
      attendanceToday(
        planned,
        [{ empNumber: 1, name: 'Amine B', clockIn: '08:00' }],
        minutesOf(time)!,
      ).missing;
    expect(at('08:29')).toEqual([]);
    expect(at('08:30')).toEqual(['Sara H']);
    // The afternoon shift hasn't started long enough yet
    expect(at('14:29')).toEqual(['Sara H']);
    expect(at('14:30')).toEqual(['Karim M', 'Sara H']);
  });

  it('someone marked absent is absent, not missing or late', () => {
    const result = attendanceToday(
      planned,
      [{ empNumber: 2, name: 'Sara H', absent: true, lateMinutes: '45' }],
      10 * 60,
    );
    expect(result).toEqual({
      late: [],
      absent: ['Sara H'],
      missing: ['Amine B'],
    });
  });

  it('names each person once, in alphabetical order', () => {
    const result = attendanceToday(
      [
        { empNumber: 2, name: 'Sara H', start: '08:00' },
        { empNumber: 2, name: 'Sara H', start: '09:00' },
        { empNumber: 1, name: 'Amine B', start: '08:00' },
      ],
      [],
      12 * 60,
    );
    expect(result.missing).toEqual(['Amine B', 'Sara H']);
  });

  it('a record without a clock-in does not count as arrived', () => {
    const { missing } = attendanceToday(
      [planned[0]],
      [{ empNumber: 1, name: 'Amine B', clockIn: null }],
      10 * 60,
    );
    expect(missing).toEqual(['Amine B']);
  });

  it('skips a planned shift without a readable start time', () => {
    const { missing } = attendanceToday(
      [{ empNumber: 1, name: 'Amine B', start: '' }],
      [],
      23 * 60,
    );
    expect(missing).toEqual([]);
  });

  it('is quiet when there is nothing to tell', () => {
    expect(attendanceToday([], [], 600)).toEqual({
      late: [],
      absent: [],
      missing: [],
    });
  });
});

describe('silentDevices', () => {
  const now = new Date('2026-11-14T10:00:00Z');

  it('reports a machine that stopped talking more than 15 minutes ago', () => {
    expect(
      silentDevices(
        [
          {
            serial: 'A1',
            name: 'Entrance',
            lastSeenAt: '2026-11-14T09:40:00Z',
          },
          { serial: 'B2', lastSeenAt: new Date('2026-11-14T09:50:00Z') },
          { serial: 'C3', lastSeenAt: '2026-11-13T10:00:00Z' },
        ],
        now,
      ),
    ).toEqual([
      {
        serial: 'A1',
        name: 'Entrance',
        lastSeenAt: '2026-11-14T09:40:00.000Z',
      },
      { serial: 'C3', name: 'C3', lastSeenAt: '2026-11-13T10:00:00.000Z' },
    ]);
  });

  it('says nothing about a machine that never connected, or an unreadable date', () => {
    expect(
      silentDevices(
        [
          { serial: 'A1' },
          { serial: 'B2', lastSeenAt: null },
          { serial: 'C3', lastSeenAt: 'x' },
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe('fingerprint', () => {
  it('is the same for the same people, different when they change', () => {
    expect(fingerprint(['A', 'B'])).toBe(fingerprint(['A', 'B']));
    expect(fingerprint(['A', 'B'])).not.toBe(fingerprint(['A', 'C']));
    expect(fingerprint(['A', 'B'])).not.toBe(fingerprint(['A']));
    expect(fingerprint([])).toBe('0-0');
  });
});
