import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';
import { runAsSystem } from '../src/tenancy/tenant-context';
import { localNow } from '../src/notifications/notifications.util';

// The bell: alerts worked out from today's planning and clocking, the month
// about to close, the subscription and the clocking machines. Only "read"
// marks are stored, per user.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const DAY = 86_400_000;

// A time zone where it is about midday right now, so "a shift that started
// this morning" exists whenever the tests run.
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
  const amine = await seed.employee(company.id, {
    empNumber: 1,
    firstName: 'Amine',
    lastName: 'Bensalah',
  });
  const sara = await seed.employee(company.id, {
    empNumber: 2,
    firstName: 'Sara',
    lastName: 'Haddad',
  });
  const morning = await seed.shift(company.id, {
    startTime: '08:00',
    endTime: '16:00',
  });
  const plan = (
    employee: { _id: unknown },
    extra: Record<string, unknown> = {},
  ) =>
    seed.planning(company.id, {
      empId: String(employee._id),
      shiftId: String(morning._id),
      planDate: todayDate(),
      ...extra,
    });
  return { company, admin, amine, sara, morning, plan };
}

const types = (res: { body: { items: { type: string }[] } }) =>
  res.body.items.map((i) => i.type);

describe('GET /notifications', () => {
  it('is empty when there is nothing to tell', async () => {
    const { admin } = await setup();
    const res = await admin.get('/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], unread: 0 });
  });

  it('tells who is planned this morning and has not clocked in', async () => {
    const { admin, amine, sara, plan, company } = await setup();
    await plan(amine);
    await plan(sara);
    await seed.worktime(company.id, {
      emp_id: 2,
      work_date: todayDate(),
      clock_in: '08:00',
    });
    const res = await admin.get('/notifications');
    expect(res.body.unread).toBe(1);
    expect(res.body.items).toEqual([
      {
        key: expect.stringMatching(new RegExp(`^missing:${today()}:1-`)),
        type: 'missing',
        level: 'danger',
        params: { count: 1, names: ['Amine Bensalah'], day: today() },
        href: '/clockinpagehistory',
        read: false,
      },
    ]);
  });

  it('does not report a shift that starts later today', async () => {
    const { admin, amine, plan } = await setup();
    await plan(amine, { customStartTime: '23:30' });
    expect((await admin.get('/notifications')).body.items).toEqual([]);
  });

  it('tells who arrived late and who is absent', async () => {
    const { admin, company } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: todayDate(),
      clock_in: '08:25',
      late_minutes: '25',
    });
    await seed.worktime(company.id, {
      emp_id: 2,
      work_date: todayDate(),
      absent: true,
      absent_comment: 'Sick',
    });
    const res = await admin.get('/notifications');
    expect(types(res)).toEqual(['late', 'absent']);
    expect(res.body.items[0].params).toMatchObject({
      count: 1,
      names: ['Amine Bensalah'],
    });
    expect(res.body.items[1].params).toMatchObject({
      count: 1,
      names: ['Sara Haddad'],
    });
    expect(res.body.items.map((i: any) => i.level)).toEqual([
      'warning',
      'warning',
    ]);
  });

  it("ignores yesterday's records, archived employees and other companies", async () => {
    const { admin, company, amine, sara, plan } = await setup();
    await seed.worktime(company.id, {
      emp_id: 1,
      work_date: new Date(todayDate().getTime() - DAY),
      clock_in: '09:00',
      late_minutes: '60',
    });
    await plan(sara);
    await admin.patch(`/employees/${sara._id}/archive`);
    const other = await setup();
    await other.plan(other.amine);
    expect((await admin.get('/notifications')).body.items).toEqual([]);
    expect(types(await other.admin.get('/notifications'))).toEqual(['missing']);
    expect(amine).toBeDefined();
  });

  it('says nothing about attendance when clock-in is off for the company', async () => {
    const { admin, amine, plan } = await setup({
      features: ['planning', 'reporting'],
    });
    await plan(amine);
    expect((await admin.get('/notifications')).body.items).toEqual([]);
  });

  it('points to the clock-in page when the history page is switched off', async () => {
    const { admin, amine, plan } = await setup({
      disabledPages: ['clockinHistory'],
    });
    await plan(amine);
    expect((await admin.get('/notifications')).body.items[0].href).toBe(
      '/clockinpage',
    );
  });

  it("a manager is told about attendance, not about the other managers nor the admin's matters", async () => {
    const { company, amine, sara, plan } = await setup({
      subscription: {
        packName: 'Pro',
        status: 'active',
        startsAt: new Date(Date.now() - 30 * DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
        payments: [],
      },
    });
    await plan(amine);
    await plan(sara);
    const me = await seed.user('manager', company.id);
    await seed.user('manager', company.id, { employeeId: String(sara._id) });
    const res = await (await loginAs(t, me)).get('/notifications');
    expect(types(res)).toEqual(['missing']);
    expect(res.body.items[0].params).toMatchObject({
      count: 1,
      names: ['Amine Bensalah'],
    });
  });

  it('is for admins and managers', async () => {
    const { company } = await setup();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    expect((await kiosk.get('/notifications')).status).toBe(403);
    const staff = await loginAs(t, await seed.user('staff', company.id));
    expect((await staff.get('/notifications')).status).toBe(403);
  });
});

describe("the admin's matters", () => {
  it('warns that the subscription ends soon, then that it has ended', async () => {
    const sub = (endsAt: Date) => ({
      subscription: {
        packName: 'Pro',
        status: 'active',
        startsAt: new Date(Date.now() - 30 * DAY),
        endsAt,
        payments: [],
      },
    });
    const soon = await setup(sub(new Date(Date.now() + 3 * DAY + 60_000)));
    const res = await soon.admin.get('/notifications');
    expect(res.body.items).toEqual([
      {
        key: expect.stringMatching(/^subscription:ending:\d{4}-\d{2}-\d{2}$/),
        type: 'subscriptionEnding',
        level: 'warning',
        params: { endsAt: expect.any(String), daysLeft: 3, kind: 'active' },
        href: '/company-settings',
        read: false,
      },
    ]);
    const ended = await setup(sub(new Date(Date.now() - DAY)));
    const after = await ended.admin.get('/notifications');
    expect(after.body.items[0]).toMatchObject({
      type: 'subscriptionEnded',
      level: 'danger',
    });
    const far = await setup(sub(new Date(Date.now() + 40 * DAY)));
    expect((await far.admin.get('/notifications')).body.items).toEqual([]);
  });

  it('announces that last month closes by itself within 3 days', async () => {
    // Days since the end of last month, in the company's time zone
    const [y, m] = today().split('-').map(Number);
    const monthStart = Date.UTC(y, m - 1, 1) - hours * 3_600_000;
    const daysIn = Math.floor((Date.now() - monthStart) / DAY);
    const previous = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);

    const { admin } = await setup({
      settings: { utcOffset: OFFSET, monthCloseDelayDays: daysIn + 2 },
    });
    const res = await admin.get('/notifications');
    expect(res.body.items).toEqual([
      {
        key: `closing:${previous}`,
        type: 'monthClosing',
        level: 'info',
        params: {
          month: previous,
          closesAt: expect.any(String),
          daysLeft: expect.any(Number),
        },
        href: '/reporting/monthly-payroll',
        read: false,
      },
    ]);
    expect(res.body.items[0].params.daysLeft).toBeLessThanOrEqual(2);

    const later = await setup({
      settings: { utcOffset: OFFSET, monthCloseDelayDays: daysIn + 10 },
    });
    expect((await later.admin.get('/notifications')).body.items).toEqual([]);
    const never = await setup();
    expect((await never.admin.get('/notifications')).body.items).toEqual([]);
  });

  it('reports a clocking machine that stopped talking, not one that never connected', async () => {
    const { admin, company } = await setup({
      devices: [
        { serial: 'SN-OLD', name: 'Entrance' },
        { serial: 'SN-LIVE' },
        { serial: 'SN-NEVER' },
      ],
    });
    const stopped = new Date(Date.now() - 2 * 3_600_000);
    await runAsSystem(async () => {
      await t.model('Company').updateOne(
        { _id: company.id },
        {
          $set: {
            'devices.0.lastSeenAt': stopped,
            'devices.1.lastSeenAt': new Date(Date.now() - 60_000),
          },
        },
      );
    });
    const root = await loginAs(t, await seed.user('superadmin', null));
    await root.get(`/companies/${company.id}`); // read fresh, past the guard's cache
    const res = await admin.get('/notifications');
    expect(res.body.items).toEqual([
      {
        key: `device:SN-OLD:${stopped.toISOString()}`,
        type: 'deviceSilent',
        level: 'danger',
        params: { name: 'Entrance', lastSeenAt: stopped.toISOString() },
        href: '/clockinpagehistory',
        read: false,
      },
    ]);
  });
});

describe('a clocking machine is remembered when it talks', () => {
  it('notes the time of its last request, and keeps it when the list is saved', async () => {
    const company = await seed.company({
      devices: [{ serial: 'SN-PING', name: 'Door' }],
    });
    const root = await loginAs(t, await seed.user('superadmin', null));
    const ping = await root.get('/iclock/ping?SN=SN-PING');
    expect(ping.status).toBe(200);
    const read = async () =>
      (await root.get(`/companies/${company.id}`)).body.devices[0].lastSeenAt;
    let seen = await read();
    for (let i = 0; i < 30 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 100));
      seen = await read();
    }
    expect(new Date(seen).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const saved = await root.patch(`/companies/${company.id}`).send({
      devices: [
        { serial: 'SN-PING', name: 'Front door' },
        { serial: 'SN-NEW' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.devices[0]).toMatchObject({
      name: 'Front door',
      lastSeenAt: seen,
    });
    expect(saved.body.devices[1].lastSeenAt).toBeUndefined();
  });
});

describe('POST /notifications/read', () => {
  it('marks alerts as read for this user only, and an alert that changes comes back', async () => {
    const { admin, company, amine, sara, plan } = await setup();
    await plan(amine);
    const first = await admin.get('/notifications');
    const key = first.body.items[0].key;

    const res = await admin
      .post('/notifications/read')
      .send({ keys: [key, key] });
    expect(res.status).toBe(204);
    const after = await admin.get('/notifications');
    expect(after.body).toMatchObject({ unread: 0 });
    expect(after.body.items[0]).toMatchObject({ key, read: true });

    // Another user still has it unread
    const second = await loginAs(t, await seed.user('admin', company.id));
    expect((await second.get('/notifications')).body.unread).toBe(1);

    // One more person missing: a new alert, unread again
    await plan(sara);
    const changed = await admin.get('/notifications');
    expect(changed.body.unread).toBe(1);
    expect(changed.body.items[0].key).not.toBe(key);
    expect(changed.body.items[0].params.count).toBe(2);
  });

  it('marking twice is fine', async () => {
    const { admin } = await setup();
    expect(
      (
        await admin
          .post('/notifications/read')
          .send({ keys: ['late:2026-01-01:1-x'] })
      ).status,
    ).toBe(204);
    expect(
      (
        await admin
          .post('/notifications/read')
          .send({ keys: ['late:2026-01-01:1-x'] })
      ).status,
    ).toBe(204);
    expect(
      (await admin.post('/notifications/read').send({ keys: [] })).status,
    ).toBe(204);
  });

  it.each([
    {},
    { keys: 'all' },
    { keys: [1] },
    { keys: [''] },
    { keys: ['k'.repeat(201)] },
  ])('refuses %j', async (body) => {
    const { admin } = await setup();
    const res = await admin.post('/notifications/read').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('keys must be a list of notification keys');
  });

  it('still works after the subscription ended (the account is read-only)', async () => {
    const { admin } = await setup({
      subscription: {
        packName: 'Pro',
        status: 'active',
        startsAt: new Date(Date.now() - 60 * DAY),
        endsAt: new Date(Date.now() - DAY),
        payments: [],
      },
    });
    const list = await admin.get('/notifications');
    const res = await admin
      .post('/notifications/read')
      .send({ keys: [list.body.items[0].key] });
    expect(res.status).toBe(204);
    expect((await admin.get('/notifications')).body.unread).toBe(0);
  });
});
