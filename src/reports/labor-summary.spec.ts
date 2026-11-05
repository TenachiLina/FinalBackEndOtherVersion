import { buildLaborSummary, LaborSummaryInput } from './labor-summary';

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
      version: '1',
      period: { start: '2026-10-01', end: '2026-10-31' },
      currency: 'DA',
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

  it('leaves out absences and records with no worked time', () => {
    const r = buildLaborSummary(
      input({
        worktime: [
          {
            emp_id: 1,
            work_date: day('2026-10-05'),
            work_hours: '08:00',
            absent: true,
          },
          { emp_id: 2, work_date: day('2026-10-05'), work_hours: '00:00' },
          { emp_id: 3, work_date: day('2026-10-05') },
        ],
      }),
    );
    expect(r.periodTotals).toEqual([]);
    expect(r.dailyWorked).toEqual([]);
    expect(r.employeeLines).toEqual([]);
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
      { employeeRef: a.employeeRef, stationCode: '1', hoursWorked: 8 },
      { employeeRef: a.employeeRef, stationCode: '2', hoursWorked: 5.25 },
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
});
