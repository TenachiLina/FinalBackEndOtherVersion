import {
  DEFAULT_PAYROLL_SETTINGS,
  exactPayLine,
  hourlyRate,
  payLine,
  payrollSettings,
  payslipAmounts,
  payTotals,
  sumWork,
  timeToDecimalHours,
  toNumber,
} from './payroll.calc';

const S = DEFAULT_PAYROLL_SETTINGS;

describe('payrollSettings', () => {
  it('uses the defaults when the company has no settings', () => {
    expect(payrollSettings(undefined)).toEqual(S);
    expect(payrollSettings(null)).toEqual(S);
    expect(payrollSettings({})).toEqual(S);
  });

  it("takes the company's values", () => {
    expect(
      payrollSettings({
        hoursPerDay: 7,
        workingDaysPerMonth: 22,
        weeklyAdvanceRatio: 0.3,
        currency: 'EUR',
      }),
    ).toEqual({
      hoursPerDay: 7,
      workingDaysPerMonth: 22,
      weeklyAdvanceRatio: 0.3,
      currency: 'EUR',
    });
  });

  it('refuses 0 or negative divisors, which would give an infinite rate', () => {
    const s = payrollSettings({ hoursPerDay: 0, workingDaysPerMonth: -3 });
    expect(s.hoursPerDay).toBe(8);
    expect(s.workingDaysPerMonth).toBe(26);
  });

  it('keeps a weekly advance ratio of 0 (no weekly advances)', () => {
    expect(payrollSettings({ weeklyAdvanceRatio: 0 }).weeklyAdvanceRatio).toBe(
      0,
    );
  });

  it('ignores values that are not numbers', () => {
    const s = payrollSettings({
      hoursPerDay: '9' as any,
      weeklyAdvanceRatio: NaN,
    });
    expect(s.hoursPerDay).toBe(8);
    expect(s.weeklyAdvanceRatio).toBe(0.5);
  });

  it('never changes the defaults themselves', () => {
    payrollSettings({ hoursPerDay: 5 });
    expect(DEFAULT_PAYROLL_SETTINGS.hoursPerDay).toBe(8);
  });
});

describe('timeToDecimalHours', () => {
  it.each([
    ['08:00', 8],
    ['07:30', 7.5],
    ['01:30:00', 1.5],
    ['00:00:36', 0.01],
    ['2.5', 2.5],
    [3, 3],
    ['', 0],
    ['00:00', 0],
    ['00:00:00', 0],
    [null, 0],
    [undefined, 0],
    ['abc', 0],
    ['aa:bb', 0],
    ['1:2:3:4', 0],
    ['-01:30', -1.5],
    ['-00:30', -0.5],
    ['--01:30', 0],
    [NaN, 0],
  ])('%p → %p', (input, expected) => {
    expect(timeToDecimalHours(input)).toBeCloseTo(expected, 10);
  });
});

describe('toNumber', () => {
  it('turns anything that is not a number into 0', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber('n/a')).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe('hourlyRate', () => {
  it('is the base salary / 8 / 26 by default', () => {
    expect(hourlyRate(52000, S)).toBe(250);
  });

  it("follows the company's hours and days", () => {
    expect(
      hourlyRate(44000, { ...S, hoursPerDay: 10, workingDaysPerMonth: 22 }),
    ).toBe(200);
  });

  it('is 0 without a salary', () => {
    expect(hourlyRate(undefined, S)).toBe(0);
  });
});

describe('sumWork', () => {
  it('adds up hours, money and attendance', () => {
    expect(
      sumWork([
        {
          work_hours: '08:00',
          late_minutes: '15',
          overtime_minutes: '30',
          penalty: 200,
          consomation: 100,
        },
        { work_hours: '04:30', late_minutes: '0', consommation: 50 },
        { work_hours: '00:00', absent: true },
      ]),
    ).toEqual({
      hours: 12.5,
      penalties: 200,
      consommation: 150,
      absences: 1,
      lateMinutes: 15,
      lateDays: 1,
      overtimeMinutes: 30,
      records: 3,
    });
  });

  it('is all zeros for no records', () => {
    expect(sumWork([])).toMatchObject({ hours: 0, records: 0, absences: 0 });
  });
});

describe('payLine', () => {
  const rows = [
    { work_hours: '08:00', penalty: 500, consomation: 300 },
    { work_hours: '08:00', late_minutes: '10' },
  ];

  it('gross = hours × hourly rate', () => {
    const line = payLine({ baseSalary: 52000, rows, advances: 0, bonuses: 0 }, S);
    expect(line.hourlyRate).toBe(250);
    expect(line.hours).toBe(16);
    expect(line.gross).toBe(4000);
  });

  it('net = gross − penalties − consumption − advances + bonuses', () => {
    const line = payLine(
      { baseSalary: 52000, rows, advances: 1000, bonuses: 700 },
      S,
    );
    expect(line.net).toBe(4000 - 500 - 300 - 1000 + 700);
  });

  it('weekly advance offer = (gross − consumption) × ratio, penalties not deducted', () => {
    const line = payLine({ baseSalary: 52000, rows, advances: 0, bonuses: 0 }, S);
    expect(line.advanceOffer).toBe((4000 - 300) * 0.5);
    const none = payLine(
      { baseSalary: 52000, rows, advances: 0, bonuses: 0 },
      { ...S, weeklyAdvanceRatio: 0 },
    );
    expect(none.advanceOffer).toBe(0);
  });

  it('rounds amounts to two decimals', () => {
    const line = payLine(
      {
        baseSalary: 45000,
        rows: [{ work_hours: '07:20' }],
        advances: 0,
        bonuses: 0,
      },
      S,
    );
    // 45000 / 8 / 26 = 216.346…, × 7.333… h = 1586.538…
    expect(line.hourlyRate).toBe(216.35);
    expect(line.hours).toBe(7.33);
    expect(line.gross).toBe(1586.54);
  });

  it('can go negative when deductions exceed the pay', () => {
    const line = payLine(
      { baseSalary: 52000, rows: [], advances: 2000, bonuses: 0 },
      S,
    );
    expect(line.gross).toBe(0);
    expect(line.net).toBe(-2000);
  });
});

describe('payTotals', () => {
  it('adds the lines up', () => {
    const a = exactPayLine(
      {
        baseSalary: 52000,
        rows: [{ work_hours: '08:00', absent: false, late_minutes: '5' }],
        advances: 500,
        bonuses: 0,
      },
      S,
    );
    const b = exactPayLine(
      {
        baseSalary: 26000,
        rows: [
          { work_hours: '08:00', penalty: 100, overtime_minutes: '20' },
          { work_hours: '00:00', absent: true },
        ],
        advances: 0,
        bonuses: 200,
      },
      S,
    );
    const idle = exactPayLine(
      { baseSalary: 26000, rows: [], advances: 0, bonuses: 0 },
      S,
    );
    expect(payTotals([a, b, idle])).toEqual({
      hours: 16,
      gross: 3000,
      penalties: 100,
      consommation: 0,
      advances: 500,
      bonuses: 200,
      net: 1500 + 1100,
      absences: 1,
      lateMinutes: 5,
      lateDays: 1,
      overtimeMinutes: 20,
      records: 3,
      activeEmployees: 2,
      employees: 3,
    });
  });

  it('rounds each total once, not once per employee', () => {
    // 3 employees at 216.346… an hour, one hour each: 649.038…, not 3 × 216.35
    const lines = [1, 2, 3].map(() =>
      exactPayLine(
        {
          baseSalary: 45000,
          rows: [{ work_hours: '01:00' }],
          advances: 0,
          bonuses: 0,
        },
        S,
      ),
    );
    expect(payTotals(lines).gross).toBe(649.04);
  });

  it('is all zeros for nobody', () => {
    expect(payTotals([])).toMatchObject({ gross: 0, net: 0, employees: 0 });
  });
});

describe('payslipAmounts', () => {
  it('uses the declared salary when it is set', () => {
    expect(payslipAmounts({ baseSalary: 45000, declaredSalary: 30000 })).toEqual(
      {
        days: 30,
        baseSalary: 30000,
        postSalary: 30000,
        socialSecurity: 2700,
        net: 27300,
      },
    );
  });

  it('falls back to the base salary', () => {
    expect(payslipAmounts({ baseSalary: 45000 })).toMatchObject({
      baseSalary: 45000,
      socialSecurity: 4050,
      net: 40950,
    });
    expect(
      payslipAmounts({ baseSalary: 45000, declaredSalary: null }).baseSalary,
    ).toBe(45000);
  });

  it('a declared salary of 0 is a real value', () => {
    expect(payslipAmounts({ baseSalary: 45000, declaredSalary: 0 }).net).toBe(0);
  });

  it('rounds the social security to two decimals', () => {
    expect(payslipAmounts({ baseSalary: 33333.33 })).toMatchObject({
      postSalary: 33333.33,
      socialSecurity: 3000,
      net: 30333.33,
    });
  });
});
