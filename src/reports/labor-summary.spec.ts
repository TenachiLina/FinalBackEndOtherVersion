import {
  buildLaborSummary,
  LaborSummaryInput,
  monthsCovered,
} from './labor-summary';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

function input(overrides: Partial<LaborSummaryInput> = {}): LaborSummaryInput {
  return {
    period: { start: '2026-10-01', end: '2026-10-31' },
    companyId: 'c1',
    currency: 'DA',
    employees: [
      { _id: 'e1', empNumber: 1 },
      { _id: 'e2', empNumber: 2 },
      { _id: 'e3', empNumber: 3 },
    ],
    tasks: [
      { taskId: 2, taskName: 'Bar' },
      { taskId: 1, taskName: 'Grill' },
    ],
    shifts: [
      { _id: 's1', startTime: '08:00', endTime: '16:00' },
      { _id: 's2', startTime: '18:00', endTime: '02:00' },
    ],
    planning: [],
    worktime: [],
    bonuses: [],
    advances: [],
    generatedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('buildLaborSummary', () => {
  it('describes the source and lists every task as a station', () => {
    const { metadata } = buildLaborSummary(input());
    expect(metadata).toEqual({
      source: 'clockinout',
      generatedAt: '2026-11-01T10:00:00.000Z',
      version: '3',
      period: { start: '2026-10-01', end: '2026-10-31' },
      currency: 'DA',
      employerChargeRate: 0.34,
      stations: [
        { code: '1', name: 'Grill', active: true },
        { code: '2', name: 'Bar', active: true },
      ],
    });
  });

  it('adds up planned hours, overnight slots included, and counts the people planned', () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-06'),
          },
          {
            empId: 'e2',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          {
            empId: 'e3',
            shiftId: 's2',
            taskId: 2,
            planDate: day('2026-10-05'),
          },
        ],
      }),
    );
    expect(r.periodTotals).toMatchObject([
      {
        stationCode: '1',
        stationName: 'Grill',
        headcount: 2,
        plannedHours: 24,
      },
      { stationCode: '2', stationName: 'Bar', headcount: 1, plannedHours: 8 },
    ]);
    expect(r.plannedShifts).toEqual([
      {
        date: '2026-10-05',
        stationCode: '1',
        start: '08:00',
        end: '16:00',
        plannedStaff: 2,
      },
      {
        date: '2026-10-05',
        stationCode: '2',
        start: '18:00',
        end: '02:00',
        plannedStaff: 1,
      },
      {
        date: '2026-10-06',
        stationCode: '1',
        start: '08:00',
        end: '16:00',
        plannedStaff: 1,
      },
    ]);
    expect(r.siteTotals.plannedHours).toBe(32);
  });

  it("uses an entry's own times over its shift's", () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
            customStartTime: '10:00',
            customEndTime: '14:30',
          },
        ],
      }),
    );
    expect(r.periodTotals[0].plannedHours).toBe(4.5);
    expect(r.plannedShifts[0]).toMatchObject({ start: '10:00', end: '14:30' });
  });

  it('gives worked hours to the station of the matching planning entry, split into regular and overtime', () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          {
            empId: 'e1',
            shiftId: 's2',
            taskId: 2,
            planDate: day('2026-10-05'),
          },
        ],
        worktime: [
          {
            emp_id: 1,
            shift_id: 's1',
            work_date: day('2026-10-05'),
            work_hours: '08:30',
            overtime_minutes: '30',
          },
          {
            emp_id: 1,
            shift_id: 's2',
            work_date: day('2026-10-05'),
            work_hours: '07:00',
            overtime_minutes: '0',
          },
        ],
      }),
    );
    expect(r.periodTotals).toMatchObject([
      { stationCode: '1', regularHours: 8, overtimeHours: 0.5 },
      { stationCode: '2', regularHours: 7, overtimeHours: 0 },
    ]);
    expect(r.dailyWorked).toEqual([
      {
        date: '2026-10-05',
        stationCode: '1',
        workedHours: 8.5,
        staffPresent: 1,
      },
      { date: '2026-10-05', stationCode: '2', workedHours: 7, staffPresent: 1 },
    ]);
  });

  it("matches a record without a shift to the employee's only entry that day", () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
        ],
        worktime: [
          { emp_id: 1, work_date: day('2026-10-05'), work_hours: '06:00' },
        ],
      }),
    );
    expect(r.periodTotals).toMatchObject([
      { stationCode: '1', regularHours: 6 },
    ]);
  });

  it('gives a backup the station of the entry they covered', () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 2,
            planDate: day('2026-10-05'),
            backupEmpIds: ['e2'],
          },
        ],
        worktime: [
          {
            emp_id: 2,
            shift_id: 's1',
            work_date: day('2026-10-05'),
            work_hours: '08:00',
          },
        ],
      }),
    );
    expect(r.periodTotals).toMatchObject([
      { stationCode: '2', regularHours: 8 },
    ]);
  });

  it('reports unplanned hours with no station, so the stations add up to the site', () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
        ],
        worktime: [
          {
            emp_id: 1,
            shift_id: 's1',
            work_date: day('2026-10-05'),
            work_hours: '08:00',
          },
          { emp_id: 3, work_date: day('2026-10-05'), work_hours: '04:00' },
        ],
      }),
    );
    expect(r.periodTotals).toEqual([
      expect.objectContaining({ stationCode: '1', regularHours: 8 }),
      expect.objectContaining({
        stationCode: null,
        stationName: null,
        headcount: 0,
        regularHours: 4,
      }),
    ]);
    expect(r.siteTotals.regularHours).toBe(12);
  });

  it('leaves records with no worked time out of the worked hours', () => {
    const r = buildLaborSummary(
      input({
        worktime: [
          { emp_id: 2, work_date: day('2026-10-05'), work_hours: '00:00' },
          { emp_id: 3, work_date: day('2026-10-05') },
        ],
      }),
    );
    expect(r.periodTotals).toEqual([]);
    expect(r.dailyWorked).toEqual([]);
    expect(r.employeeLines).toEqual([]);
  });

  it("counts an absence for its planned shift's length at that station, justified when it has a comment", () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          {
            empId: 'e2',
            shiftId: 's2',
            taskId: 2,
            planDate: day('2026-10-05'),
          },
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-06'),
          },
        ],
        worktime: [
          {
            emp_id: 1,
            shift_id: 's1',
            work_date: day('2026-10-05'),
            work_hours: '08:00',
            absent: true,
            absent_comment: 'Sick note',
          },
          { emp_id: 2, work_date: day('2026-10-05'), absent: true },
          {
            emp_id: 1,
            work_date: day('2026-10-06'),
            absent: true,
            absent_comment: '   ',
          },
        ],
      }),
    );
    expect(r.periodTotals).toMatchObject([
      {
        stationCode: '1',
        justifiedAbsenceHours: 8,
        unjustifiedAbsenceHours: 8,
      },
      {
        stationCode: '2',
        justifiedAbsenceHours: 0,
        unjustifiedAbsenceHours: 8,
      },
    ]);
    expect(r.siteTotals).toMatchObject({
      justifiedAbsenceHours: 8,
      unjustifiedAbsenceHours: 16,
      regularHours: 0,
    });
    // An absence is not time worked
    expect(r.dailyWorked).toEqual([]);
  });

  it("counts an absence with no planned shift for the company's hours per day, at no station", () => {
    const absences = [
      { emp_id: 1, work_date: day('2026-10-05'), absent: true },
      {
        emp_id: 2,
        work_date: day('2026-10-05'),
        absent: true,
        absent_comment: 'Family event',
      },
    ];
    const r = buildLaborSummary(input({ worktime: absences }));
    expect(r.periodTotals).toMatchObject([
      {
        stationCode: null,
        justifiedAbsenceHours: 8,
        unjustifiedAbsenceHours: 8,
      },
    ]);
    const seven = buildLaborSummary(
      input({ worktime: absences, hoursPerDay: 7 }),
    );
    expect(seven.siteTotals).toMatchObject({
      justifiedAbsenceHours: 7,
      unjustifiedAbsenceHours: 7,
    });
  });

  it('never counts more overtime than the time worked', () => {
    const r = buildLaborSummary(
      input({
        worktime: [
          {
            emp_id: 1,
            work_date: day('2026-10-05'),
            work_hours: '01:00',
            overtime_minutes: '90',
          },
        ],
      }),
    );
    expect(r.siteTotals).toMatchObject({ regularHours: 0, overtimeHours: 1 });
  });

  it('gives each employee an anonymous code, the same for each of their stations', () => {
    const r = buildLaborSummary(
      input({
        planning: [
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          {
            empId: 'e1',
            shiftId: 's1',
            taskId: 2,
            planDate: day('2026-10-06'),
          },
        ],
        worktime: [
          {
            emp_id: 1,
            shift_id: 's1',
            work_date: day('2026-10-05'),
            work_hours: '08:00',
          },
          {
            emp_id: 1,
            shift_id: 's1',
            work_date: day('2026-10-06'),
            work_hours: '05:15',
          },
        ],
      }),
    );
    expect(r.employeeLines).toHaveLength(2);
    const [a, b] = r.employeeLines;
    expect(a.employeeRef).toMatch(/^E-[0-9a-f]{12}$/);
    expect(b.employeeRef).toBe(a.employeeRef);
    expect([a, b]).toEqual([
      {
        employeeRef: a.employeeRef,
        stationCode: '1',
        hoursWorked: 8,
        laborCost: 0,
      },
      {
        employeeRef: a.employeeRef,
        stationCode: '2',
        hoursWorked: 5.25,
        laborCost: 0,
      },
    ]);
    expect(JSON.stringify(r)).not.toContain('"e1"');
    // Another company's employee #1 gets another code
    const other = buildLaborSummary({
      ...input(),
      companyId: 'c2',
      worktime: [
        { emp_id: 1, work_date: day('2026-10-05'), work_hours: '08:00' },
      ],
    });
    expect(other.employeeLines[0].employeeRef).not.toBe(a.employeeRef);
  });

  it('totals the bonuses and advances of the period for the whole site', () => {
    const r = buildLaborSummary(
      input({
        bonuses: [{ amount: 1000 }, { amount: 250.5 }],
        advances: [{ amount: 2000 }],
      }),
    );
    expect(r.siteTotals).toMatchObject({
      headcount: 3,
      bonuses: 1250.5,
      advancesPaid: 2000,
    });
  });

  it('copes with deleted employees, shifts and tasks, undated records and bad amounts', () => {
    const r = buildLaborSummary(
      input({
        planning: [
          // Employee deleted since
          {
            empId: 'gone',
            shiftId: 's1',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          // Shift deleted since: no times, so no planned hours or slot
          {
            empId: 'e1',
            shiftId: 'gone',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
          // Task deleted since
          {
            empId: 'e2',
            shiftId: 's1',
            taskId: 9,
            planDate: day('2026-10-05'),
          },
          // Two slots at one station on one day: by start time
          {
            empId: 'e3',
            shiftId: 's2',
            taskId: 1,
            planDate: day('2026-10-05'),
          },
        ],
        worktime: [
          { emp_id: 3, work_hours: '08:00' }, // no date: left out
          { emp_id: 9, work_date: day('2026-10-05'), work_hours: '02:00' },
        ],
        bonuses: [{ amount: 'abc' as unknown as number }, { amount: 100 }],
        advances: [{ amount: undefined as unknown as number }],
      }),
    );
    expect(r.periodTotals).toMatchObject([
      {
        stationCode: '1',
        stationName: 'Grill',
        headcount: 3,
        plannedHours: 16,
      },
      { stationCode: '9', stationName: null, headcount: 1, plannedHours: 8 },
      { stationCode: null, regularHours: 2 },
    ]);
    expect(r.plannedShifts.map((x) => `${x.stationCode} ${x.start}`)).toEqual([
      '1 08:00',
      '1 18:00',
      '9 08:00',
    ]);
    expect(r.siteTotals).toMatchObject({ bonuses: 100, advancesPaid: 0 });
  });
});

describe('monthsCovered', () => {
  it('counts a full calendar month as one salary', () => {
    expect(monthsCovered({ start: '2026-10-01', end: '2026-10-31' })).toBe(1);
    expect(monthsCovered({ start: '2026-02-01', end: '2026-02-28' })).toBe(1);
    expect(
      monthsCovered({ start: '2026-01-01', end: '2026-12-31' }),
    ).toBeCloseTo(12);
  });

  it('counts each month by its days inside the period', () => {
    // 17 of October's 31 days + 14 of November's 30
    expect(
      monthsCovered({ start: '2026-10-15', end: '2026-11-14' }),
    ).toBeCloseTo(17 / 31 + 14 / 30);
    expect(
      monthsCovered({ start: '2026-10-05', end: '2026-10-11' }),
    ).toBeCloseTo(7 / 31);
  });

  it('starts at the hire date, and is 0 for someone hired after the period', () => {
    const october = { start: '2026-10-01', end: '2026-10-31' };
    expect(monthsCovered(october, '2026-10-17')).toBeCloseTo(15 / 31);
    expect(monthsCovered(october, '2025-01-01')).toBe(1);
    expect(monthsCovered(october, '2026-11-02')).toBe(0);
  });
});

describe('salaries and employer charges', () => {
  const planned = (empId: string, taskId: number, d: string) => ({
    empId,
    shiftId: 's1',
    taskId,
    planDate: day(d),
  });
  const worked = (emp_id: number, d: string, work_hours: string) => ({
    emp_id,
    shift_id: 's1',
    work_date: day(d),
    work_hours,
  });

  it('charges 34% of the declared salary of insured employees only, for each full month', () => {
    const r = buildLaborSummary(
      input({
        employees: [
          {
            _id: 'e1',
            empNumber: 1,
            baseSalary: 40000,
            insured: true,
            declaredSalary: 24000,
          },
          { _id: 'e2', empNumber: 2, baseSalary: 30000 },
          // A declared salary without being insured is not charged
          { _id: 'e3', empNumber: 3, baseSalary: 0, declaredSalary: 20000 },
        ],
      }),
    );
    expect(r.metadata).toMatchObject({
      version: '3',
      employerChargeRate: 0.34,
    });
    expect(r.siteTotals).toMatchObject({
      baseSalaries: 70000,
      employerCharges: 8160,
      totalLaborCost: 78160,
    });
  });

  it("splits an employee's cost between stations by the hours worked there", () => {
    const r = buildLaborSummary(
      input({
        employees: [
          {
            _id: 'e1',
            empNumber: 1,
            baseSalary: 40000,
            insured: true,
            declaredSalary: 24000,
          },
        ],
        planning: [
          planned('e1', 1, '2026-10-05'),
          planned('e1', 2, '2026-10-06'),
        ],
        worktime: [
          worked(1, '2026-10-05', '06:00'),
          worked(1, '2026-10-06', '02:00'),
        ],
      }),
    );
    // 6 of 8 hours at the grill, 2 at the bar
    expect(
      r.periodTotals.map((p) => [
        p.stationCode,
        p.baseSalaries,
        p.employerCharges,
        p.totalLaborCost,
      ]),
    ).toEqual([
      ['1', 30000, 6120, 36120],
      ['2', 10000, 2040, 12040],
    ]);
    expect(r.employeeLines.map((l) => l.laborCost)).toEqual([36120, 12040]);
  });

  it('puts the cost of someone with no hours under no station', () => {
    const r = buildLaborSummary(
      input({ employees: [{ _id: 'e1', empNumber: 1, baseSalary: 31000 }] }),
    );
    expect(r.periodTotals).toEqual([
      expect.objectContaining({
        stationCode: null,
        baseSalaries: 31000,
        totalLaborCost: 31000,
        regularHours: 0,
      }),
    ]);
    expect(r.employeeLines).toEqual([
      expect.objectContaining({
        stationCode: null,
        hoursWorked: 0,
        laborCost: 31000,
      }),
    ]);
  });

  it('counts part of the salary for part of a month, from the hire date', () => {
    const r = buildLaborSummary(
      input({
        period: { start: '2026-10-01', end: '2026-10-15' },
        employees: [
          { _id: 'e1', empNumber: 1, baseSalary: 31000 },
          {
            _id: 'e2',
            empNumber: 2,
            baseSalary: 31000,
            hireDate: '2026-10-11',
          },
        ],
      }),
    );
    // 15 days and 5 days of October's 31
    expect(r.siteTotals.baseSalaries).toBe(20000);
  });

  it("adds the bonuses to the site's labor cost only", () => {
    const r = buildLaborSummary(
      input({
        employees: [{ _id: 'e1', empNumber: 1, baseSalary: 10000 }],
        bonuses: [{ amount: 500 }],
      }),
    );
    expect(r.siteTotals.totalLaborCost).toBe(10500);
    expect(r.periodTotals[0].totalLaborCost).toBe(10000);
  });
});
