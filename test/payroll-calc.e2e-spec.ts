import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';

// Pay is calculated by the server (src/payroll): GET /payroll/period and
// GET /payroll/payslips. The pages show these numbers as they are.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** A company with two employees and a signed-in admin. */
async function setup(settings?: Record<string, unknown>) {
  const company = await seed.company(settings ? { settings } : {});
  const amine = await seed.employee(company.id, {
    empNumber: 1,
    firstName: 'Amine',
    lastName: 'Bensalah',
    baseSalary: 52000, // 250 an hour with 8 h × 26 days
  });
  const sara = await seed.employee(company.id, {
    empNumber: 2,
    firstName: 'Sara',
    lastName: 'Haddad',
    baseSalary: 26000, // 125 an hour
  });
  const admin = await loginAs(t, await seed.user('admin', company.id));
  return { company, amine, sara, admin };
}

describe('GET /payroll/period', () => {
  it('calculates gross, deductions, net and the weekly advance offer', async () => {
    const { company, admin } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-05'),
      work_hours: '08:00',
      late_minutes: '10',
      penalty: 500,
      consomation: 300,
    });
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-06'),
      work_hours: '08:00',
    });
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-07'),
      work_hours: '00:00',
      absent: true,
    });
    await seed.advance(company.id, {
      emp_id: 1,
      amount: 1000,
      date: day('2026-10-05'),
    });
    await seed.bonus(company.id, {
      emp_id: 1,
      amount: 700,
      date: '2026-10-06',
      reason: 'Good month',
    });

    const res = await admin.get(
      '/payroll/period?start=2026-10-01&end=2026-10-31',
    );
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      empId: 1,
      firstName: 'Amine',
      lastName: 'Bensalah',
      baseSalary: 52000,
      hourlyRate: 250,
      hours: 16,
      gross: 4000,
      penalties: 500,
      consommation: 300,
      absences: 1,
      lateMinutes: 10,
      lateDays: 1,
      advances: 1000,
      advancesCount: 1,
      bonuses: 700,
      bonusesCount: 1,
      net: 4000 - 500 - 300 - 1000 + 700,
      advanceOffer: (4000 - 300) * 0.5,
      records: 3,
    });
    expect(res.body.rows[0].advanceId).toEqual(expect.any(String));
    expect(res.body.totals).toMatchObject({
      gross: 4000,
      net: 2900,
      advances: 1000,
      bonuses: 700,
      employees: 1,
    });
    expect(res.body.settings).toEqual({
      hoursPerDay: 8,
      workingDaysPerMonth: 26,
      weeklyAdvanceRatio: 0.5,
      currency: 'DA',
    });
  });

  it("uses the company's payroll settings", async () => {
    const { company, admin } = await setup({
      hoursPerDay: 10,
      workingDaysPerMonth: 20,
      weeklyAdvanceRatio: 0.25,
      currency: 'EUR',
    });
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-05'),
      work_hours: '10:00',
    });
    const res = await admin.get(
      '/payroll/period?start=2026-10-05&end=2026-10-11',
    );
    // 52000 / 10 / 20 = 260 an hour
    expect(res.body.rows[0]).toMatchObject({
      hourlyRate: 260,
      gross: 2600,
      advanceOffer: 650,
    });
    expect(res.body.settings.currency).toBe('EUR');
  });

  it('lists planned employees without worked time, and leaves out the others', async () => {
    const { company, sara, admin } = await setup();
    const shift = await seed.shift(company.id);
    await seed.planning(company.id, {
      empId: String(sara._id),
      shiftId: String(shift._id),
      planDate: day('2026-10-05'),
    });
    const res = await admin.get(
      '/payroll/period?start=2026-10-05&end=2026-10-11',
    );
    expect(res.body.rows.map((r: any) => r.empId)).toEqual([2]);
    expect(res.body.rows[0]).toMatchObject({
      scheduled: true,
      hours: 0,
      gross: 0,
      net: 0,
    });
  });

  it('pays hours worked without a planning entry', async () => {
    const { company, admin } = await setup();
    await seed.worktime(company.id, {
      emp_id: 2,
      work_date: day('2026-10-05'),
      work_hours: '04:00',
    });
    const res = await admin.get(
      '/payroll/period?start=2026-10-05&end=2026-10-11',
    );
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      empId: 2,
      scheduled: false,
      gross: 500,
    });
  });

  it('only counts the days inside the period, both ends included', async () => {
    const { company, admin } = await setup();
    for (const d of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
      await seed.worktime(company.id, {
        emp_id: 1,
        work_date: day(d),
        work_hours: '08:00',
      });
      await seed.advance(company.id, { emp_id: 1, amount: 100, date: day(d) });
      await seed.bonus(company.id, {
        emp_id: 1,
        amount: 10,
        date: d,
        reason: 'x',
      });
    }
    const res = await admin.get(
      '/payroll/period?start=2026-10-01&end=2026-10-31',
    );
    expect(res.body.rows[0]).toMatchObject({
      hours: 16,
      advances: 200,
      bonuses: 20,
    });
  });

  it('empId gives that employee alone, even with nothing in the period', async () => {
    const { company, admin } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-05'),
      work_hours: '08:00',
    });
    const res = await admin.get(
      '/payroll/period?start=2026-10-05&end=2026-10-11&empId=2',
    );
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ empId: 2, hours: 0, net: 0 });
    const none = await admin.get(
      '/payroll/period?start=2026-10-05&end=2026-10-11&empId=99',
    );
    expect(none.body.rows).toEqual([]);
  });

  it('is empty when nobody worked or was planned', async () => {
    const { admin } = await setup();
    const res = await admin.get(
      '/payroll/period?start=2026-10-05&end=2026-10-11',
    );
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.totals).toMatchObject({ gross: 0, net: 0, employees: 0 });
  });

  it.each([
    ['', 'start and end must be YYYY-MM-DD dates'],
    ['?start=2026-10-01', 'start and end must be YYYY-MM-DD dates'],
    [
      '?start=01/10/2026&end=2026-10-31',
      'start and end must be YYYY-MM-DD dates',
    ],
    [
      '?start=2026-02-30&end=2026-03-01',
      'start and end must be YYYY-MM-DD dates',
    ],
    ['?start=2026-10-31&end=2026-10-01', 'start must be on or before end'],
    ['?start=2025-01-01&end=2026-10-01', 'The period can be at most 366 days'],
    [
      '?start=2026-10-01&end=2026-10-31&empId=abc',
      'empId must be an employee number',
    ],
  ])('refuses "%s"', async (query, message) => {
    const { admin } = await setup();
    const res = await admin.get(`/payroll/period${query}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it("never mixes in another company's records", async () => {
    const a = await setup();
    const b = await setup();
    await seed.worktime(b.company.id, {
      emp_id: 1,
      work_date: day('2026-10-05'),
      work_hours: '08:00',
    });
    await seed.advance(b.company.id, {
      emp_id: 1,
      amount: 900,
      date: day('2026-10-05'),
    });
    const res = await a.admin.get(
      '/payroll/period?start=2026-10-01&end=2026-10-31',
    );
    expect(res.body.rows).toEqual([]);
  });

  it("hides the other managers from a manager, not the manager's own line", async () => {
    const { company, amine, sara } = await setup();
    for (const emp of [1, 2]) {
      await seed.worktime(company.id, {
        emp_id: emp,
        work_date: day('2026-10-05'),
        work_hours: '08:00',
      });
    }
    const me = await seed.user('manager', company.id, {
      employeeId: String(amine._id),
    });
    await seed.user('manager', company.id, { employeeId: String(sara._id) });
    const client = await loginAs(t, me);
    const res = await client.get(
      '/payroll/period?start=2026-10-01&end=2026-10-31',
    );
    expect(res.body.rows.map((r: any) => r.empId)).toEqual([1]);
    expect(res.body.totals.employees).toBe(1);
    // Asking for the other manager by number gives nothing either
    const other = await client.get(
      '/payroll/period?start=2026-10-01&end=2026-10-31&empId=2',
    );
    expect(other.body.rows).toEqual([]);
  });
});

describe('GET /payroll/payslips', () => {
  it('gives the amounts of each fiche de paie', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, {
      empNumber: 3,
      firstName: 'Lina',
      lastName: 'Kaci',
      baseSalary: 45000,
      declaredSalary: 30000,
      insured: true,
    });
    const res = await admin.get('/payroll/payslips?month=2026-10');
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-10');
    expect(res.body.payslips.map((p: any) => p.empId)).toEqual([1, 2, 3]);
    expect(res.body.payslips[0]).toMatchObject({
      empId: 1,
      insured: false,
      days: 30,
      baseSalary: 52000,
      postSalary: 52000,
      socialSecurity: 4680,
      net: 47320,
    });
    // The declared salary wins over the base salary
    expect(res.body.payslips[2]).toMatchObject({
      insured: true,
      baseSalary: 30000,
      socialSecurity: 2700,
      net: 27300,
    });
  });

  it.each(['', '?month=2026', '?month=2026-13', '?month=10-2026'])(
    'refuses "%s"',
    async (query) => {
      const { admin } = await setup();
      const res = await admin.get(`/payroll/payslips${query}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('month must be YYYY-MM (e.g. 2026-11)');
    },
  );

  it('hides the other managers from a manager', async () => {
    const { company, amine, sara } = await setup();
    const me = await seed.user('manager', company.id, {
      employeeId: String(amine._id),
    });
    await seed.user('manager', company.id, { employeeId: String(sara._id) });
    const res = await (
      await loginAs(t, me)
    ).get('/payroll/payslips?month=2026-10');
    expect(res.body.payslips.map((p: any) => p.empId)).toEqual([1]);
  });
});
