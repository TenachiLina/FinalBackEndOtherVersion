import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';
import { localNow } from '../src/notifications/notifications.util';
import { runForCompany } from '../src/tenancy/tenant-context';

// GET /dashboard: the Home page's figures. Today at a glance (who is in,
// late, absent, not arrived), what is waiting, and for admins the pay of the
// month so far.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const DAY = 86_400_000;
// A time zone where it is about midday right now (see notifications.e2e-spec)
const hours = ((12 - new Date().getUTCHours() + 36) % 24) - 12;
const OFFSET = `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
const today = () => localNow(new Date(), OFFSET).day;
const todayDate = () => new Date(`${today()}T00:00:00.000Z`);

async function setup(overrides: Record<string, unknown> = {}) {
  const company = await seed.company({
    settings: { utcOffset: OFFSET },
    ...overrides,
  } as any);
  const admin = await loginAs(t, await seed.user('admin', company.id));
  const employee = (empNumber: number, firstName: string) =>
    seed.employee(company.id, {
      empNumber,
      firstName,
      lastName: 'Test',
      baseSalary: 52000, // 250 an hour
    });
  const amine = await employee(1, 'Amine');
  const sara = await employee(2, 'Sara');
  const karim = await employee(3, 'Karim');
  const morning = await seed.shift(company.id, {
    startTime: '08:00',
    endTime: '16:00',
  });
  const night = await seed.shift(company.id, {
    startTime: '23:30',
    endTime: '23:59',
  });
  const plan = (e: { _id: unknown }, shift = morning) =>
    seed.planning(company.id, {
      empId: String(e._id),
      shiftId: String(shift._id),
      planDate: todayDate(),
    });
  const clock = (emp_id: number, fields: Record<string, unknown>) =>
    seed.worktime(company.id, { emp_id, work_date: todayDate(), ...fields });
  return { company, admin, amine, sara, karim, morning, night, plan, clock };
}

describe('GET /dashboard', () => {
  it('shows where everyone stands today', async () => {
    const { admin, amine, sara, karim, night, plan, clock } = await setup();
    await plan(amine);
    await plan(sara);
    await plan(karim, night);
    await clock(1, {
      clock_in: '08:20',
      late_minutes: '20',
      work_hours: '00:00',
    });

    const res = await admin.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.day).toBe(today());
    expect(res.body.time).toMatch(/^\d{2}:\d{2}$/);
    expect(res.body.attendance.employees).toBe(3);
    expect(res.body.attendance.counts).toEqual({
      planned: 3,
      present: 1,
      left: 0,
      late: 1,
      absent: 0,
      missing: 1,
      expected: 1,
    });
    expect(res.body.attendance.people).toEqual([
      {
        empNumber: 2,
        name: 'Sara Test',
        status: 'missing',
        shift: '08:00 – 16:00',
        clockIn: null,
        clockOut: null,
        late: false,
        lateMinutes: 0,
      },
      {
        empNumber: 1,
        name: 'Amine Test',
        status: 'present',
        shift: '08:00 – 16:00',
        clockIn: '08:20',
        clockOut: null,
        late: true,
        lateMinutes: 20,
      },
      {
        empNumber: 3,
        name: 'Karim Test',
        status: 'expected',
        shift: '23:30 – 23:59',
        clockIn: null,
        clockOut: null,
        late: false,
        lateMinutes: 0,
      },
    ]);
  });

  it('tells absent, left, and present without being planned', async () => {
    const { admin, clock } = await setup();
    await clock(1, { absent: true, absent_comment: 'Sick' });
    await clock(2, { clock_in: '08:00', clock_out: '11:00' });
    await clock(3, { clock_in: '09:00' });
    const res = await admin.get('/dashboard');
    expect(
      res.body.attendance.people.map((p: any) => [p.name, p.status, p.shift]),
    ).toEqual([
      ['Amine Test', 'absent', null],
      ['Karim Test', 'present', null],
      ['Sara Test', 'left', null],
    ]);
    expect(res.body.attendance.counts).toMatchObject({
      planned: 0,
      present: 1,
      left: 1,
      absent: 1,
    });
  });

  it('is empty and all zeros on a day with nothing', async () => {
    const { admin } = await setup();
    const res = await admin.get('/dashboard');
    expect(res.body.attendance).toEqual({
      employees: 3,
      counts: {
        planned: 0,
        present: 0,
        left: 0,
        late: 0,
        absent: 0,
        missing: 0,
        expected: 0,
      },
      people: [],
    });
    expect(res.body.pending).toEqual({ corrections: 0 });
  });

  it("uses a planning entry's own start and end when it has them", async () => {
    const { admin, company, amine, morning } = await setup();
    await seed.planning(company.id, {
      empId: String(amine._id),
      shiftId: String(morning._id),
      planDate: todayDate(),
      customStartTime: '23:40',
      customEndTime: '23:50',
    });
    const res = await admin.get('/dashboard');
    expect(res.body.attendance.people[0]).toMatchObject({
      shift: '23:40 – 23:50',
      status: 'expected',
    });
  });

  it('leaves out yesterday, archived employees and other companies', async () => {
    const { admin, company, sara, plan, clock } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: new Date(todayDate().getTime() - DAY),
      clock_in: '08:00',
    });
    await plan(sara);
    await clock(2, { clock_in: '08:00' });
    await admin.patch(`/employees/${sara._id}/archive`);
    const other = await setup();
    await other.plan(other.amine);

    const res = await admin.get('/dashboard');
    expect(res.body.attendance).toMatchObject({ employees: 2, people: [] });
    const theirs = await other.admin.get('/dashboard');
    expect(theirs.body.attendance.people).toHaveLength(1);
  });

  it('has no attendance when clock-in is off for the company', async () => {
    const { admin } = await setup({ features: ['planning', 'reporting'] });
    const res = await admin.get('/dashboard');
    expect(res.body.attendance).toBeNull();
    expect(res.body.month).not.toBeNull();
  });

  it('counts planned people without the planning feature as unplanned', async () => {
    const { admin, clock } = await setup({ features: ['clockin'] });
    await clock(1, { clock_in: '08:00' });
    const res = await admin.get('/dashboard');
    expect(res.body.attendance.counts).toMatchObject({
      planned: 0,
      present: 1,
    });
    expect(res.body.month).toBeNull();
  });
});

describe('the month so far (admins)', () => {
  it('gives the pay of the current month, as the payroll page would', async () => {
    const { admin, company, clock } = await setup();
    await clock(1, {
      clock_in: '08:00',
      clock_out: '16:00',
      work_hours: '08:00',
      penalty: 200,
    });
    await seed.advance(company.id, {
      emp_id: 1,
      amount: 500,
      date: todayDate(),
    });
    await seed.bonus(company.id, { emp_id: 1, amount: 300, date: today() });
    const res = await admin.get('/dashboard');
    expect(res.body.month).toEqual({
      month: today().slice(0, 7),
      currency: 'DA',
      hours: 8,
      gross: 2000,
      advances: 500,
      bonuses: 300,
      net: 2000 - 200 - 500 + 300,
      employees: 1,
      closesAt: null,
    });
    const page = await admin.get(
      `/payroll/period?start=${today().slice(0, 7)}-01&end=${today()}`,
    );
    expect(page.body.totals.net).toBe(res.body.month.net);
  });

  it('says when the month will close by itself', async () => {
    const { admin } = await setup({
      settings: { utcOffset: OFFSET, monthCloseDelayDays: 10 },
    });
    const res = await admin.get('/dashboard');
    expect(new Date(res.body.month.closesAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('a manager gets the attendance without any money figure', async () => {
    const { company, clock } = await setup();
    await clock(1, { clock_in: '08:00', work_hours: '08:00' });
    const manager = await loginAs(t, await seed.user('manager', company.id));
    const res = await manager.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.month).toBeNull();
    expect(res.body.attendance.counts.present).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/gross|net|salary/i);
  });

  it('has no month when reporting is off', async () => {
    const { admin } = await setup({ features: ['planning', 'clockin'] });
    expect((await admin.get('/dashboard')).body.month).toBeNull();
  });
});

describe('who sees what', () => {
  it("a manager doesn't see the other managers on the board", async () => {
    const { company, amine, sara, plan, clock } = await setup();
    await plan(amine);
    await plan(sara);
    await clock(2, { clock_in: '08:00' });
    const me = await seed.user('manager', company.id);
    await seed.user('manager', company.id, { employeeId: String(sara._id) });
    const res = await (await loginAs(t, me)).get('/dashboard');
    expect(res.body.attendance.people.map((p: any) => p.name)).toEqual([
      'Amine Test',
    ]);
    expect(res.body.attendance).toMatchObject({
      employees: 2,
      counts: { planned: 1, present: 0, missing: 1 },
    });
  });

  it('says where the subscription stands', async () => {
    const free = await setup();
    expect((await free.admin.get('/dashboard')).body.subscription).toEqual({
      status: 'none',
      endingSoon: false,
      readOnly: false,
      daysLeft: null,
    });
    const ending = await setup({
      subscription: {
        packName: 'Pro',
        status: 'trial',
        startsAt: new Date(Date.now() - 10 * DAY),
        endsAt: new Date(Date.now() + 2 * DAY + 60_000),
        payments: [],
      },
    });
    expect((await ending.admin.get('/dashboard')).body.subscription).toEqual({
      status: 'trial',
      endingSoon: true,
      readOnly: false,
      daysLeft: 2,
    });
  });

  it('counts the correction requests waiting for an answer', async () => {
    const { admin, company, amine } = await setup();
    // Company data is only reachable inside a company
    await runForCompany(
      company.id,
      async () =>
        await t.model('Correction').create({
          employeeId: amine._id,
          emp_id: 1,
          employeeName: 'Amine Test',
          kind: 'worktime',
          date: today(),
          message: 'I left at 17:00',
          status: 'pending',
          createdBy: String(amine._id),
        }),
    );
    const res = await admin.get('/dashboard');
    expect(res.body.pending.corrections).toBe(1);
  });

  it('is for admins and managers working in a company', async () => {
    const { company } = await setup();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    expect((await kiosk.get('/dashboard')).status).toBe(403);
    const staff = await loginAs(t, await seed.user('staff', company.id));
    expect((await staff.get('/dashboard')).status).toBe(403);
    const root = await loginAs(t, await seed.user('superadmin', null));
    expect((await root.get('/dashboard')).status).toBe(403);
    const inside = await loginAs(t, await seed.user('superadmin', null), {
      companyId: company.id,
    });
    const res = await inside.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.month).not.toBeNull();
  });
});
