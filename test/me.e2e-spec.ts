import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { runForCompany } from '../src/tenancy/tenant-context';

// Personal employee (staff) accounts, used by the employee mobile app: they
// read their own profile, planning, clocking history, advances and bonuses,
// and nothing about anyone else or any other company.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

/** A company, an employee with a staff account (signed in) and a colleague. */
async function setup(features?: string[]) {
  const company = await seed.company(
    features ? { features: features as any } : {},
  );
  const me = await seed.employee(company.id, {
    firstName: 'Amine',
    lastName: 'Bensalah',
    jobTitle: 'Pizzaiolo',
    phoneNumber: '0550 00 00 00',
    hireDate: '2025-03-01',
    baseSalary: 45000,
    declaredSalary: 30000,
    socialSecurityNumber: '123',
  });
  const colleague = await seed.employee(company.id, {
    firstName: 'Sara',
    lastName: 'Haddad',
  });
  const account = await seed.user('staff', company.id, {
    employeeId: String(me._id),
  });
  const client = await loginAs(t, account);
  return { company, me, colleague, account, client };
}

describe('staff accounts', () => {
  it('sign in and see who they are', async () => {
    const { client, account } = await setup();
    const res = await client.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: account.id, role: 'staff' });
  });

  it('are refused everywhere else, kiosk and company data included', async () => {
    const { client } = await setup();
    for (const [method, url] of [
      ['get', '/employees'],
      ['get', '/planning'],
      ['get', '/worktime'],
      ['get', '/advances'],
      ['get', '/kiosk/employees'],
      ['post', '/kiosk/clock'],
      ['get', '/users'],
    ] as const) {
      const res = await (client as any)[method](url).send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        'This account can only see its own information',
      );
    }
  });

  it('/me routes are refused to admins, managers and kiosk accounts', async () => {
    const { company } = await setup();
    for (const role of ['admin', 'manager', 'employee'] as const) {
      const client = await loginAs(t, await seed.user(role, company.id));
      expect((await client.get('/me/profile')).status).toBe(403);
    }
  });

  it('get a 403 when the account is not linked to an employee', async () => {
    const company = await seed.company();
    const client = await loginAs(t, await seed.user('staff', company.id));
    const res = await client.get('/me/profile');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Your account is not linked to an employee');
  });

  it('get a 404 when their employee record was deleted', async () => {
    const company = await seed.company();
    const client = await loginAs(
      t,
      await seed.user('staff', company.id, { employeeId: unknownId() }),
    );
    expect((await client.get('/me/profile')).status).toBe(404);
  });

  it("can't reach an employee of another company through a forged link", async () => {
    const other = await seed.company();
    const elsewhere = await seed.employee(other.id);
    const company = await seed.company();
    const client = await loginAs(
      t,
      await seed.user('staff', company.id, {
        employeeId: String(elsewhere._id),
      }),
    );
    expect((await client.get('/me/profile')).status).toBe(404);
  });
});

describe('creating staff accounts (admin)', () => {
  it('needs an employee of the company, one account per employee', async () => {
    const company = await seed.company();
    const admin = await loginAs(t, await seed.user('admin', company.id));
    const employee = await seed.employee(company.id);
    const foreign = await seed.employee((await seed.company()).id);
    const body = (over: object = {}) => ({
      email: `staff${Math.random().toString(36).slice(2, 8)}@test.dz`,
      name: 'Staff',
      password: 'Good-pass-42',
      role: 'staff',
      ...over,
    });

    const missing = await admin.post('/users').send(body());
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe(
      'An employee account must be linked to an employee',
    );
    const wrong = await admin
      .post('/users')
      .send(body({ employeeId: String(foreign._id) }));
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('Employee not found');

    const ok = await admin
      .post('/users')
      .send(body({ employeeId: String(employee._id) }));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      role: 'staff',
      employeeId: String(employee._id),
    });

    const twice = await admin
      .post('/users')
      .send(body({ employeeId: String(employee._id) }));
    expect(twice.status).toBe(409);

    // Made an admin: the link is dropped; back to staff without one: refused
    const id = ok.body._id;
    const promoted = await admin.patch(`/users/${id}`).send({ role: 'admin' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.employeeId).toBeNull();
    const back = await admin.patch(`/users/${id}`).send({ role: 'staff' });
    expect(back.status).toBe(400);
  });
});

describe('GET /me/profile', () => {
  it('returns their own details, without salary or social security data', async () => {
    const { client, me, account } = await setup();
    const res = await client.get('/me/profile?id=' + unknownId());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: String(me._id),
      email: account.email,
      empNumber: me.empNumber,
      firstName: 'Amine',
      lastName: 'Bensalah',
      jobTitle: 'Pizzaiolo',
      phoneNumber: '0550 00 00 00',
      address: null,
      personalImage: null,
      birthDate: null,
      hireDate: '2025-03-01',
      familyStatus: null,
    });
  });
});

describe('GET /me/planning', () => {
  it('needs a valid year and month', async () => {
    const { client } = await setup();
    for (const q of [
      '',
      '?year=2026',
      '?year=2026&month=13',
      '?year=x&month=1',
    ]) {
      const res = await client.get(`/me/planning${q}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        'year and month are required (e.g. year=2026&month=11)',
      );
    }
  });

  it('lists the month of the employee only, as main or backup', async () => {
    const { company, me, colleague, client } = await setup();
    const myId = String(me._id);
    const otherId = String(colleague._id);
    const shift = await seed.shift(company.id, {
      startTime: '10:00',
      endTime: '18:00',
    });
    const gone = await seed.shift(company.id);
    const post = await seed.task(company.id, { taskName: 'Pizzaiolo' });
    const shiftId = String(shift._id);

    // Mine, main, with a backup, tasks and a custom start
    await seed.planning(company.id, {
      empId: myId,
      shiftId,
      planDate: new Date('2026-11-03T00:00:00Z'),
      taskId: post.taskId,
      backupEmpIds: [otherId],
      customStartTime: '11:00',
      tasks: [
        { id: 'a', label: 'Dough', startTime: '11:00', endTime: '12:00' },
      ],
    });
    // Mine, as the colleague's backup
    await seed.planning(company.id, {
      empId: otherId,
      shiftId,
      planDate: new Date('2026-11-20T00:00:00Z'),
      taskId: 999,
      backupEmpIds: [myId],
    });
    // Mine as a legacy backup (no backupEmpIds)
    await seed.planning(company.id, {
      empId: otherId,
      shiftId,
      planDate: new Date('2026-11-21T00:00:00Z'),
      backupEmpId: myId,
    });
    // Not mine: the legacy field is ignored when backupEmpIds is set
    await seed.planning(company.id, {
      empId: otherId,
      shiftId,
      planDate: new Date('2026-11-22T00:00:00Z'),
      backupEmpIds: [unknownId()],
      backupEmpId: myId,
    });
    // Not mine: the colleague's own shift
    await seed.planning(company.id, {
      empId: otherId,
      shiftId,
      planDate: new Date('2026-11-04T00:00:00Z'),
    });
    // Mine but in another month
    await seed.planning(company.id, {
      empId: myId,
      shiftId,
      planDate: new Date('2026-12-01T00:00:00Z'),
    });
    // Mine but on a shift deleted since
    await seed.planning(company.id, {
      empId: myId,
      shiftId: String(gone._id),
      planDate: new Date('2026-11-05T00:00:00Z'),
    });
    await runForCompany(company.id, async () => {
      await t.model('Shift').deleteOne({ _id: gone._id });
    });
    // Another company using my id (cannot happen, but must not leak)
    const other = await seed.company();
    const otherShift = await seed.shift(other.id);
    await seed.planning(other.id, {
      empId: myId,
      shiftId: String(otherShift._id),
      planDate: new Date('2026-11-06T00:00:00Z'),
    });

    const res = await client.get(
      `/me/planning?year=2026&month=11&empId=${otherId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.month).toBe(11);
    expect(res.body.entries.map((e: any) => [e.date, e.role])).toEqual([
      ['2026-11-03', 'main'],
      ['2026-11-20', 'backup'],
      ['2026-11-21', 'backup'],
    ]);
    const [main, backup] = res.body.entries;
    expect(main).toMatchObject({
      startTime: '11:00',
      endTime: '18:00',
      shift: { id: shiftId, startTime: '10:00', endTime: '18:00' },
      post: { id: post.taskId, name: 'Pizzaiolo' },
      tasks: [{ label: 'Dough', startTime: '11:00', endTime: '12:00' }],
      mainEmployee: null,
      backups: [{ id: otherId, firstName: 'Sara', lastName: 'Haddad' }],
    });
    expect(backup).toMatchObject({
      startTime: '10:00',
      post: { id: 999, name: null },
      mainEmployee: { id: otherId, firstName: 'Sara', lastName: 'Haddad' },
      backups: [],
    });
    // Names only for colleagues
    expect(Object.keys(main.backups[0]).sort()).toEqual([
      'firstName',
      'id',
      'lastName',
    ]);
  });

  it('is empty for a month without shifts', async () => {
    const { client } = await setup();
    const res = await client.get('/me/planning?year=2026&month=1');
    expect(res.body).toEqual({ year: 2026, month: 1, entries: [] });
  });

  it('needs the planning feature', async () => {
    const { client } = await setup(['clockin']);
    const res = await client.get('/me/planning?year=2026&month=1');
    expect(res.status).toBe(403);
  });
});

describe('GET /me/worktime', () => {
  it("returns the month's clocking records of the employee only", async () => {
    const { company, me, colleague, client } = await setup();
    await seed.worktime(company.id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-11-02T00:00:00Z'),
      clock_in: '09:58',
      clock_out: '18:03',
      work_hours: '08:05',
      late_minutes: '0',
      overtime_minutes: '3',
    });
    await seed.worktime(company.id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-11-03T00:00:00Z'),
      absent: true,
      absent_comment: 'Sick',
    });
    await seed.worktime(company.id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-10-31T00:00:00Z'),
      clock_in: '10:00',
    });
    await seed.worktime(company.id, {
      emp_id: colleague.empNumber,
      work_date: new Date('2026-11-02T00:00:00Z'),
      clock_in: '10:00',
    });
    // Same employee number in another company
    await seed.worktime((await seed.company()).id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-11-04T00:00:00Z'),
      clock_in: '10:00',
    });

    const res = await client.get('/me/worktime?year=2026&month=11');
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([
      {
        id: expect.any(String),
        date: '2026-11-02',
        clockIn: '09:58',
        clockOut: '18:03',
        workHours: '08:05',
        lateMinutes: 0,
        overtimeMinutes: 3,
        absent: false,
        absentComment: null,
      },
      {
        id: expect.any(String),
        date: '2026-11-03',
        clockIn: null,
        clockOut: null,
        workHours: '00:00',
        lateMinutes: 0,
        overtimeMinutes: 0,
        absent: true,
        absentComment: 'Sick',
      },
    ]);
  });
});

describe('GET /me/advances and /me/bonuses', () => {
  it('return the month of the employee only, with the total', async () => {
    const { company, me, colleague, client } = await setup();
    await seed.advance(company.id, {
      emp_id: me.empNumber,
      amount: 5000,
      date: new Date('2026-11-07T00:00:00Z'),
      reason: 'Rent',
    });
    await seed.advance(company.id, {
      emp_id: me.empNumber,
      amount: 2000,
      date: new Date('2026-11-14T00:00:00Z'),
    });
    await seed.advance(company.id, {
      emp_id: me.empNumber,
      amount: 9999,
      date: new Date('2026-12-01T00:00:00Z'),
    });
    await seed.advance(company.id, {
      emp_id: colleague.empNumber,
      amount: 1000,
      date: new Date('2026-11-07T00:00:00Z'),
    });
    await seed.bonus(company.id, {
      emp_id: me.empNumber,
      amount: 3000,
      date: '2026-11-30',
      reason: 'Great month',
    });
    await seed.bonus(company.id, {
      emp_id: me.empNumber,
      amount: 100,
      date: '2026-10-31',
    });
    await seed.bonus(company.id, {
      emp_id: colleague.empNumber,
      amount: 100,
      date: '2026-11-10',
    });

    const advances = await client.get('/me/advances?year=2026&month=11');
    expect(advances.status).toBe(200);
    expect(advances.body.total).toBe(7000);
    expect(advances.body.records).toEqual([
      {
        id: expect.any(String),
        date: '2026-11-07',
        amount: 5000,
        reason: 'Rent',
      },
      {
        id: expect.any(String),
        date: '2026-11-14',
        amount: 2000,
        reason: null,
      },
    ]);

    const bonuses = await client.get('/me/bonuses?year=2026&month=11');
    expect(bonuses.status).toBe(200);
    expect(bonuses.body).toEqual({
      year: 2026,
      month: 11,
      total: 3000,
      records: [
        {
          id: expect.any(String),
          date: '2026-11-30',
          amount: 3000,
          reason: 'Great month',
        },
      ],
    });
  });

  it('need their feature', async () => {
    const { client } = await setup(['planning']);
    for (const url of ['/me/advances', '/me/bonuses', '/me/worktime']) {
      expect((await client.get(`${url}?year=2026&month=11`)).status).toBe(403);
    }
  });
});
