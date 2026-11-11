import {
  groupPunchesIntoSessions,
  localDate,
  plannedShiftsByEmployee,
  punchInstant,
  sessionMinutes,
  shiftBounds,
  type PlannedShift,
} from './punch-sessions';

// Times without a zone are Algerian time (UTC+1)
const p = (timestamp: string) => ({ timestamp });
const LATER = Date.parse('2026-10-30T00:00:00Z');
const day: PlannedShift = {
  workDate: '2026-10-20',
  start: '08:00',
  end: '17:00',
};
const evening: PlannedShift = {
  workDate: '2026-10-20',
  start: '16:00',
  end: '02:00',
};

describe('punchInstant', () => {
  it('reads a time without a zone as Algerian time, with or without seconds', () => {
    expect(punchInstant('2026-10-20T08:00')).toBe(
      Date.parse('2026-10-20T07:00:00Z'),
    );
    expect(punchInstant('2026-10-20T08:00:30')).toBe(
      Date.parse('2026-10-20T07:00:30Z'),
    );
    expect(punchInstant('2026-10-20T08:00', 0)).toBe(
      Date.parse('2026-10-20T08:00:00Z'),
    );
  });

  it('keeps a time that has a zone', () => {
    expect(punchInstant('2026-10-20T08:00:00Z')).toBe(
      Date.parse('2026-10-20T08:00:00Z'),
    );
    expect(punchInstant('2026-10-20T08:00:00+02:00')).toBe(
      Date.parse('2026-10-20T06:00:00Z'),
    );
  });

  it('gives NaN for a missing or unreadable time', () => {
    expect(punchInstant('')).toBeNaN();
    expect(punchInstant('not a time')).toBeNaN();
  });
});

describe('localDate and shiftBounds', () => {
  it('gives the Algerian date of an instant', () => {
    expect(localDate(Date.parse('2026-10-20T23:30:00Z'))).toBe('2026-10-21');
  });

  it('puts an end at or before the start on the next day', () => {
    expect(shiftBounds(evening)).toEqual({
      start: Date.parse('2026-10-20T15:00:00Z'),
      end: Date.parse('2026-10-21T01:00:00Z'),
    });
  });
});

describe('groupPunchesIntoSessions', () => {
  it('pairs the punches of a shift as clock-in and clock-out, breaks included', () => {
    const punches = [
      '2026-10-20T08:00',
      '2026-10-20T12:00',
      '2026-10-20T13:00',
      '2026-10-20T17:00',
    ].map(p);
    const [s] = groupPunchesIntoSessions(punches, [day], { now: LATER });
    expect(s).toMatchObject({
      workDate: '2026-10-20',
      shift: day,
      clockIn: punches[0],
      clockOut: punches[3],
      missing: null,
      open: false,
      extra: [],
    });
    expect(s.periods).toHaveLength(2);
    expect(sessionMinutes(s)).toBe(8 * 60);
  });

  it('leaves out a double scan as an extra punch', () => {
    const punches = [
      '2026-10-20T08:00',
      '2026-10-20T08:02',
      '2026-10-20T17:00',
    ].map(p);
    const [s] = groupPunchesIntoSessions(punches, [day], { now: LATER });
    expect(s).toMatchObject({
      clockIn: punches[0],
      clockOut: punches[2],
      extra: [punches[1]],
    });
  });

  it('with an odd number of punches near the end, the last is the clock-out and the one before is extra', () => {
    const punches = [
      '2026-10-20T16:18',
      '2026-10-20T17:39',
      '2026-10-21T00:11',
    ].map(p);
    const [s] = groupPunchesIntoSessions(punches, [evening], { now: LATER });
    expect(s).toMatchObject({
      clockIn: punches[0],
      clockOut: punches[2],
      missing: null,
      extra: [punches[1]],
    });
  });

  it('with an odd number of punches far from the end, the clock-out is missing', () => {
    const punches = [
      '2026-10-20T08:00',
      '2026-10-20T12:00',
      '2026-10-20T13:00',
    ].map(p);
    const [s] = groupPunchesIntoSessions(punches, [day], { now: LATER });
    expect(s).toMatchObject({ clockOut: null, missing: 'clockOut', extra: [] });
  });

  it('reads a lone punch after the shift, closer to its end, as a clock-out', () => {
    const [s] = groupPunchesIntoSessions([p('2026-10-21T00:34')], [evening], {
      now: LATER,
    });
    expect(s).toMatchObject({ clockIn: null, missing: 'clockIn' });
  });

  it('keeps a lone punch during the shift as a clock-in, still open', () => {
    const now = Date.parse('2026-10-20T10:00:00Z');
    const [s] = groupPunchesIntoSessions([p('2026-10-20T08:05')], [day], {
      now,
    });
    expect(s).toMatchObject({ clockOut: null, missing: null, open: true });
  });

  it('counts the same shift planned twice once, and leaves out a shift without times', () => {
    const sessions = groupPunchesIntoSessions(
      [p('2026-10-20T08:00'), p('2026-10-20T17:00')],
      [day, { ...day }, { workDate: '2026-10-20', start: '', end: '' }],
      { now: LATER },
    );
    expect(sessions).toHaveLength(1);
  });

  it('shows a punch with an unreadable time on its own, last', () => {
    const bad = p('2026-10-20 garbage');
    const sessions = groupPunchesIntoSessions(
      [bad, p('2026-10-20T08:00')],
      [day],
      { now: LATER },
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toMatchObject({
      workDate: '2026-10-20',
      shift: null,
      clockIn: bad,
      missing: null,
      open: false,
    });
  });

  it('groups unplanned punches, starting a new session after a long gap', () => {
    const punches = [
      '2026-10-20T09:00',
      '2026-10-20T09:01', // double scan
      '2026-10-20T15:00',
      '2026-10-21T10:00', // 19 h later: a new session
    ].map(p);
    const sessions = groupPunchesIntoSessions(punches, [], { now: LATER });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      workDate: '2026-10-20',
      shift: null,
      clockIn: punches[0],
      clockOut: punches[2],
      extra: [punches[1]],
    });
    expect(sessions[1]).toMatchObject({
      workDate: '2026-10-21',
      missing: 'clockOut',
    });
  });

  it('starts a new unplanned session past the longest span, and keeps a recent one open', () => {
    const punches = Array.from({ length: 5 }, (_, i) =>
      p(`2026-10-20T${String(i * 5).padStart(2, '0')}:00`),
    ); // 00:00, 05:00 … 20:00: no gap over 14 h, but over 16 h in all
    const now = Date.parse('2026-10-20T20:00:00Z');
    const sessions = groupPunchesIntoSessions(punches, [], { now });
    expect(sessions.map((s) => s.punches.length)).toEqual([4, 1]);
    expect(sessions[1]).toMatchObject({ open: true, missing: null });
  });

  it('gives a punch between two shifts to the closer one', () => {
    const morning: PlannedShift = {
      workDate: '2026-10-20',
      start: '06:00',
      end: '10:00',
    };
    const afternoon: PlannedShift = {
      workDate: '2026-10-20',
      start: '14:00',
      end: '18:00',
    };
    const sessions = groupPunchesIntoSessions(
      [
        p('2026-10-20T06:00'),
        p('2026-10-20T10:30'),
        p('2026-10-20T13:00'),
        p('2026-10-20T18:00'),
      ],
      [morning, afternoon],
      { now: LATER },
    );
    expect(
      sessions.map((s) => s.punches.map((x) => x.timestamp.slice(11))),
    ).toEqual([
      ['06:00', '10:30'],
      ['13:00', '18:00'],
    ]);
  });
});

describe('sessionMinutes', () => {
  it('counts complete periods only, and never a negative one', () => {
    expect(
      sessionMinutes({
        periods: [
          { clockIn: p('2026-10-20T08:00'), clockOut: p('2026-10-20T09:30') },
          { clockIn: p('2026-10-20T10:00'), clockOut: null },
          { clockIn: null, clockOut: p('2026-10-20T12:00') },
          { clockIn: p('2026-10-20T15:00'), clockOut: p('2026-10-20T14:00') },
        ],
      }),
    ).toBe(90);
  });
});

describe('plannedShiftsByEmployee', () => {
  const shift = { _id: 's1', startTime: '08:00', endTime: '17:00' };

  it('lists the planned shifts by employee number', () => {
    const map = plannedShiftsByEmployee([
      {
        planDate: '2026-10-20T00:00:00.000Z',
        empId: { empNumber: 15 },
        shiftId: shift,
      },
      {
        planDate: new Date('2026-10-21T00:00:00.000Z'),
        empId: { empNumber: ' 15 ' },
        shiftId: { startTime: '09:00', endTime: '12:00' },
      },
    ]);
    expect(map.get('15')).toEqual([
      { workDate: '2026-10-20', start: '08:00', end: '17:00', shiftId: 's1' },
      {
        workDate: '2026-10-21',
        start: '09:00',
        end: '12:00',
        shiftId: undefined,
      },
    ]);
  });

  it('uses dateOf over the planning date', () => {
    const map = plannedShiftsByEmployee(
      [{ planDate: 'bad', empId: { empNumber: 1 }, shiftId: shift }],
      () => '2026-10-25',
    );
    expect(map.get('1')?.[0].workDate).toBe('2026-10-25');
  });

  it('leaves out records without an employee number, shift times or a readable date', () => {
    const map = plannedShiftsByEmployee([
      { planDate: '2026-10-20', empId: 'e1', shiftId: shift },
      {
        planDate: '2026-10-20',
        empId: { empNumber: null as unknown as number },
        shiftId: shift,
      },
      { planDate: '2026-10-20', empId: { empNumber: 2 }, shiftId: 's1' },
      {
        planDate: '2026-10-20',
        empId: { empNumber: 3 },
        shiftId: { startTime: '08:00' },
      },
      { planDate: null, empId: { empNumber: 4 }, shiftId: shift },
      { planDate: new Date('nope'), empId: { empNumber: 5 }, shiftId: shift },
      { planDate: '20/10/2026', empId: { empNumber: 6 }, shiftId: shift },
    ]);
    expect(map.size).toBe(0);
    expect(plannedShiftsByEmployee(null).size).toBe(0);
  });
});
