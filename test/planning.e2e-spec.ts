import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { runForCompany } from '../src/tenancy/tenant-context';
import { setNow, withTimeZone } from './helpers/time';
import { download, excelRows, pdfPages, pdfText } from './helpers/files';

// The planning: who works which shift and post on which day, saving a day,
// importing it, copying a month, and the Excel / PDF exports.
// October 2026 starts on a Thursday: its first Saturday→Friday week is
// Sat 3, Sun 4, Mon 5, Tue 6, Wed 7, Thu 1, Fri 2.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

async function setup() {
  const company = await seed.company();
  const admin = await loginAs(t, await seed.user('admin', company.id));
  const morning = await seed.shift(company.id, {
    startTime: '08:00',
    endTime: '16:00',
  });
  const evening = await seed.shift(company.id, {
    startTime: '16:00',
    endTime: '00:00',
  });
  const ali = await seed.employee(company.id, {
    firstName: 'Ali',
    lastName: 'Ben',
  });
  const sara = await seed.employee(company.id, {
    firstName: 'Sara',
    lastName: 'Kaci',
  });
  const omar = await seed.employee(company.id, {
    firstName: 'Omar',
    lastName: 'Zed',
  });
  const id = (d: { _id: unknown }) => String(d._id);
  const plan = (
    emp: { _id: unknown },
    shift: { _id: unknown },
    planDate: string,
    extra: object = {},
  ) =>
    seed.planning(company.id, {
      empId: id(emp),
      shiftId: id(shift),
      planDate,
      taskId: 1,
      ...extra,
    });
  return { company, admin, morning, evening, ali, sara, omar, id, plan };
}

const names = (res: any) =>
  res.body
    .map((p: any) => `${p.empId?.firstName ?? '?'}@${p.planDate.slice(0, 10)}`)
    .sort();

describe('single entries', () => {
  it('creates, finds by day with employees and shifts filled in, updates and deletes', async () => {
    const { admin, morning, ali, sara, id, plan } = await setup();
    await plan(sara, morning, '2026-10-21');
    const created = await admin.post('/planning').send({
      empId: id(ali),
      shiftId: id(morning),
      taskId: 2,
      planDate: '2026-10-20',
      backupEmpIds: [id(sara)],
      customStartTime: '09:00',
    });
    expect(created.status).toBe(201);

    const day = await admin.get('/planning?planDate=2026-10-20');
    expect(day.body).toHaveLength(1);
    expect(day.body[0]).toMatchObject({
      empId: { firstName: 'Ali' },
      shiftId: { startTime: '08:00' },
      backupEmpIds: [{ firstName: 'Sara' }],
      customStartTime: '09:00',
    });
    expect((await admin.get('/planning')).body).toHaveLength(2);

    const one = await admin.get(`/planning/${created.body._id}`);
    expect(one.body.empId.lastName).toBe('Ben');
    expect(
      (await admin.put(`/planning/${created.body._id}`).send({ taskId: 3 }))
        .body.taskId,
    ).toBe(3);
    expect((await admin.delete(`/planning/${created.body._id}`)).status).toBe(
      200,
    );
    expect((await admin.get('/planning?planDate=2026-10-20')).body).toEqual([]);
  });

  it('leaves out entries whose employee or shift was deleted when listing a day', async () => {
    const { admin, morning, evening, ali, sara, omar, plan } = await setup();
    await plan(ali, morning, '2026-10-20');
    await plan(sara, evening, '2026-10-20');
    await plan(omar, morning, '2026-10-20');
    await admin.delete(`/employees/${ali._id}`);
    await admin.delete(`/shifts/${evening._id}?force=true`);

    // The Clock-in pages read empId._id / shiftId._id of every entry
    const res = await admin.get('/planning?planDate=2026-10-20');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Omar@2026-10-20']);
    expect((await admin.get('/planning')).body).toHaveLength(1);
  });

  it('lists a range of days with from and to, both included', async () => {
    const { admin, morning, ali, sara, omar, plan } = await setup();
    await plan(ali, morning, '2026-10-19');
    await plan(sara, morning, '2026-10-20');
    await plan(omar, morning, '2026-10-22');

    const res = await admin.get('/planning?from=2026-10-19&to=2026-10-21');
    expect(res.status).toBe(200);
    expect(names(res).sort()).toEqual(['Ali@2026-10-19', 'Sara@2026-10-20']);
    expect(
      (await admin.get('/planning?from=2026-10-20&to=nonsense')).status,
    ).toBe(400);
  });

  it('requires an employee, a shift, a task and a date', async () => {
    const { admin } = await setup();
    const res = await admin.post('/planning').send({});
    expect(res.status).toBe(400);
    expect(res.body.message.sort()).toEqual([
      'Date is required',
      'Employee is required',
      'Shift is required',
      'Task number is required',
    ]);
  });

  // BUG-202 (also here): an unknown planning id answers 200 with an empty body
  it.each([['get'], ['put'], ['delete']])(
    '%s /planning/:id with an unknown id → 404',
    async (method) => {
      const { admin } = await setup();
      expect(
        (await (admin as any)[method](`/planning/${unknownId()}`).send({}))
          .status,
      ).toBe(404);
    },
  );

  it("keeps each company's planning apart", async () => {
    const { admin } = await setup();
    const other = await setup();
    await other.plan(other.ali, other.morning, '2026-10-20');
    expect((await admin.get('/planning?planDate=2026-10-20')).body).toEqual([]);
  });
});

describe('saving a day (POST /planning/bulk)', () => {
  const entry = (emp: unknown, shift: unknown, extra: object = {}) => ({
    empId: emp,
    shiftId: shift,
    taskId: 1,
    planDate: '2026-10-20',
    ...extra,
  });

  it("replaces that day's planning and leaves the other days alone", async () => {
    const { admin, morning, evening, ali, sara, omar, id, plan } =
      await setup();
    await plan(ali, morning, '2026-10-20');
    await plan(omar, morning, '2026-10-19');
    await plan(omar, morning, '2026-10-21');

    const res = await admin.post('/planning/bulk').send({
      planDate: '2026-10-20',
      entries: [
        entry(id(sara), id(morning), {
          backupEmpIds: [id(omar), id(sara), id(omar)],
          tasks: [{ label: 'Oven', startTime: '09:00', endTime: '10:00' }],
        }),
        entry(id(ali), id(evening), { taskId: 2 }),
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);

    const day = (await admin.get('/planning?planDate=2026-10-20')).body;
    const saraEntry = day.find((p: any) => p.empId.firstName === 'Sara');
    expect(saraEntry.backupEmpIds.map((b: any) => b.firstName)).toEqual([
      'Omar',
    ]);
    expect(saraEntry.tasks).toEqual([
      { label: 'Oven', startTime: '09:00', endTime: '10:00' },
    ]);
    expect(names(await admin.get('/planning'))).toEqual([
      'Ali@2026-10-20',
      'Omar@2026-10-19',
      'Omar@2026-10-21',
      'Sara@2026-10-20',
    ]);
  });

  it('keeps the same employee in the same cell only once', async () => {
    const { admin, morning, ali, id } = await setup();
    const one = entry(id(ali), id(morning));
    const res = await admin.post('/planning/bulk').send({
      planDate: '2026-10-20',
      entries: [one, one, { ...one, taskId: 2 }],
    });
    expect(res.body).toHaveLength(2);
  });

  it('empties the day when sent no entries', async () => {
    const { admin, morning, ali, plan } = await setup();
    await plan(ali, morning, '2026-10-20');
    expect(
      (
        await admin
          .post('/planning/bulk')
          .send({ planDate: '2026-10-20', entries: [] })
      ).body,
    ).toEqual([]);
    expect((await admin.get('/planning?planDate=2026-10-20')).body).toEqual([]);
  });

  it('does not store a day twice when it is saved twice at once', async () => {
    const { admin, morning, ali, sara, id } = await setup();
    const body = {
      planDate: '2026-10-20',
      entries: [entry(id(ali), id(morning)), entry(id(sara), id(morning))],
    };
    await Promise.all([
      admin.post('/planning/bulk').send(body),
      admin.post('/planning/bulk').send(body),
    ]);
    expect(
      (await admin.get('/planning?planDate=2026-10-20')).body,
    ).toHaveLength(2);
  });

  it('works the same on a server in Algeria', async () => {
    const { admin, morning, ali, omar, id, plan } = await setup();
    await plan(omar, morning, '2026-10-19');
    await plan(omar, morning, '2026-10-21');
    await withTimeZone('Africa/Algiers', async () => {
      await admin.post('/planning/bulk').send({
        planDate: '2026-10-20',
        entries: [entry(id(ali), id(morning))],
      });
      expect(names(await admin.get('/planning'))).toEqual([
        'Ali@2026-10-20',
        'Omar@2026-10-19',
        'Omar@2026-10-21',
      ]);
    });
  });

  it("doesn't touch another company's day", async () => {
    const { admin } = await setup();
    const other = await setup();
    await other.plan(other.ali, other.morning, '2026-10-20');
    await admin
      .post('/planning/bulk')
      .send({ planDate: '2026-10-20', entries: [] });
    expect(
      (await other.admin.get('/planning?planDate=2026-10-20')).body,
    ).toHaveLength(1);
  });

  it.each([
    ['without entries', { planDate: '2026-10-20' }],
    [
      'with entries that are not a list',
      { planDate: '2026-10-20', entries: 'x' },
    ],
    [
      'with an entry that is empty',
      { planDate: '2026-10-20', entries: [null] },
    ],
  ])('refuses a save %s, and keeps the day', async (_name, body) => {
    const { admin, morning, ali, plan } = await setup();
    await plan(ali, morning, '2026-10-20');
    const res = await admin.post('/planning/bulk').send(body);
    expect(res.status).toBe(400);
    expect(
      (await admin.get('/planning?planDate=2026-10-20')).body,
    ).toHaveLength(1);
  });

  it.each([
    ['no date', {}],
    ['an unreadable date', { planDate: 'soon' }],
  ])('refuses a save with %s', async (_name, date) => {
    const { admin } = await setup();
    const res = await admin
      .post('/planning/bulk')
      .send({ ...date, entries: [] });
    expect(res.status).toBe(400);
  });
});

describe('importing a day (GET /planning/import/:date)', () => {
  it('lists the entries with names, backups and sub-tasks', async () => {
    const { admin, morning, ali, sara, id, plan } = await setup();
    await plan(ali, morning, '2026-10-20', {
      backupEmpIds: [id(sara)],
      taskId: 4,
      tasks: [{ label: 'Till' }],
    });
    const res = await admin.get('/planning/import/2026-10-20');
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        empId: id(ali),
        title: 'Ali Ben',
        backups: [{ id: id(sara), title: 'Sara Kaci' }],
        shiftId: id(morning),
        taskId: 4,
        tasks: [{ label: 'Till' }],
      },
    ]);
    expect((await admin.get('/planning/import/2026-10-21')).body).toEqual([]);
  });

  it('skips entries whose employee or shift was deleted', async () => {
    const { admin, morning, evening, ali, sara, plan } = await setup();
    await plan(ali, morning, '2026-10-20');
    await plan(sara, evening, '2026-10-20');
    await admin.delete(`/employees/${ali._id}`);
    await admin.delete(`/shifts/${evening._id}?force=true`);
    const res = await admin.get('/planning/import/2026-10-20');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('keeps the other entries of a day with a deleted employee', async () => {
    const { admin, morning, ali, sara, plan } = await setup();
    await plan(ali, morning, '2026-10-20');
    await plan(sara, morning, '2026-10-20');
    await admin.delete(`/employees/${ali._id}`);
    const res = await admin.get('/planning/import/2026-10-20');
    expect(res.body.map((e: any) => e.title)).toEqual(['Sara Kaci']);
  });
});

describe('copying a month (POST /planning/copy-month)', () => {
  it("copies each weekday's first planning onto every same weekday of the other month", async () => {
    const { admin, morning, evening, ali, sara, plan } = await setup();
    // September 2026: Tue 1 (Ali), Wed 2 (Sara), Tue 8 (Sara: ignored, not the first Tuesday)
    await plan(ali, morning, '2026-09-01', { customStartTime: '09:30' });
    await plan(sara, evening, '2026-09-02');
    await plan(sara, morning, '2026-09-08');

    const res = await admin
      .post('/planning/copy-month')
      .send({ sourceMonth: '2026-09', destinationMonth: '2026-11' });
    // November 2026 has 4 Tuesdays (3, 10, 17, 24) and 4 Wednesdays (4, 11, 18, 25)
    expect(res.body).toEqual({
      message: 'Planning copied successfully.',
      copied: 8,
      sourceMonth: '2026-09',
      destinationMonth: '2026-11',
    });
    const nov = names(await admin.get('/planning')).filter((n: string) =>
      n.includes('2026-11'),
    );
    expect(nov).toEqual(
      [
        'Ali@2026-11-03',
        'Ali@2026-11-10',
        'Ali@2026-11-17',
        'Ali@2026-11-24',
        'Sara@2026-11-04',
        'Sara@2026-11-11',
        'Sara@2026-11-18',
        'Sara@2026-11-25',
      ].sort(),
    );
    const tuesday = (await admin.get('/planning?planDate=2026-11-03')).body[0];
    expect(tuesday.customStartTime).toBe('09:30');
  });

  it('replaces what the destination month had on those weekdays', async () => {
    const { admin, morning, ali, omar, plan } = await setup();
    await plan(ali, morning, '2026-09-01');
    await plan(omar, morning, '2026-11-03');
    await admin
      .post('/planning/copy-month')
      .send({ sourceMonth: '2026-09', destinationMonth: '2026-11' });
    expect(names(await admin.get('/planning?planDate=2026-11-03'))).toEqual([
      'Ali@2026-11-03',
    ]);
  });

  it('copies nothing and changes nothing when the source month is empty', async () => {
    const { admin, morning, omar, plan } = await setup();
    await plan(omar, morning, '2026-11-03');
    const res = await admin
      .post('/planning/copy-month')
      .send({ sourceMonth: '2026-09', destinationMonth: '2026-11' });
    expect(res.body).toMatchObject({
      copied: 0,
      message: 'No planning found in the source month.',
    });
    expect(
      (await admin.get('/planning?planDate=2026-11-03')).body,
    ).toHaveLength(1);
  });

  it('keeps the destination days of weekdays the source month has no planning for', async () => {
    const { admin, morning, ali, omar, plan } = await setup();
    await plan(ali, morning, '2026-09-01'); // only a Tuesday
    await plan(omar, morning, '2026-11-05'); // a Thursday
    await admin
      .post('/planning/copy-month')
      .send({ sourceMonth: '2026-09', destinationMonth: '2026-11' });
    expect(names(await admin.get('/planning?planDate=2026-11-05'))).toEqual([
      'Omar@2026-11-05',
    ]);
  });

  it('uses the earliest day of each weekday, whatever order the days were saved in', async () => {
    const { admin, morning, ali, sara, plan } = await setup();
    await plan(sara, morning, '2026-09-08'); // saved first
    await plan(ali, morning, '2026-09-01');
    await admin
      .post('/planning/copy-month')
      .send({ sourceMonth: '2026-09', destinationMonth: '2026-11' });
    expect(names(await admin.get('/planning?planDate=2026-11-03'))).toEqual([
      'Ali@2026-11-03',
    ]);
  });

  it.each([
    ['nothing', {}],
    [
      'a month that does not exist',
      { sourceMonth: '2026-13', destinationMonth: '2026-11' },
    ],
    [
      'a destination that is not a month',
      { sourceMonth: '2026-09', destinationMonth: 'next' },
    ],
    [
      'a month that is not text',
      { sourceMonth: 202609, destinationMonth: '2026-11' },
    ],
  ])('refuses %s, and changes nothing', async (_name, body) => {
    const { admin, morning, omar, plan } = await setup();
    await plan(omar, morning, '2026-11-03');
    const res = await admin.post('/planning/copy-month').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Choose the month to copy and the month to copy to',
    );
    expect(
      (await admin.get('/planning?planDate=2026-11-03')).body,
    ).toHaveLength(1);
  });
});

describe('deleting a weekday of a month (DELETE /planning/weekday)', () => {
  const del = (admin: any, qs: string) => admin.delete(`/planning/weekday?${qs}`);
  const left = async (admin: any) => names(await admin.get('/planning'));

  it('deletes every Thursday of the month and keeps the other weekdays and months', async () => {
    const { admin, morning, ali, sara, omar, plan } = await setup();
    await plan(ali, morning, '2026-10-01');  // Thu  → deleted
    await plan(sara, morning, '2026-10-22'); // Thu  → deleted
    await plan(omar, morning, '2026-10-02'); // Fri  → kept
    await plan(ali, morning, '2026-11-05');  // Thu in November → kept
    await plan(ali, morning, '2026-09-24');  // Thu in September → kept

    const res = await del(admin, 'year=2026&month=10&weekday=4');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deletedCount: 2 });
    expect(await left(admin)).toEqual(
      ['Omar@2026-10-02', 'Ali@2026-11-05', 'Ali@2026-09-24'].sort(),
    );
  });

  it('deletes all the entries of those days, not just the first one', async () => {
    const { admin, morning, evening, ali, sara, plan } = await setup();
    await plan(ali, morning, '2026-10-01');
    await plan(sara, morning, '2026-10-01');
    await plan(ali, evening, '2026-10-01');

    const res = await del(admin, 'year=2026&month=10&weekday=4');

    expect(res.body.deletedCount).toBe(3);
    expect(await left(admin)).toEqual([]);
  });

  it('stops at the month boundaries', async () => {
    const { admin, morning, ali, sara, omar, plan } = await setup();
    await plan(ali, morning, '2026-11-01');  // Sun, first day of Nov → deleted
    await plan(sara, morning, '2026-10-25'); // Sun, last Sunday of Oct → kept
    await plan(omar, morning, '2026-12-06'); // Sun, first Sunday of Dec → kept

    const res = await del(admin, 'year=2026&month=11&weekday=0');

    expect(res.body.deletedCount).toBe(1);
    expect(await left(admin)).toEqual(['Sara@2026-10-25', 'Omar@2026-12-06'].sort());
  });

  it('gives the same result whatever the time zone of the server', async () => {
    const { admin, morning, ali, plan } = await setup();
    await plan(ali, morning, '2026-10-01');

    await withTimeZone('America/New_York', async () => {
      const res = await del(admin, 'year=2026&month=10&weekday=4');
      expect(res.body.deletedCount).toBe(1);
    });
  });

  it('answers 200 with 0 when there is nothing to delete', async () => {
    const { admin, morning, ali, plan } = await setup();
    await plan(ali, morning, '2026-10-02'); // Friday

    const res = await del(admin, 'year=2026&month=10&weekday=4');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deletedCount: 0 });
    expect(await left(admin)).toEqual(['Ali@2026-10-02']);
  });

  it("never touches another company's planning", async () => {
    const mine = await setup();
    const other = await setup();
    await mine.plan(mine.ali, mine.morning, '2026-10-01');
    await other.plan(other.ali, other.morning, '2026-10-01');

    const res = await del(mine.admin, 'year=2026&month=10&weekday=4');

    expect(res.body.deletedCount).toBe(1);
    expect(await left(other.admin)).toEqual(['Ali@2026-10-01']);
  });

  it('is not mistaken for DELETE /planning/:id', async () => {
    const { admin } = await setup();
    const res = await del(admin, 'year=2026&month=10&weekday=4');
    expect(res.status).not.toBe(404);
  });

  it.each([
    ['nothing', ''],
    ['no weekday', 'year=2026&month=10'],
    ['an empty weekday', 'year=2026&month=10&weekday='],
    ['a weekday above 6', 'year=2026&month=10&weekday=7'],
    ['a month that does not exist', 'year=2026&month=13&weekday=4'],
    ['a year that is not a year', 'year=abc&month=10&weekday=4'],
  ])('refuses %s, and changes nothing', async (_name, qs) => {
    const { admin, morning, ali, plan } = await setup();
    await plan(ali, morning, '2026-10-01');

    const res = await del(admin, qs);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Choose the month and the weekday to delete');
    expect(await left(admin)).toEqual(['Ali@2026-10-01']);
  });
});

describe('deleting a whole month (DELETE /planning/month)', () => {
  // "Today" is 12 November 2026: November is the current month,
  // October and September are past, December is next.
  const NOW = '2026-11-12T10:00:00Z';
  const del = (admin: any, qs: string) => admin.delete(`/planning/month?${qs}`);
  const left = async (admin: any) => names(await admin.get('/planning'));
  const CURRENT = "The current month's planning cannot be deleted";
  const CLOCKED =
    'This month already has clock-ins or clock-outs: its planning cannot be deleted';

  // Log in after fixing "now", so the session is not seen as expired
  beforeEach(() => setNow(NOW));
  afterEach(() => jest.useRealTimers());

  /** One planned day in each of September, October, November and December. */
  async function fourMonths() {
    const s = await setup();
    await s.plan(s.ali, s.morning, '2026-09-15');
    await s.plan(s.ali, s.morning, '2026-10-15');
    await s.plan(s.ali, s.morning, '2026-11-15');
    await s.plan(s.ali, s.morning, '2026-12-15');
    return s;
  }
  const ALL = ['Ali@2026-09-15', 'Ali@2026-10-15', 'Ali@2026-11-15', 'Ali@2026-12-15'];

  const worked = (s: Awaited<ReturnType<typeof setup>>, fields: object) =>
    seed.worktime(s.company.id, { emp_id: 1, shift_id: s.id(s.morning), ...fields });
  const machinePunch = (companyId: string, timestamp: string) =>
    runForCompany(companyId, async () => {
      await t.model('RawAttendanceLog').create({
        deviceUserId: '1',
        timestamp: new Date(timestamp),
        deviceLogId: `log-${timestamp}`,
      });
    });

  it('deletes every day of a future month, all entries of each day, and nothing else', async () => {
    const s = await fourMonths();
    await s.plan(s.sara, s.morning, '2026-12-01'); // first day
    await s.plan(s.omar, s.evening, '2026-12-31'); // last day
    await s.plan(s.sara, s.evening, '2026-12-15'); // a second entry on the same day
    await s.plan(s.omar, s.morning, '2027-01-01'); // first day of the next month → kept

    const res = await del(s.admin, 'year=2026&month=12');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deletedCount: 4 });
    expect(await left(s.admin)).toEqual(
      ['Ali@2026-09-15', 'Ali@2026-10-15', 'Ali@2026-11-15', 'Omar@2027-01-01'].sort(),
    );
  });

  it('accepts a month written with a leading zero', async () => {
    const s = await setup();
    await s.plan(s.ali, s.morning, '2027-02-10');
    const res = await del(s.admin, 'year=2027&month=02');
    expect(res.body).toEqual({ deletedCount: 1 });
  });

  it('refuses the current month, and deletes nothing', async () => {
    const s = await fourMonths();

    const res = await del(s.admin, 'year=2026&month=11');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CURRENT);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('refuses the current month even when it has no clock-in yet (its 1st day)', async () => {
    setNow('2026-11-01T08:00:00Z');
    const s = await fourMonths();
    const res = await del(s.admin, 'year=2026&month=11');
    expect(res.status).toBe(409);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('already treats December as current at 00:30 on 1 December in Algiers (23:30 UTC)', async () => {
    setNow('2026-11-30T23:30:00Z');
    const s = await fourMonths();

    const res = await del(s.admin, 'year=2026&month=12');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CURRENT);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('refuses the current month whatever the time zone of the server', async () => {
    const s = await fourMonths();
    await withTimeZone('America/New_York', async () => {
      const res = await del(s.admin, 'year=2026&month=11');
      expect(res.status).toBe(409);
    });
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('deletes a past month that has no clock-in or clock-out', async () => {
    const s = await fourMonths();
    const res = await del(s.admin, 'year=2026&month=9');
    expect(res.body).toEqual({ deletedCount: 1 });
    expect(await left(s.admin)).toEqual(ALL.filter((n) => !n.includes('2026-09')));
  });

  it.each([
    ['a clock-in', { clock_in: '08:02' }],
    ['a clock-out only', { clock_out: '16:05' }],
    ['a clock-in at midnight ("00:00" is a real time)', { clock_in: '00:00' }],
    ['a recorded absence', { absent: true, absent_comment: 'Sick' }],
  ])('refuses a past month with %s, and deletes nothing', async (_name, fields) => {
    const s = await fourMonths();
    await worked(s, { work_date: new Date('2026-10-20T00:00:00'), ...fields });

    const res = await del(s.admin, 'year=2026&month=10');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CLOCKED);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('refuses a month whose worked day is saved at local midnight in Algiers', async () => {
    const s = await fourMonths();
    await withTimeZone('Africa/Algiers', async () => {
      // new Date('2026-10-01T00:00:00') in Algiers = 30 September 23:00 UTC
      await worked(s, { work_date: new Date('2026-10-01T00:00:00'), clock_in: '08:00' });
      const res = await del(s.admin, 'year=2026&month=10');
      expect(res.status).toBe(409);
      // ...and it does not belong to September
      expect((await del(s.admin, 'year=2026&month=9')).status).toBe(200);
    });
  });

  it('refuses a month with a machine punch not yet turned into a worked day', async () => {
    const s = await fourMonths();
    await machinePunch(s.company.id, '2026-10-20T07:58:00Z');

    const res = await del(s.admin, 'year=2026&month=10');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CLOCKED);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('counts a punch at 00:30 in Algiers on the 1st (23:30 UTC the day before) in its month', async () => {
    const s = await fourMonths();
    await machinePunch(s.company.id, '2026-09-30T23:30:00Z'); // 1 October 00:30 in Algiers
    expect((await del(s.admin, 'year=2026&month=10')).status).toBe(409);
  });

  it('refuses a month with a punch received from a ZKTeco machine', async () => {
    const s = await fourMonths();
    await runForCompany(s.company.id, async () => {
      await t.model('ZktecoAttendanceEvent').create({
        deviceSerial: 'SN1',
        employeePin: '1',
        eventTime: new Date('2026-10-20T07:58:00Z'),
        deviceTimestamp: '2026-10-20 08:58:00',
        status: 0,
        verifyMode: 1,
        rawLine: '1\t2026-10-20 08:58:00\t0\t1',
        eventKey: `SN1-1-${Date.now()}-${Math.random()}`,
      });
    });

    const res = await del(s.admin, 'year=2026&month=10');

    expect(res.status).toBe(409);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('also refuses a future month that somehow already has clock-ins', async () => {
    const s = await fourMonths();
    await worked(s, { work_date: new Date('2026-12-03T00:00:00'), clock_in: '08:00' });
    const res = await del(s.admin, 'year=2026&month=12');
    expect(res.status).toBe(409);
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('is not stopped by worked days without any clocking (empty, or "" times)', async () => {
    const s = await fourMonths();
    await worked(s, { work_date: new Date('2026-09-10T00:00:00') });
    await worked(s, {
      work_date: new Date('2026-09-11T00:00:00'),
      clock_in: '',
      clock_out: null,
      absent: false,
    });
    const res = await del(s.admin, 'year=2026&month=9');
    expect(res.body).toEqual({ deletedCount: 1 });
  });

  it('is not stopped by clock-ins of the months around it', async () => {
    const s = await fourMonths();
    await worked(s, { work_date: new Date('2026-08-31T00:00:00'), clock_in: '08:00' });
    await worked(s, { work_date: new Date('2026-10-01T00:00:00'), clock_in: '08:00' });
    await machinePunch(s.company.id, '2026-08-31T12:00:00Z');
    await machinePunch(s.company.id, '2026-10-02T12:00:00Z');

    const res = await del(s.admin, 'year=2026&month=9');

    expect(res.body).toEqual({ deletedCount: 1 });
  });

  it("is not stopped by another company's clock-ins, and never deletes its planning", async () => {
    const mine = await fourMonths();
    const other = await fourMonths();
    await worked(other, { work_date: new Date('2026-09-10T00:00:00'), clock_in: '08:00' });
    await machinePunch(other.company.id, '2026-09-10T07:00:00Z');

    const res = await del(mine.admin, 'year=2026&month=9');

    expect(res.body).toEqual({ deletedCount: 1 });
    expect(await left(other.admin)).toEqual(ALL);
  });

  it('answers 200 with 0 when the month has no planning', async () => {
    const s = await fourMonths();
    const res = await del(s.admin, 'year=2027&month=3');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deletedCount: 0 });
    expect(await left(s.admin)).toEqual(ALL);
  });

  it('is not mistaken for DELETE /planning/:id', async () => {
    const { admin } = await setup();
    const res = await del(admin, 'year=2027&month=3');
    expect(res.status).toBe(200);
  });

  it.each([
    ['nothing', ''],
    ['no month', 'year=2026'],
    ['no year', 'month=12'],
    ['an empty month', 'year=2026&month='],
    ['a month that does not exist', 'year=2026&month=13'],
    ['month 0', 'year=2026&month=0'],
    ['a year that is not a year', 'year=abc&month=12'],
    ['two months at once', 'year=2026&month=12&month=1'],
  ])('refuses %s, and deletes nothing', async (_name, qs) => {
    const s = await fourMonths();

    const res = await del(s.admin, qs);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Choose the month to delete');
    expect(await left(s.admin)).toEqual(ALL);
  });
});


describe('exports', () => {
  /** Sara and Omar in the first week of October 2026, Ali outside it. */
  async function firstWeek() {
    const s = await setup();
    await s.plan(s.sara, s.morning, '2026-10-03', {
      backupEmpIds: [s.id(s.omar)],
    }); // Saturday 08H
    await s.plan(s.omar, s.evening, '2026-10-01'); // Thursday 16H
    await s.plan(s.ali, s.morning, '2026-10-10'); // second Saturday: not exported
    await s.plan(s.ali, s.morning, '2026-10-02', {
      tasks: [{ label: 'Early', startTime: '06:30', endTime: '08:00' }],
    }); // Friday 06H
    return s;
  }
  const HEADER = [
    'Hour',
    'Saturday',
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
  ];

  it('leaves out entries whose employee or shift was deleted, in all six exports', async () => {
    const s = await setup();
    await s.plan(s.ali, s.morning, '2026-10-03');
    await s.plan(s.sara, s.morning, '2026-10-03');
    await s.plan(s.omar, s.evening, '2026-10-03');
    await runForCompany(s.company.id, async () => {
      await t.model('Employee').deleteOne({ _id: s.ali._id });
      await t.model('Shift').deleteOne({ _id: s.evening._id });
    });
    for (const url of [
      '/planning/export-first-week?year=2026&month=9',
      '/planning/export-first-week-manager?year=2026&month=9',
      '/planning/export-current-day?year=2026&month=10&day=3',
    ]) {
      expect((await download(s.admin.get(url))).status).toBe(200);
      const pdf = await download(s.admin.get(`${url}&format=pdf`));
      expect(pdf.status).toBe(200);
      const text = pdfText(pdf.body).join('\n');
      expect(text).toContain('Sara');
      expect(text).not.toContain('Ali');
    }
  });

  it('answers 400 for a day it cannot read', async () => {
    const { admin } = await setup();
    const res = await admin.get('/planning?planDate=someday');
    expect(res.status).toBe(400);
  });

  describe('first week, Excel', () => {
    it('lists who works at each hour of the first Saturday→Friday of the month', async () => {
      const { admin } = await firstWeek();
      const res = await download(
        admin.get('/planning/export-first-week?year=2026&month=9'),
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="WeeklyPlanning.xlsx"',
      );
      expect(await excelRows(res.body)).toEqual([
        HEADER,
        ['06H', '', '', '', '', '', '', 'Ali Ben'],
        ['08H', 'Sara Kaci', '', '', '', '', '', ''],
        ['16H', '', '', '', '', '', 'Omar Zed', ''],
      ]);
    });

    it('for managers, with the backups', async () => {
      const { admin } = await firstWeek();
      const res = await download(
        admin.get('/planning/export-first-week-manager?year=2026&month=9'),
      );
      const rows = await excelRows(res.body);
      expect(rows[0]).toEqual(HEADER);
      expect(rows.find((r) => r[0] === '08H')?.[1]).toBe(
        'Sara Kaci\nBackup: Omar Zed',
      );
      expect(rows.find((r) => r[0] === '06H')?.[7]).toBe(
        'Ali Ben\nBackup: No backup',
      );
    });

    it('is just a header for a month without planning', async () => {
      const { admin } = await setup();
      const res = await download(
        admin.get('/planning/export-first-week?year=2026&month=9'),
      );
      expect(await excelRows(res.body)).toEqual([HEADER]);
    });
  });

  describe('one day, Excel', () => {
    it("lists the day's employees by hour, under the day's name", async () => {
      const { admin } = await firstWeek();
      const res = await download(
        admin.get('/planning/export-current-day?year=2026&month=10&day=3'),
      );
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="DailyPlanning.xlsx"',
      );
      expect(await excelRows(res.body)).toEqual([
        ['Hour', 'Saturday'],
        ['08H', 'Sara Kaci\nBackup: Omar Zed'],
      ]);
    });
  });

  describe('PDF', () => {
    it.each([
      [
        '/planning/export-first-week?year=2026&month=9&format=pdf',
        'FirstWeekPlanning.pdf',
      ],
      [
        '/planning/export-first-week-manager?year=2026&month=9&format=pdf',
        null,
      ],
      [
        '/planning/export-current-day?year=2026&month=10&day=3&format=pdf',
        null,
      ],
    ])('%s is a PDF with the names in it', async (url, filename) => {
      const { admin } = await firstWeek();
      const res = await download(admin.get(url));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      if (filename)
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="${filename}"`,
        );
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdfText(res.body).join('\n')).toContain('Sara Kaci');
      expect(pdfPages(res.body)).toBeGreaterThanOrEqual(1);
    });

    it('goes on to more pages when one hour holds more people than a page', async () => {
      const s = await setup();
      const nine = await seed.shift(s.company.id, {
        startTime: '09:00',
        endTime: '17:00',
      });
      for (let i = 0; i < 80; i++) {
        const emp = await seed.employee(s.company.id, {
          firstName: `Crew${i}`,
          lastName: 'X',
        });
        await s.plan(emp, i < 40 ? s.morning : nine, '2026-10-03', {
          backupEmpIds: [s.id(s.ali), s.id(s.sara)],
        });
      }
      for (const url of [
        '/planning/export-first-week?year=2026&month=9&format=pdf',
        '/planning/export-first-week-manager?year=2026&month=9&format=pdf',
        '/planning/export-current-day?year=2026&month=10&day=3&format=pdf',
      ]) {
        const res = await download(s.admin.get(url));
        expect(pdfPages(res.body)).toBeGreaterThan(1);
        expect(pdfText(res.body).join('\n')).toContain('Crew79 X');
      }
    });
  });

  it.each([
    ['/planning/export-first-week?year=2026&month=9', '13:00'],
    ['/planning/export-first-week?year=2026&month=9', '22:00'],
    ['/planning/export-first-week-manager?year=2026&month=9', '18:00'],
    ['/planning/export-current-day?year=2026&month=10&day=3', '13:00'],
    ['/planning/export-current-day?year=2026&month=10&day=3', '00:00'],
  ])('%s includes a shift starting at %s', async (url, start) => {
    const s = await setup();
    const shift = await seed.shift(s.company.id, {
      startTime: start,
      endTime: '23:59',
    });
    await s.plan(s.ali, shift, '2026-10-03');
    const rows = await excelRows((await download(s.admin.get(url))).body);
    expect(rows.flat().join('\n')).toContain('Ali Ben');
  });

  it('lists the hours in time order, only those in use', async () => {
    const s = await setup();
    for (const [emp, start] of [
      [s.ali, '22:00'],
      [s.sara, '13:00'],
      [s.omar, '00:00'],
    ] as const) {
      const shift = await seed.shift(s.company.id, {
        startTime: start,
        endTime: '23:59',
      });
      await s.plan(emp, shift, '2026-10-03');
    }
    const rows = await excelRows(
      (
        await download(
          s.admin.get('/planning/export-current-day?year=2026&month=10&day=3'),
        )
      ).body,
    );
    expect(rows.map((r) => r[0])).toEqual(['Hour', '00H', '13H', '22H']);
  });

  it.each([
    '/planning/export-first-week?year=2026&month=9',
    '/planning/export-first-week-manager?year=2026&month=9',
    '/planning/export-current-day?year=2026&month=10&day=3',
  ])(
    '%s lists a first sub-task without a time at the shift start',
    async (url) => {
      const s = await setup();
      await s.plan(s.ali, s.morning, '2026-10-03', {
        tasks: [{ label: 'Clean' }],
      });
      const res = await download(s.admin.get(url));
      expect(res.status).toBe(200);
      const rows = await excelRows(res.body);
      expect(rows.find((r) => r[0] === '08H')?.join('\n')).toContain('Ali Ben');
    },
  );
});
