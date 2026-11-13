import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';

// Employees report mistakes in their worked time, advances and bonuses from
// the mobile app (/me/corrections); managers and admins answer them on the
// website (/corrections). Nobody sees or reports someone else's records.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

/** A company with an employee who has a staff account, an admin and a manager. */
async function setup(features?: string[]) {
  const company = await seed.company(
    features ? { features: features as any } : {},
  );
  const me = await seed.employee(company.id, {
    firstName: 'Amine',
    lastName: 'Bensalah',
  });
  const colleague = await seed.employee(company.id, {
    firstName: 'Sara',
    lastName: 'Haddad',
  });
  const app = await loginAs(
    t,
    await seed.user('staff', company.id, { employeeId: String(me._id) }),
  );
  const admin = await loginAs(
    t,
    await seed.user('admin', company.id, { name: 'Boss' }),
  );
  const manager = await loginAs(t, await seed.user('manager', company.id));
  return { company, me, colleague, app, admin, manager };
}

describe('POST /me/corrections (employee)', () => {
  it('reports a wrong clocking day, with what the employee saw', async () => {
    const { company, me, app } = await setup();
    const day = await seed.worktime(company.id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-11-02T00:00:00Z'),
      clock_in: '10:12',
      clock_out: '18:00',
      work_hours: '07:48',
      late_minutes: '12',
    });

    const res = await app.post('/me/corrections').send({
      kind: 'worktime',
      recordId: String(day._id),
      message: '  I arrived at 10:00, not 10:12  ',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'worktime',
      recordId: String(day._id),
      date: '2026-11-02',
      message: 'I arrived at 10:00, not 10:12',
      status: 'pending',
      reply: null,
      snapshot: {
        clockIn: '10:12',
        clockOut: '18:00',
        workHours: '07:48',
        lateMinutes: 12,
        overtimeMinutes: 0,
        absent: false,
      },
      employee: { name: 'Amine Bensalah', empNumber: me.empNumber },
    });

    const mine = await app.get('/me/corrections');
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).not.toHaveProperty('employee');
  });

  it('reports an advance, a bonus, and a missing day', async () => {
    const { company, me, app } = await setup();
    const advance = await seed.advance(company.id, {
      emp_id: me.empNumber,
      amount: 5000,
      date: new Date('2026-11-07T00:00:00Z'),
    });
    const bonus = await seed.bonus(company.id, {
      emp_id: me.empNumber,
      amount: 3000,
      date: '2026-11-30',
      reason: 'Great month',
    });

    const a = await app.post('/me/corrections').send({
      kind: 'advance',
      recordId: String(advance._id),
      message: 'I took 3000, not 5000',
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      date: '2026-11-07',
      snapshot: { amount: 5000, reason: null },
    });

    const b = await app.post('/me/corrections').send({
      kind: 'bonus',
      recordId: String(bonus._id),
      message: 'It was 4000',
    });
    expect(b.body).toMatchObject({
      date: '2026-11-30',
      snapshot: { amount: 3000, reason: 'Great month' },
    });

    const missing = await app.post('/me/corrections').send({
      kind: 'worktime',
      date: '2026-11-03',
      recordId: '',
      message: 'I worked but nothing shows',
    });
    expect(missing.status).toBe(201);
    expect(missing.body).toMatchObject({
      recordId: null,
      date: '2026-11-03',
      snapshot: null,
    });

    const mine = await app.get('/me/corrections');
    expect(mine.body.map((c: any) => c.kind).sort()).toEqual([
      'advance',
      'bonus',
      'worktime',
    ]);
  });

  it("can't report someone else's record, or another company's", async () => {
    const { company, colleague, app } = await setup();
    const theirs = await seed.worktime(company.id, {
      emp_id: colleague.empNumber,
      work_date: new Date('2026-11-02T00:00:00Z'),
    });
    const elsewhere = await seed.company();
    const otherCompany = await seed.advance(elsewhere.id, {
      emp_id: 1,
      amount: 1,
      date: new Date('2026-11-02T00:00:00Z'),
    });
    for (const [kind, id] of [
      ['worktime', String(theirs._id)],
      ['advance', String(otherCompany._id)],
      ['bonus', unknownId()],
      ['worktime', 'not-an-id'],
    ]) {
      const res = await app
        .post('/me/corrections')
        .send({ kind, recordId: id, message: 'Wrong one' });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('This record was not found');
    }
  });

  it('checks what is sent', async () => {
    const { app } = await setup();
    const cases: [object, number, string][] = [
      [
        {},
        400,
        'Choose what the mistake is about: worked time, an advance or a bonus',
      ],
      [
        { kind: 'salary', message: 'Wrong' },
        400,
        'Choose what the mistake is about: worked time, an advance or a bonus',
      ],
      [
        { kind: 'bonus', date: '2026-11-03', message: 'no' },
        400,
        'Describe the mistake in a few words',
      ],
      [
        { kind: 'bonus', date: '2026-11-03', message: 'x'.repeat(501) },
        400,
        'The message can be at most 500 characters',
      ],
      [
        { kind: 'bonus', message: 'A missing bonus' },
        400,
        'date must be YYYY-MM-DD',
      ],
      [
        { kind: 'bonus', date: '2026-02-30', message: 'A missing bonus' },
        400,
        'date must be YYYY-MM-DD',
      ],
    ];
    for (const [body, status, message] of cases) {
      const res = await app.post('/me/corrections').send(body);
      expect([res.status, res.body.message]).toEqual([status, message]);
    }
  });

  it('only for the features the company uses', async () => {
    const { app } = await setup(['planning', 'bonuses']);
    const res = await app.post('/me/corrections').send({
      kind: 'advance',
      date: '2026-11-03',
      message: 'A missing advance',
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'The "advances" feature is not enabled for this company',
    );
    expect(
      (
        await app.post('/me/corrections').send({
          kind: 'bonus',
          date: '2026-11-03',
          message: 'A missing bonus',
        })
      ).status,
    ).toBe(201);
  });

  it('once per record while waiting, and 20 waiting at most', async () => {
    const { company, me, app } = await setup();
    const day = await seed.worktime(company.id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-11-02T00:00:00Z'),
    });
    const report = {
      kind: 'worktime',
      recordId: String(day._id),
      message: 'Wrong hours',
    };
    expect((await app.post('/me/corrections').send(report)).status).toBe(201);
    const again = await app.post('/me/corrections').send(report);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe(
      'You already reported this. Wait for the answer.',
    );

    for (let d = 1; d <= 19; d++) {
      const day2 = `2026-10-${String(d).padStart(2, '0')}`;
      expect(
        (
          await app
            .post('/me/corrections')
            .send({ kind: 'worktime', date: day2, message: 'Missing day' })
        ).status,
      ).toBe(201);
    }
    const tooMany = await app
      .post('/me/corrections')
      .send({ kind: 'worktime', date: '2026-10-25', message: 'Missing day' });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe(
      'You have too many reports waiting. Wait for the answers first.',
    );
  });

  it('is refused to accounts not linked to an employee, and to admins', async () => {
    const company = await seed.company();
    const unlinked = await loginAs(t, await seed.user('staff', company.id));
    const res = await unlinked
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-03', message: 'A missing bonus' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Your account is not linked to an employee');
    expect((await unlinked.get('/me/corrections')).status).toBe(403);

    const admin = await loginAs(t, await seed.user('admin', company.id));
    expect((await admin.post('/me/corrections').send({})).status).toBe(403);
  });
});

describe('/corrections (managers and admins)', () => {
  it('lists the reports, counts the waiting ones, and records the answer', async () => {
    const { company, me, app, admin } = await setup();
    const day = await seed.worktime(company.id, {
      emp_id: me.empNumber,
      work_date: new Date('2026-11-02T00:00:00Z'),
      clock_in: '10:12',
    });
    const sent = await app.post('/me/corrections').send({
      kind: 'worktime',
      recordId: String(day._id),
      message: 'I arrived at 10:00',
    });
    await app
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });

    expect((await admin.get('/corrections/count')).body).toEqual({
      pending: 2,
    });
    const list = await admin.get('/corrections?status=pending');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.find((c: any) => c.id === sent.body.id)).toMatchObject({
      employee: { name: 'Amine Bensalah', empNumber: me.empNumber },
      snapshot: { clockIn: '10:12' },
    });

    const done = await admin
      .patch(`/corrections/${sent.body.id}`)
      .send({ status: 'corrected', reply: ' Fixed to 10:00 ' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      status: 'corrected',
      reply: 'Fixed to 10:00',
      handledBy: 'Boss',
    });
    expect(done.body.handledAt).toBeTruthy();

    // The employee sees the answer in the app
    const mine = await app.get('/me/corrections');
    expect(mine.body.find((c: any) => c.id === sent.body.id)).toMatchObject({
      status: 'corrected',
      reply: 'Fixed to 10:00',
      handledBy: 'Boss',
    });

    expect((await admin.get('/corrections/count')).body).toEqual({
      pending: 1,
    });
    expect(
      (await admin.get('/corrections?status=corrected')).body,
    ).toHaveLength(1);
    expect((await admin.get('/corrections?status=all')).body).toHaveLength(2);
    expect((await admin.get('/corrections')).body).toHaveLength(2);

    // Answered once: can't be answered again; and it can be reported again
    const twice = await admin
      .patch(`/corrections/${sent.body.id}`)
      .send({ status: 'rejected' });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe('This request was already handled');
    expect(
      (
        await app.post('/me/corrections').send({
          kind: 'worktime',
          recordId: String(day._id),
          message: 'Still wrong',
        })
      ).status,
    ).toBe(201);
  });

  it('a rejection may come without a reply', async () => {
    const { app, manager } = await setup();
    const sent = await app
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });
    const res = await manager
      .patch(`/corrections/${sent.body.id}`)
      .send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', reply: null });
  });

  it('checks what is sent', async () => {
    const { app, admin } = await setup();
    const sent = await app
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });
    const cases: [string, object, number, string][] = [
      [sent.body.id, {}, 400, 'Choose Corrected or Rejected'],
      [
        sent.body.id,
        { status: 'pending' },
        400,
        'Choose Corrected or Rejected',
      ],
      [
        sent.body.id,
        { status: 'corrected', reply: 'x'.repeat(501) },
        400,
        'The reply can be at most 500 characters',
      ],
      [
        unknownId(),
        { status: 'corrected' },
        404,
        'Correction request not found',
      ],
      [
        'not-an-id',
        { status: 'corrected' },
        404,
        'Correction request not found',
      ],
    ];
    for (const [id, body, status, message] of cases) {
      const res = await admin.patch(`/corrections/${id}`).send(body);
      expect([res.status, res.body.message]).toEqual([status, message]);
    }
    const bad = await admin.get('/corrections?status=open');
    expect([bad.status, bad.body.message]).toEqual([
      400,
      'status must be pending, corrected, rejected or all',
    ]);
  });

  it("never shows another company's reports", async () => {
    const one = await setup();
    const two = await setup();
    await one.app
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });
    const theirs = (await one.admin.get('/corrections')).body[0];
    expect((await two.admin.get('/corrections')).body).toEqual([]);
    expect((await two.admin.get('/corrections/count')).body).toEqual({
      pending: 0,
    });
    expect(
      (
        await two.admin
          .patch(`/corrections/${theirs.id}`)
          .send({ status: 'rejected' })
      ).status,
    ).toBe(404);
  });

  it("a manager doesn't see another manager's reports (salary pages rule)", async () => {
    const company = await seed.company();
    const bossEmployee = await seed.employee(company.id);
    const other = await seed.employee(company.id);
    // A manager whose employee record also has a staff account
    await seed.user('manager', company.id, {
      employeeId: String(bossEmployee._id),
    });
    const viewer = await loginAs(t, await seed.user('manager', company.id));
    const admin = await loginAs(t, await seed.user('admin', company.id));
    // Bypass the one-account-per-employee rule only to get a report from that
    // manager's employee record
    const asStaff = await loginAs(
      t,
      await seed.user('staff', company.id, {
        employeeId: String(bossEmployee._id),
      }),
    );
    const plainStaff = await loginAs(
      t,
      await seed.user('staff', company.id, { employeeId: String(other._id) }),
    );
    const hidden = await asStaff
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });
    await plainStaff
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });

    expect((await viewer.get('/corrections')).body).toHaveLength(1);
    expect((await viewer.get('/corrections/count')).body).toEqual({
      pending: 1,
    });
    const res = await viewer
      .patch(`/corrections/${hidden.body.id}`)
      .send({ status: 'rejected' });
    expect(res.status).toBe(403);
    expect((await admin.get('/corrections')).body).toHaveLength(2);
  });

  it('employees and kiosk accounts are refused', async () => {
    const { company, app } = await setup();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    for (const client of [app, kiosk]) {
      expect((await client.get('/corrections')).status).toBe(403);
      expect(
        (
          await client
            .patch(`/corrections/${unknownId()}`)
            .send({ status: 'corrected' })
        ).status,
      ).toBe(403);
    }
  });

  it('appears in the activity log', async () => {
    const { app, admin } = await setup();
    const sent = await app
      .post('/me/corrections')
      .send({ kind: 'bonus', date: '2026-11-30', message: 'Bonus missing' });
    await admin
      .patch(`/corrections/${sent.body.id}`)
      .send({ status: 'corrected' });
    const log = await admin.get('/audit-logs');
    const actions = (log.body.items ?? log.body).map((e: any) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['correction.report', 'correction.handle']),
    );
  });
});
