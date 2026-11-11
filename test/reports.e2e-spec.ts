import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';

// GET /reports/labor-summary: hours per station for an outside system.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const URL = '/reports/labor-summary?start=2026-10-01&end=2026-10-31';

describe('labor summary', () => {
  it("adds up the company's planned and worked hours per station, and nothing of another company", async () => {
    const company = await seed.company();
    const admin = await loginAs(t, await seed.user('admin', company.id));
    const grill = await seed.task(company.id, { taskId: 1, taskName: 'Grill' });
    const shift = await seed.shift(company.id, {
      startTime: '08:00',
      endTime: '16:00',
    });
    const emp = await seed.employee(company.id, {
      empNumber: 7,
      baseSalary: 30000,
      insured: true,
      declaredSalary: 24000,
    });
    await seed.planning(company.id, {
      empId: String(emp._id),
      shiftId: String(shift._id),
      taskId: grill.taskId,
      planDate: '2026-10-05',
    });
    await seed.worktime(company.id, {
      emp_id: 7,
      shift_id: String(shift._id),
      work_date: new Date('2026-10-05'),
      clock_in: '08:00',
      clock_out: '17:00',
      work_hours: '09:00',
      overtime_minutes: '60',
    });
    // Outside the period
    await seed.worktime(company.id, {
      emp_id: 7,
      work_date: new Date('2026-11-01'),
      work_hours: '08:00',
    });
    await seed.bonus(company.id, {
      emp_id: 7,
      amount: 500,
      date: '2026-10-10',
    });
    await seed.advance(company.id, {
      emp_id: 7,
      amount: 1000,
      date: '2026-10-12',
    });

    // Another company's data stays out
    const other = await seed.company();
    const otherEmp = await seed.employee(other.id, { empNumber: 7 });
    const otherShift = await seed.shift(other.id);
    await seed.planning(other.id, {
      empId: String(otherEmp._id),
      shiftId: String(otherShift._id),
      taskId: 1,
      planDate: '2026-10-05',
    });
    await seed.worktime(other.id, {
      emp_id: 7,
      work_date: new Date('2026-10-05'),
      work_hours: '05:00',
    });

    const res = await admin.get(URL);
    expect(res.status).toBe(200);
    expect(res.body.metadata).toMatchObject({
      source: 'clockinout',
      version: '2',
      period: { start: '2026-10-01', end: '2026-10-31' },
      stations: [{ code: '1', name: 'Grill', active: true }],
    });
    expect(res.body.siteTotals).toMatchObject({
      headcount: 1,
      regularHours: 8,
      overtimeHours: 1,
      plannedHours: 8,
      bonuses: 500,
      advancesPaid: 1000,
      // One month of salary, 34% of the declared 24 000, plus the bonus
      baseSalaries: 30000,
      employerCharges: 8160,
      totalLaborCost: 38660,
    });
    expect(res.body.periodTotals).toEqual([
      {
        period: { start: '2026-10-01', end: '2026-10-31' },
        stationCode: '1',
        stationName: 'Grill',
        headcount: 1,
        regularHours: 8,
        overtimeHours: 1,
        plannedHours: 8,
        baseSalaries: 30000,
        employerCharges: 8160,
        totalLaborCost: 38160,
      },
    ]);
    expect(res.body.plannedShifts).toEqual([
      {
        date: '2026-10-05',
        stationCode: '1',
        start: '08:00',
        end: '16:00',
        plannedStaff: 1,
      },
    ]);
    expect(res.body.dailyWorked).toEqual([
      { date: '2026-10-05', stationCode: '1', workedHours: 9, staffPresent: 1 },
    ]);
    expect(res.body.employeeLines).toEqual([
      {
        employeeRef: expect.stringMatching(/^E-/),
        stationCode: '1',
        hoursWorked: 9,
        laborCost: 38160,
      },
    ]);
    // No names or employee numbers leave the app
    expect(JSON.stringify(res.body)).not.toMatch(
      /First|Last|empNumber|emp_id|declaredSalary|insured/,
    );
  });

  it('is for admins only', async () => {
    const company = await seed.company();
    const manager = await loginAs(t, await seed.user('manager', company.id));
    expect((await manager.get(URL)).status).toBe(403);
    expect((await api(t.app).get(URL)).status).toBe(401);
  });

  it.each([
    ['', 'start and end must be YYYY-MM-DD dates'],
    ['?start=2026-10-01', 'start and end must be YYYY-MM-DD dates'],
    [
      '?start=2026-02-30&end=2026-03-01',
      'start and end must be YYYY-MM-DD dates',
    ],
    ['?start=2026-10-31&end=2026-10-01', 'start must be on or before end'],
    ['?start=2025-01-01&end=2026-10-01', 'The period can be at most 366 days'],
  ])('refuses the period %s', async (query, message) => {
    const company = await seed.company();
    const admin = await loginAs(t, await seed.user('admin', company.id));
    const res = await admin.get(`/reports/labor-summary${query}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });
});
