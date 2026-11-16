import { countToday, todayBoard } from './dashboard.util';

const at = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const planned = [
  { empNumber: 1, name: 'Amine B', start: '08:00', end: '16:00' },
  { empNumber: 2, name: 'Sara H', start: '08:00', end: '16:00' },
  { empNumber: 3, name: 'Karim M', start: '14:00', end: '22:00' },
];

describe('todayBoard', () => {
  it('gives each person one status', () => {
    const board = todayBoard(
      [
        ...planned,
        { empNumber: 4, name: 'Lina K', start: '08:00', end: '12:00' },
      ],
      [
        { empNumber: 1, name: 'Amine B', clockIn: '08:00' },
        { empNumber: 4, name: 'Lina K', clockIn: '08:00', clockOut: '12:05' },
        { empNumber: 5, name: 'Nadia O', absent: true },
      ],
      at('13:00'),
    );
    expect(board.map((p) => [p.name, p.status])).toEqual([
      ['Sara H', 'missing'],
      ['Nadia O', 'absent'],
      ['Amine B', 'present'],
      ['Karim M', 'expected'],
      ['Lina K', 'left'],
    ]);
  });

  it('shows the shift, the clock times and the lateness', () => {
    const [amine] = todayBoard(
      [planned[0]],
      [{ empNumber: 1, name: 'Amine B', clockIn: '08:20', lateMinutes: '20' }],
      at('09:00'),
    );
    expect(amine).toEqual({
      empNumber: 1,
      name: 'Amine B',
      status: 'present',
      shift: '08:00 – 16:00',
      clockIn: '08:20',
      clockOut: null,
      late: true,
      lateMinutes: 20,
    });
  });

  it('someone is expected until half an hour into the shift, then missing', () => {
    const status = (time: string) =>
      todayBoard([planned[0]], [], at(time))[0].status;
    expect(status('07:00')).toBe('expected');
    expect(status('08:29')).toBe('expected');
    expect(status('08:30')).toBe('missing');
  });

  it('someone who came without being planned is present, with no shift', () => {
    const board = todayBoard(
      [],
      [{ empNumber: 9, name: 'Extra E', clockIn: '10:00' }],
      at('11:00'),
    );
    expect(board).toEqual([
      expect.objectContaining({
        name: 'Extra E',
        status: 'present',
        shift: null,
      }),
    ]);
  });

  it('absent wins over planned and missing', () => {
    const [sara] = todayBoard(
      [planned[1]],
      [{ empNumber: 2, name: 'Sara H', absent: true }],
      at('12:00'),
    );
    expect(sara.status).toBe('absent');
    expect(sara.shift).toBe('08:00 – 16:00');
  });

  it('keeps the earliest planned shift of someone planned twice', () => {
    const [amine] = todayBoard(
      [
        { empNumber: 1, name: 'Amine B', start: '14:00', end: '18:00' },
        { empNumber: 1, name: 'Amine B', start: '08:00', end: '12:00' },
      ],
      [],
      at('09:00'),
    );
    expect(amine).toMatchObject({ shift: '08:00 – 12:00', status: 'missing' });
  });

  it('two records in a day: first arrival, present while one is still open', () => {
    const [amine] = todayBoard(
      [],
      [
        { empNumber: 1, name: 'Amine B', clockIn: '08:00', clockOut: '12:00' },
        { empNumber: 1, name: 'Amine B', clockIn: '14:00', lateMinutes: 5 },
      ],
      at('15:00'),
    );
    expect(amine).toMatchObject({
      status: 'present',
      clockIn: '08:00',
      clockOut: null,
      late: true,
      lateMinutes: 5,
    });
  });

  it('two finished records: left, with the last departure', () => {
    const [amine] = todayBoard(
      [],
      [
        { empNumber: 1, name: 'Amine B', clockIn: '14:00', clockOut: '18:00' },
        { empNumber: 1, name: 'Amine B', clockIn: '08:00', clockOut: '12:00' },
      ],
      at('19:00'),
    );
    expect(amine).toMatchObject({ status: 'left', clockIn: '08:00' });
  });

  it('ignores an empty record of someone not planned, and a shift without a start', () => {
    expect(
      todayBoard(
        [{ empNumber: 1, name: 'Amine B', start: '', end: '' }],
        [{ empNumber: 2, name: 'Sara H', clockIn: null }],
        at('12:00'),
      ),
    ).toEqual([]);
  });

  it('an empty record leaves a planned person as they were', () => {
    const [amine] = todayBoard(
      [planned[0]],
      [{ empNumber: 1, name: 'Amine B', clockIn: null }],
      at('12:00'),
    );
    expect(amine.status).toBe('missing');
  });

  it('sorts people of the same status by name', () => {
    const board = todayBoard(
      [
        { empNumber: 2, name: 'Zoe', start: '08:00', end: '16:00' },
        { empNumber: 1, name: 'Ali', start: '08:00', end: '16:00' },
      ],
      [],
      at('07:00'),
    );
    expect(board.map((p) => p.name)).toEqual(['Ali', 'Zoe']);
  });
});

describe('countToday', () => {
  it('counts each status, and the late arrivals', () => {
    const board = todayBoard(
      planned,
      [
        { empNumber: 1, name: 'Amine B', clockIn: '08:20', lateMinutes: 20 },
        { empNumber: 5, name: 'Nadia O', absent: true },
      ],
      at('13:00'),
    );
    expect(countToday(board, 3)).toEqual({
      planned: 3,
      present: 1,
      left: 0,
      late: 1,
      absent: 1,
      missing: 1,
      expected: 1,
    });
  });

  it('is all zeros on a day with nothing', () => {
    expect(countToday([], 0)).toEqual({
      planned: 0,
      present: 0,
      left: 0,
      late: 0,
      absent: 0,
      missing: 0,
      expected: 0,
    });
  });
});
