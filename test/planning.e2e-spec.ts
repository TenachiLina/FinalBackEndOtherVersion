import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { runForCompany } from '../src/tenancy/tenant-context';
import { withTimeZone } from './helpers/time';
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
