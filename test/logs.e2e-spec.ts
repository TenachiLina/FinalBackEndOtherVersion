import { Types } from 'mongoose';
import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, PASSWORD, seeder } from './helpers/seed';
import { PlanningService } from '../src/planning/planning.service';

// The activity log (who changed what) and the system error log.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

/** Log entries are written after the answer is sent: wait for them. */
async function waitFor<T>(
  find: () => Promise<T | null | undefined>,
  ms = 3000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const found = await find();
    if (found) return found;
    if (Date.now() > until)
      throw new Error('timed out waiting for a log entry');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const logEntry = (filter: object) =>
  waitFor(() => t.model('AuditLog').findOne(filter).lean<any>());
const errorEntry = (filter: object) =>
  waitFor(() => t.model('ErrorLog').findOne(filter).lean<any>());

async function setup() {
  const company = await seed.company();
  const adminUser = await seed.user('admin', company.id, { name: 'Boss' });
  const admin = await loginAs(t, adminUser);
  return { company, adminUser, admin };
}

describe('the activity log', () => {
  it('records a change with who did it, on what, and what changed', async () => {
    const { company, adminUser, admin } = await setup();
    const created = await admin.post('/employees').send({
      empNumber: 3,
      firstName: 'Ali',
      lastName: 'Ben',
      baseSalary: 1000,
    });
    const id = created.body._id;
    await admin.put(`/employees/${id}`).send({ baseSalary: 1200 });

    const entry = await logEntry({ action: 'employee.update', targetId: id });
    expect(entry).toMatchObject({
      companyId: new Types.ObjectId(company.id),
      userId: new Types.ObjectId(adminUser.id),
      userName: 'Boss',
      userRole: 'admin',
      method: 'PUT',
      path: `/employees/${id}`,
      target: 'Ali Ben (#3)',
      success: true,
      changes: [{ label: 'Base salary', before: '1000', after: '1200' }],
      details: { baseSalary: 1200 },
    });
    expect(await logEntry({ action: 'employee.create' })).toMatchObject({
      target: 'Ali Ben (#3)',
    });
  });

  it('records a refused change with its status and reason', async () => {
    const { company, admin } = await setup();
    const shift = await seed.shift(company.id, {
      startTime: '06:00',
      endTime: '14:00',
    });
    await admin.delete(`/shifts/${shift._id}`);
    await admin.delete(`/shifts/${shift._id}`);
    const entry = await logEntry({
      action: 'shift.delete',
      success: false,
      companyId: new Types.ObjectId(company.id),
    });
    expect(entry).toMatchObject({ statusCode: 404, error: 'Shift not found' });
  });

  it.each([
    [{ empNumber: 5 }, 400],
    [{ empNumber: 6, firstName: 'C', lastName: 'D' }, 409],
  ])(
    'logs the refused employee %j with the status the user saw (%d)',
    async (body, status) => {
      const { company, admin } = await setup();
      await seed.employee(company.id, { empNumber: 6 });
      const res = await admin.post('/employees').send(body);
      expect(res.status).toBe(status);
      const entry = await logEntry({
        action: 'employee.create',
        success: false,
        companyId: new Types.ObjectId(company.id),
      });
      expect(entry.statusCode).toBe(status);
      expect(entry.error).not.toMatch(/Path `|E11000/);
      expect(entry.error).toContain(
        status === 400
          ? 'First name is required'
          : 'The employee number "6" is already used',
      );
    },
  );

  it('keeps the real error of a crash, not the generic message', async () => {
    const { company, admin } = await setup();
    const crash = jest
      .spyOn(t.app.get(PlanningService), 'copyMonth')
      .mockRejectedValueOnce(new TypeError('Boom in the planning'));
    const res = await admin.post('/planning/copy-month').send({});
    crash.mockRestore();
    expect(res.status).toBe(500);
    const entry = await logEntry({
      action: 'planning.copyMonth',
      success: false,
      companyId: new Types.ObjectId(company.id),
    });
    expect(entry).toMatchObject({
      statusCode: 500,
      error: 'Boom in the planning',
    });
  });

  it('keeps passwords out of the log', async () => {
    const { admin } = await setup();
    await admin
      .post('/users')
      .send({ email: 'log@test.dz', name: 'Logged', password: 'Good-pass-42' });
    const entry = await logEntry({ action: 'user.create' });
    expect(entry.details).toEqual({ email: 'log@test.dz', name: 'Logged' });
  });

  it('does not record reads', async () => {
    const { company, admin } = await setup();
    await admin.get('/employees');
    await admin.post('/tasks').send({ taskId: 1, taskName: 'x' });
    await logEntry({
      action: 'task.create',
      companyId: new Types.ObjectId(company.id),
    });
    expect(
      await t
        .model('AuditLog')
        .countDocuments({ companyId: company.id, method: 'GET' }),
    ).toBe(0);
  });

  it('records sign-ins, and a failed one on the account it was for', async () => {
    const { company } = await setup();
    const mia = await seed.user('manager', company.id, { name: 'Mia' });
    await api(t.app)
      .post('/auth/login')
      .send({ email: mia.email, password: PASSWORD });
    await api(t.app)
      .post('/auth/login')
      .send({ email: mia.email, password: 'Wrong-pass-1' });
    await api(t.app)
      .post('/auth/login')
      .send({ email: 'stranger@test.dz', password: 'x' });

    expect(
      await logEntry({
        action: 'auth.login',
        userEmail: mia.email,
        success: true,
      }),
    ).toMatchObject({
      companyId: new Types.ObjectId(company.id),
      userName: 'Mia',
    });
    const failed = await logEntry({
      action: 'auth.login',
      userEmail: mia.email,
      success: false,
    });
    expect(failed).toMatchObject({
      statusCode: 401,
      userId: new Types.ObjectId(mia.id),
    });
    expect(failed.details).toBeUndefined();
    expect(
      await logEntry({ action: 'auth.login', userEmail: 'stranger@test.dz' }),
    ).toMatchObject({ companyId: null, userId: null });
  });

  it('logs clock-ins as clock-ins', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, {
      empNumber: 9,
      firstName: 'Sara',
      lastName: 'B',
    });
    const { _id } = (
      await admin.post('/worktime').send({ emp_id: 9, work_date: '2026-10-20' })
    ).body;
    await admin
      .put(`/worktime/${_id}`)
      .set('X-Audit-As', 'clock')
      .send({ clock_in: '08:01' });
    expect(
      await logEntry({ action: 'worktime.clockIn', targetId: _id }),
    ).toMatchObject({
      target: 'Sara B (#9) · 2026-10-20',
      changes: [{ label: 'Clock-in time', after: '08:01' }],
    });
  });

  describe('GET /audit-logs', () => {
    async function withEntries() {
      const { company, adminUser, admin } = await setup();
      const elsewhere = `Elsewhere ${company.id}`;
      const other = await seed.company();
      const now = new Date();
      const base = {
        method: 'POST',
        path: '/x',
        success: true,
        createdAt: now,
      };
      await t.model('AuditLog').collection.insertMany([
        {
          ...base,
          companyId: new Types.ObjectId(company.id),
          userId: new Types.ObjectId(adminUser.id),
          userName: 'Boss',
          action: 'employee.create',
          target: 'Ali Ben',
        },
        {
          ...base,
          companyId: new Types.ObjectId(company.id),
          userId: new Types.ObjectId(adminUser.id),
          userName: 'Boss',
          action: 'employee.delete',
          target: 'Sam Lee',
          success: false,
        },
        {
          ...base,
          companyId: new Types.ObjectId(company.id),
          userId: null,
          userName: 'Robot',
          action: 'shift.create',
          target: 'Shift 08:00–16:00',
        },
        {
          ...base,
          companyId: new Types.ObjectId(other.id),
          userId: null,
          action: 'employee.create',
          target: elsewhere,
        },
      ]);
      return { company, adminUser, admin, elsewhere };
    }
    // The admin's own sign-in is in the log too
    const targets = (res: any) =>
      res.body.items
        .filter((i: any) => i.action !== 'auth.login')
        .map((i: any) => i.target)
        .sort();

    it("shows an admin their own company's log, filtered", async () => {
      const { adminUser, admin } = await withEntries();
      const all = await admin.get('/audit-logs');
      expect(targets(all)).toEqual(['Ali Ben', 'Sam Lee', 'Shift 08:00–16:00']);
      expect(targets(await admin.get('/audit-logs?action=employee'))).toEqual([
        'Ali Ben',
        'Sam Lee',
      ]);
      expect(
        targets(await admin.get('/audit-logs?action=employee.delete')),
      ).toEqual(['Sam Lee']);
      expect(targets(await admin.get('/audit-logs?status=failed'))).toEqual([
        'Sam Lee',
      ]);
      expect(targets(await admin.get('/audit-logs?status=success'))).toEqual([
        'Ali Ben',
        'Shift 08:00–16:00',
      ]);
      expect(targets(await admin.get('/audit-logs?search=ali'))).toEqual([
        'Ali Ben',
      ]);
      expect(targets(await admin.get('/audit-logs?search=(.*'))).toEqual([]);
      expect(
        targets(await admin.get(`/audit-logs?userId=${adminUser.id}`)),
      ).toEqual(['Ali Ben', 'Sam Lee']);
      expect(await admin.get('/audit-logs?limit=1&page=2')).toMatchObject({
        body: { total: 4, page: 2, limit: 1, items: [expect.anything()] },
      });
    });

    it('lists who appears in the log', async () => {
      const { adminUser, admin } = await withEntries();
      expect((await admin.get('/audit-logs/users')).body).toEqual([
        expect.objectContaining({ id: adminUser.id, name: 'Boss' }),
      ]);
    });

    it('shows the super admin every company, or the one picked', async () => {
      const { company, elsewhere } = await withEntries();
      const sa = await loginAs(t, await seed.user('superadmin', null));
      expect((await sa.get(`/audit-logs?search=${elsewhere}`)).body.total).toBe(
        1,
      );
      const inside = await loginAs(t, await seed.user('superadmin', null), {
        companyId: company.id,
      });
      expect(
        (await inside.get(`/audit-logs?search=${elsewhere}`)).body.total,
      ).toBe(0);
    });

    it('filters by day', async () => {
      const { company, admin } = await setup();
      await t.model('AuditLog').collection.insertMany([
        {
          companyId: new Types.ObjectId(company.id),
          action: 'x',
          method: 'POST',
          path: '/x',
          target: 'noon',
          createdAt: new Date('2026-10-20T11:00:00Z'),
        },
        {
          companyId: new Types.ObjectId(company.id),
          action: 'x',
          method: 'POST',
          path: '/x',
          target: 'next day',
          createdAt: new Date('2026-10-21T11:00:00Z'),
        },
      ]);
      expect(
        targets(await admin.get('/audit-logs?from=2026-10-20&to=2026-10-20')),
      ).toEqual(['noon']);
      expect(targets(await admin.get('/audit-logs?from=2026-10-21'))).toContain(
        'next day',
      );
    });

    it("filters days in the company's time zone", async () => {
      const { company, admin } = await setup();
      await t.model('AuditLog').collection.insertOne({
        companyId: new Types.ObjectId(company.id),
        action: 'x',
        method: 'POST',
        path: '/x',
        target: 'just after midnight in Algeria',
        createdAt: new Date('2026-10-19T23:30:00Z'), // 20 Oct, 00:30 in Algeria
      });
      expect(
        targets(await admin.get('/audit-logs?from=2026-10-20&to=2026-10-20')),
      ).toEqual(['just after midnight in Algeria']);
      expect(
        targets(await admin.get('/audit-logs?from=2026-10-19&to=2026-10-19')),
      ).toEqual([]);
    });

    it('stays in UTC for the super admin outside any company', async () => {
      const { company } = await setup();
      const target = `midnight ${new Types.ObjectId().toString()}`;
      await t.model('AuditLog').collection.insertOne({
        companyId: new Types.ObjectId(company.id),
        action: 'x',
        method: 'POST',
        path: '/x',
        target,
        createdAt: new Date('2026-10-19T23:30:00Z'),
      });
      const sa = await loginAs(t, await seed.user('superadmin', null));
      const found = (day: string) =>
        sa.get(`/audit-logs?from=${day}&to=${day}&search=${target}`);
      expect((await found('2026-10-19')).body.total).toBe(1);
      expect((await found('2026-10-20')).body.total).toBe(0);
    });
  });
});

describe('the error log', () => {
  it('saves a server crash with a reference the user can quote, and the request', async () => {
    const { adminUser, admin } = await setup();
    const crash = jest
      .spyOn(t.app.get(PlanningService), 'copyMonth')
      .mockRejectedValueOnce(new TypeError('Boom in the planning'));
    const res = await admin.post('/planning/copy-month').send({});
    crash.mockRestore();
    expect(res.status).toBe(500);
    const entry = await errorEntry({ reference: res.body.reference });
    expect(entry).toMatchObject({
      level: 'error',
      source: 'request',
      name: 'TypeError',
      statusCode: 500,
      method: 'POST',
      path: '/planning/copy-month',
      userId: new Types.ObjectId(adminUser.id),
      where: expect.stringContaining('logs.e2e-spec.ts'),
    });
  });

  it('saves a refusal as a warning, but not an expired session', async () => {
    const { admin } = await setup();
    await admin.get('/users/nope/x');
    await admin.post('/employees').send({});
    await api(t.app).get('/employees');
    const warning = await errorEntry({ statusCode: 400, path: '/employees' });
    expect(warning).toMatchObject({
      level: 'warning',
      message: expect.stringContaining('is required'),
    });
    expect(await t.model('ErrorLog').countDocuments({ statusCode: 401 })).toBe(
      0,
    );
  });

  it('saves pages that crashed in the browser', async () => {
    const { company } = await setup();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    const res = await kiosk.post('/error-logs/client').send({
      name: 'ChunkLoadError',
      message: 'Loading chunk 3 failed',
      pageUrl: 'https://app/kiosk',
      digest: 'abc',
      stack: 's'.repeat(7000),
    });
    expect(res.status).toBe(204);
    const entry = await errorEntry({
      source: 'frontend',
      pageUrl: 'https://app/kiosk',
    });
    expect(entry).toMatchObject({
      name: 'ChunkLoadError',
      code: 'abc',
      userRole: 'employee',
      hint: expect.stringMatching(/Reloading/),
    });
    expect(entry.stack).toHaveLength(6000);
    expect(
      await t.model('AuditLog').countDocuments({ path: '/error-logs/client' }),
    ).toBe(0);
  });

  it('saves an empty browser report as "Unknown error"', async () => {
    const { company } = await setup();
    const manager = await loginAs(t, await seed.user('manager', company.id));
    await manager
      .post('/error-logs/client')
      .send({ pageUrl: 'https://app/empty' });
    expect(await errorEntry({ pageUrl: 'https://app/empty' })).toMatchObject({
      name: 'Error',
      message: 'Unknown error',
    });
  });

  describe('for the super admin', () => {
    async function withErrors() {
      const a = await seed.company();
      const b = await seed.company();
      const now = new Date();
      const row = (companyId: string, over: object) => ({
        companyId: new Types.ObjectId(companyId),
        level: 'error',
        source: 'request',
        name: 'TypeError',
        message: 'x',
        fingerprint: 'f1',
        createdAt: now,
        ...over,
      });
      await t.model('ErrorLog').collection.insertMany([
        row(a.id, {
          reference: 'AAAA1111',
          message: 'Boom in planning',
          userId: new Types.ObjectId(),
        }),
        row(a.id, {
          message: 'Boom in planning',
          userId: new Types.ObjectId(),
        }),
        row(a.id, {
          level: 'warning',
          fingerprint: 'f2',
          message: 'Refused',
        }),
        row(b.id, {
          fingerprint: 'f3',
          message: 'Other company',
          source: 'frontend',
        }),
        row(a.id, {
          fingerprint: 'old',
          message: 'Long ago',
          createdAt: new Date(Date.now() - 30 * 86_400_000),
        }),
      ]);
      return { a, b };
    }

    it('finds errors by reference, text, level, source, fingerprint and day', async () => {
      const { a } = await withErrors();
      const sa = await loginAs(t, await seed.user('superadmin', null), {
        companyId: a.id,
      });
      const count = async (q: string) =>
        (await sa.get(`/error-logs?${q}`)).body.total;
      expect(await count('')).toBe(4);
      expect(await count('search=aaaa1111')).toBe(1);
      expect(await count('search=boom')).toBe(2);
      expect(await count('level=warning')).toBe(1);
      expect(await count('source=frontend')).toBe(0);
      expect(await count('fingerprint=f1')).toBe(2);
      // Today on the company's clock (UTC+1)
      const today = new Date(Date.now() + 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      expect(await count(`from=${today}&to=${today}`)).toBe(3);
      expect((await sa.get('/error-logs?limit=1')).body.items).toHaveLength(1);
    });

    it("filters days in the company's time zone", async () => {
      const { a } = await withErrors();
      await t.model('ErrorLog').collection.insertOne({
        companyId: new Types.ObjectId(a.id),
        level: 'error',
        message: 'just after midnight in Algeria',
        createdAt: new Date('2026-10-19T23:30:00Z'), // 20 Oct, 00:30 in Algeria
      });
      const sa = await loginAs(t, await seed.user('superadmin', null), {
        companyId: a.id,
      });
      const total = async (day: string) =>
        (await sa.get(`/error-logs?from=${day}&to=${day}`)).body.total;
      expect(await total('2026-10-20')).toBe(1);
      expect(await total('2026-10-19')).toBe(0);
    });

    it('groups the last 7 days by error, errors first, with the people affected', async () => {
      const { a } = await withErrors();
      const sa = await loginAs(t, await seed.user('superadmin', null), {
        companyId: a.id,
      });
      const res = await sa.get('/error-logs/summary');
      expect(res.body.days).toBe(7);
      expect(res.body.groups).toEqual([
        expect.objectContaining({
          fingerprint: 'f1',
          count: 2,
          level: 'error',
          affectedUsers: 2,
        }),
        expect.objectContaining({
          fingerprint: 'f2',
          count: 1,
          level: 'warning',
          affectedUsers: 0,
        }),
      ]);
    });

    it('sees every company when none is picked', async () => {
      await withErrors();
      const sa = await loginAs(t, await seed.user('superadmin', null));
      expect(
        (await sa.get('/error-logs?search=Other company')).body.total,
      ).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("when a log entry can't be written", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([[new Error('disk full')], ['not an Error']])(
    "the user's change still goes through (%s)",
    async (failure) => {
      const { admin } = await setup();
      jest.spyOn(t.model('AuditLog'), 'create').mockRejectedValue(failure);
      const res = await admin.post('/employees').send({
        empNumber: 501,
        firstName: 'Ali',
        lastName: 'Ben',
        baseSalary: 1,
      });
      expect(res.status).toBe(201);
      await new Promise((r) => setTimeout(r, 100));
    },
  );

  it.each([[new Error('disk full')], ['not an Error']])(
    'a crash report from the browser is still answered (%s)',
    async (failure) => {
      const { admin } = await setup();
      jest.spyOn(t.model('ErrorLog'), 'create').mockRejectedValue(failure);
      const res = await admin
        .post('/error-logs/client')
        .send({ name: 'Error', message: 'boom', pageUrl: 'https://app/x' });
      expect(res.status).toBe(204);
      await new Promise((r) => setTimeout(r, 100));
    },
  );
});
