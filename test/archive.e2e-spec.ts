import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, PASSWORD, seeder, unknownId } from './helpers/seed';
import { api } from './helpers/app';

// Archiving: employees, posts (tasks) and users that are no longer used
// leave the daily screens but keep their history, and can be brought back.
// Deleting is for records added by mistake, with nothing attached to them.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function setup() {
  const company = await seed.company();
  const adminUser = await seed.user('admin', company.id);
  const admin = await loginAs(t, adminUser);
  const amine = await seed.employee(company.id, {
    empNumber: 1,
    firstName: 'Amine',
    lastName: 'Bensalah',
    baseSalary: 52000,
  });
  const sara = await seed.employee(company.id, {
    empNumber: 2,
    firstName: 'Sara',
    lastName: 'Haddad',
  });
  return { company, admin, adminUser, amine, sara };
}

describe('archiving an employee', () => {
  it('archives and restores', async () => {
    const { admin, amine } = await setup();
    const res = await admin.patch(`/employees/${amine._id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: 'Amine', isArchived: true });
    expect(new Date(res.body.archivedAt).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );

    const back = await admin.patch(`/employees/${amine._id}/restore`);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ isArchived: false, archivedAt: null });
  });

  it('lists everyone by default, and one side with ?status=', async () => {
    const { admin, amine } = await setup();
    await admin.patch(`/employees/${amine._id}/archive`);
    const names = async (query = '') =>
      (await admin.get(`/employees${query}`)).body
        .map((e: any) => e.firstName)
        .sort();
    expect(await names()).toEqual(['Amine', 'Sara']);
    expect(await names('?status=all')).toEqual(['Amine', 'Sara']);
    expect(await names('?status=active')).toEqual(['Sara']);
    expect(await names('?status=archived')).toEqual(['Amine']);
    const all = await admin.get('/employees');
    expect(all.body.find((e: any) => e.firstName === 'Amine').isArchived).toBe(
      true,
    );
  });

  it('refuses an unknown status', async () => {
    const { admin } = await setup();
    const res = await admin.get('/employees?status=gone');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('status must be active, archived or all');
  });

  it('an employee saved before archiving existed counts as active', async () => {
    const { admin, company } = await setup();
    await seed.employee(company.id, { empNumber: 9, firstName: 'Old' });
    await t
      .model('Employee')
      .collection.updateOne(
        { firstName: 'Old' },
        { $unset: { isArchived: '', archivedAt: '' } },
      );
    const active = await admin.get('/employees?status=active');
    expect(active.body.map((e: any) => e.firstName)).toContain('Old');
  });

  it('keeps the history and the pay of an archived employee', async () => {
    const { admin, company, amine } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-05'),
      work_hours: '08:00',
    });
    await admin.patch(`/employees/${amine._id}/archive`);
    const pay = await admin.get(
      '/payroll/period?start=2026-10-01&end=2026-10-31',
    );
    expect(pay.body.rows).toHaveLength(1);
    expect(pay.body.rows[0]).toMatchObject({
      empId: 1,
      firstName: 'Amine',
      gross: 2000,
    });
    expect((await admin.get('/worktime')).body).toHaveLength(1);
  });

  it('takes the employee off the kiosk', async () => {
    const { company, admin, amine } = await setup();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    expect(
      (await kiosk.get('/kiosk/employees')).body.map((e: any) => e.empNumber),
    ).toEqual([1, 2]);
    await admin.patch(`/employees/${amine._id}/archive`);
    expect(
      (await kiosk.get('/kiosk/employees')).body.map((e: any) => e.empNumber),
    ).toEqual([2]);
    const clock = await kiosk
      .post('/kiosk/clock')
      .send({ empNumber: 1, action: 'in' });
    expect(clock.status).toBe(404);
  });

  it("closes the employee's personal app account", async () => {
    const { company, admin, amine } = await setup();
    const account = await seed.user('staff', company.id, {
      employeeId: String(amine._id),
    });
    const phone = await loginAs(t, account);
    expect((await phone.get('/me/profile')).status).toBe(200);
    await admin.patch(`/employees/${amine._id}/archive`);
    expect((await phone.get('/me/profile')).status).toBe(401);
    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it("can't be done through a normal edit", async () => {
    const { admin, amine } = await setup();
    const res = await admin
      .put(`/employees/${amine._id}`)
      .send({ isArchived: true, firstName: 'Amin' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: 'Amin', isArchived: false });
  });

  it('is for admins and managers, not the kiosk; a manager not for another manager or themself', async () => {
    const { company, admin, amine, sara } = await setup();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    expect((await kiosk.patch(`/employees/${amine._id}/archive`)).status).toBe(
      403,
    );

    const me = await seed.user('manager', company.id, {
      employeeId: String(amine._id),
    });
    await seed.user('manager', company.id, { employeeId: String(sara._id) });
    const manager = await loginAs(t, me);
    const other = await manager.patch(`/employees/${sara._id}/archive`);
    expect(other.status).toBe(403);
    const own = await manager.patch(`/employees/${amine._id}/archive`);
    expect(own.status).toBe(403);
    expect(own.body.message).toBe("You can't archive your own employee record");
    expect((await admin.get('/employees?status=archived')).body).toEqual([]);
  });

  it('answers 404 for an unknown employee', async () => {
    const { admin } = await setup();
    for (const id of [unknownId(), 'nope']) {
      expect((await admin.patch(`/employees/${id}/archive`)).status).toBe(404);
    }
    expect(
      (await admin.patch(`/employees/${unknownId()}/restore`)).status,
    ).toBe(404);
  });

  it("never touches another company's employee", async () => {
    const a = await setup();
    const b = await setup();
    expect(
      (await a.admin.patch(`/employees/${b.amine._id}/archive`)).status,
    ).toBe(404);
    expect((await b.admin.get('/employees?status=archived')).body).toEqual([]);
  });

  it('is written to the activity log', async () => {
    const { admin, company, amine } = await setup();
    await admin.patch(`/employees/${amine._id}/archive`);
    await admin.patch(`/employees/${amine._id}/restore`);
    const read = () =>
      t
        .model('AuditLog')
        .find({ companyId: company._id, action: /^employee\./ })
        .sort({ createdAt: 1 })
        .lean();
    let logs = await read();
    for (let i = 0; i < 50 && logs.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
      logs = await read();
    }
    expect(logs.map((l: any) => l.action)).toEqual([
      'employee.archive',
      'employee.restore',
    ]);
    expect(logs[0].target).toBe('Amine Bensalah (#1)');
  });
});

describe('deleting an employee', () => {
  it('deletes one added by mistake, with nothing on record', async () => {
    const { admin, sara } = await setup();
    const res = await admin.delete(`/employees/${sara._id}`);
    expect(res.status).toBe(200);
    expect(
      (await admin.get('/employees')).body.map((e: any) => e.firstName),
    ).toEqual(['Amine']);
  });

  it.each([
    [
      'worked time',
      (c: string) =>
        seed.worktime(c, {
          emp_id: 1,
          work_date: day('2026-10-05'),
          work_hours: '08:00',
        }),
    ],
    [
      'an advance',
      (c: string) =>
        seed.advance(c, { emp_id: 1, amount: 500, date: day('2026-10-05') }),
    ],
    [
      'a bonus',
      (c: string) =>
        seed.bonus(c, { emp_id: 1, amount: 500, date: '2026-10-05' }),
    ],
  ])('refuses one with %s: archive instead', async (_what, add) => {
    const { admin, company, amine } = await setup();
    await add(company.id);
    const res = await admin.delete(`/employees/${amine._id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'This employee has planning, hours or pay on record: archive them instead of deleting them',
    );
    expect(await seed.find(company.id, 'Employee')).toHaveLength(2);
  });

  it('refuses one who is in the planning, as main employee or as backup', async () => {
    const { admin, company, amine, sara } = await setup();
    const shift = await seed.shift(company.id);
    await seed.planning(company.id, {
      empId: String(amine._id),
      backupEmpIds: [String(sara._id)],
      shiftId: String(shift._id),
      planDate: day('2026-10-05'),
    });
    expect((await admin.delete(`/employees/${amine._id}`)).status).toBe(409);
    expect((await admin.delete(`/employees/${sara._id}`)).status).toBe(409);
  });

  it("another employee's records don't block the deletion", async () => {
    const { admin, company, sara } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day('2026-10-05'),
      work_hours: '08:00',
    });
    expect((await admin.delete(`/employees/${sara._id}`)).status).toBe(200);
  });

  it('answers 404 for an unknown employee', async () => {
    const { admin } = await setup();
    expect((await admin.delete(`/employees/${unknownId()}`)).status).toBe(404);
    expect((await admin.delete('/employees/nope')).status).toBe(404);
  });
});

describe("archived employees and the pack's limit", () => {
  async function limited(max: number) {
    const root = await loginAs(t, await seed.user('superadmin', null));
    const pack = await root.post('/packs').send({
      name: `Limit ${Date.now()} ${Math.random()}`,
      maxEmployees: max,
    });
    const ctx = await setup(); // 2 employees
    await root
      .put(`/companies/${ctx.company.id}/subscription`)
      .send({ packId: pack.body._id, kind: 'active' });
    return ctx;
  }

  it("archived employees don't take a place", async () => {
    const { admin, amine } = await limited(2);
    const add = () =>
      admin
        .post('/employees')
        .send({ empNumber: 3, firstName: 'New', lastName: 'One' });
    expect((await add()).status).toBe(403);
    await admin.patch(`/employees/${amine._id}/archive`);
    expect((await add()).status).toBe(201);
  });

  it('restoring needs a free place', async () => {
    const { admin, amine } = await limited(2);
    await admin.patch(`/employees/${amine._id}/archive`);
    await admin
      .post('/employees')
      .send({ empNumber: 3, firstName: 'New', lastName: 'One' });
    const res = await admin.patch(`/employees/${amine._id}/restore`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Your pack is full: it has no room for another employee. Contact us to upgrade',
    );
    expect((await admin.get('/employees?status=archived')).body).toHaveLength(
      1,
    );
  });

  it('restoring an employee who is not archived changes nothing and needs no place', async () => {
    const { admin, amine } = await limited(2);
    expect((await admin.patch(`/employees/${amine._id}/restore`)).status).toBe(
      200,
    );
  });
});

describe('archiving a post (task)', () => {
  async function withTasks() {
    const ctx = await setup();
    const grill = await seed.task(ctx.company.id, {
      taskId: 1,
      taskName: 'Grill',
    });
    const till = await seed.task(ctx.company.id, {
      taskId: 2,
      taskName: 'Till',
    });
    return { ...ctx, grill, till };
  }

  it('archives and restores, and lists by status', async () => {
    const { admin, grill } = await withTasks();
    const res = await admin.patch(`/tasks/${grill._id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ taskName: 'Grill', isArchived: true });
    const names = async (query = '') =>
      (await admin.get(`/tasks${query}`)).body.map((x: any) => x.taskName);
    expect(await names()).toEqual(['Grill', 'Till']);
    expect(await names('?status=active')).toEqual(['Till']);
    expect(await names('?status=archived')).toEqual(['Grill']);
    expect(
      (await admin.patch(`/tasks/${grill._id}/restore`)).body.isArchived,
    ).toBe(false);
    expect(await names('?status=active')).toEqual(['Grill', 'Till']);
  });

  it('refuses an unknown status, and an unknown post', async () => {
    const { admin } = await withTasks();
    expect((await admin.get('/tasks?status=x')).status).toBe(400);
    expect((await admin.patch(`/tasks/${unknownId()}/archive`)).status).toBe(
      404,
    );
    expect((await admin.patch('/tasks/nope/restore')).status).toBe(404);
  });

  it("can't be done through a normal edit", async () => {
    const { admin, grill } = await withTasks();
    const res = await admin
      .put(`/tasks/${grill._id}`)
      .send({ isArchived: true, taskName: 'Grill 2' });
    expect(res.body).toMatchObject({ taskName: 'Grill 2', isArchived: false });
  });

  it('deletes a post never used, refuses one used in the planning', async () => {
    const { admin, company, amine, grill, till } = await withTasks();
    const shift = await seed.shift(company.id);
    await seed.planning(company.id, {
      empId: String(amine._id),
      shiftId: String(shift._id),
      planDate: day('2026-10-05'),
      taskId: 1,
    });
    const used = await admin.delete(`/tasks/${grill._id}`);
    expect(used.status).toBe(409);
    expect(used.body.message).toBe(
      'This post is used in the planning: archive it instead of deleting it',
    );
    expect((await admin.delete(`/tasks/${till._id}`)).status).toBe(200);
    expect(
      (await admin.get('/tasks')).body.map((x: any) => x.taskName),
    ).toEqual(['Grill']);
    expect((await admin.delete(`/tasks/${unknownId()}`)).status).toBe(404);
    expect((await admin.delete('/tasks/nope')).status).toBe(404);
  });
});

describe('archiving a user', () => {
  it('archives: the account is signed out and can no longer sign in', async () => {
    const { company, admin } = await setup();
    const account = await seed.user('manager', company.id);
    const manager = await loginAs(t, account);
    expect((await manager.get('/auth/me')).status).toBe(200);

    const res = await admin.patch(`/users/${account.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isArchived: true, active: false });
    expect((await manager.get('/auth/me')).status).toBe(401);
    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(login.status).toBe(401);
    // Still listed, flagged, for the Users page and the activity log
    const listed = (await admin.get('/users')).body.find(
      (u: any) => u.email === account.email,
    );
    expect(listed).toMatchObject({ isArchived: true, active: false });
  });

  it('restores: the account can sign in again', async () => {
    const { company, admin } = await setup();
    const account = await seed.user('manager', company.id);
    await admin.patch(`/users/${account.id}/archive`);
    const res = await admin.patch(`/users/${account.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isArchived: false, active: true });
    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("an admin can't archive themself, nor the last active admin", async () => {
    const { admin, adminUser, company } = await setup();
    const own = await admin.patch(`/users/${adminUser.id}/archive`);
    expect(own.status).toBe(400);
    expect(own.body.message).toBe('You cannot remove your own admin access');

    const second = await seed.user('admin', company.id);
    expect((await admin.patch(`/users/${second.id}/archive`)).status).toBe(200);
    expect((await admin.get('/auth/me')).status).toBe(200);
  });

  it('is for admins only, in their own company', async () => {
    const a = await setup();
    const b = await setup();
    const target = await seed.user('manager', a.company.id);
    const manager = await loginAs(t, await seed.user('manager', a.company.id));
    expect((await manager.patch(`/users/${target.id}/archive`)).status).toBe(
      403,
    );
    expect((await b.admin.patch(`/users/${target.id}/archive`)).status).toBe(
      404,
    );
    expect((await a.admin.patch(`/users/${unknownId()}/restore`)).status).toBe(
      404,
    );
  });
});
