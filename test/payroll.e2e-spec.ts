import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { withTimeZone } from './helpers/time';

// Advances, bonuses and work time: what payroll is computed from.

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
  return { company, admin };
}

/** A company where "me" is a manager and employee #20 is another manager. */
async function withHiddenManager() {
  const company = await seed.company();
  const other = await seed.employee(company.id, {
    empNumber: 20,
    firstName: 'Other',
  });
  await seed.employee(company.id, { empNumber: 21, firstName: 'Crew' });
  await seed.user('manager', company.id, { employeeId: String(other._id) });
  const me = await loginAs(t, await seed.user('manager', company.id));
  return { company, me };
}

describe('advances', () => {
  it('gives, lists (newest first), filters by dates and by employee, and revokes', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, { empNumber: 1 });
    await seed.employee(company.id, { empNumber: 2 });
    const first = await admin
      .post('/advances')
      .send({ emp_id: 1, amount: 2000, date: '2026-10-05', reason: 'Rent' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      emp_id: 1,
      amount: 2000,
      date: '2026-10-05T00:00:00.000Z',
      reason: 'Rent',
    });
    await admin
      .post('/advances')
      .send({ emp_id: 1, amount: 1000, date: '2026-10-12' });
    await admin
      .post('/advances')
      .send({ emp_id: 2, amount: 500, date: '2026-11-02' });

    const dates = (res: any) => res.body.map((a: any) => a.date.slice(0, 10));
    expect(dates(await admin.get('/advances'))).toEqual([
      '2026-11-02',
      '2026-10-12',
      '2026-10-05',
    ]);
    expect(
      dates(await admin.get('/advances?start=2026-10-01&end=2026-10-31')),
    ).toEqual(['2026-10-12', '2026-10-05']);
    expect(
      dates(
        await admin.get('/advances/employee/1?start=2026-10-06&end=2026-10-31'),
      ),
    ).toEqual(['2026-10-12']);
    expect(dates(await admin.get('/advances/employee/1'))).toHaveLength(2);

    expect((await admin.delete(`/advances/${first.body._id}`)).status).toBe(
      200,
    );
    expect(await admin.get('/advances/employee/1')).toMatchObject({
      body: [expect.anything()],
    });
    const again = await admin.delete(`/advances/${first.body._id}`);
    expect(again.status).toBe(404);
  });

  it('refuses a second advance for the same employee on the same date', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, { empNumber: 3 });
    await admin
      .post('/advances')
      .send({ emp_id: 3, amount: 100, date: '2026-10-05' });
    const dup = await admin
      .post('/advances')
      .send({ emp_id: 3, amount: 200, date: '2026-10-05' });
    expect(dup.status).toBe(409);
  });

  it('requires an employee, an amount and a valid date', async () => {
    const { admin } = await setup();
    expect(
      (await admin.post('/advances').send({ amount: 100, date: '2026-10-05' }))
        .status,
    ).toBe(400);
    expect(
      (await admin.post('/advances').send({ emp_id: 1, date: '2026-10-05' }))
        .status,
    ).toBe(400);
    expect(
      (
        await admin
          .post('/advances')
          .send({ emp_id: 1, amount: 100, date: 'soon' })
      ).status,
    ).toBe(400);
  });

  // BUG-401: an advance of 0 or a negative amount is accepted
  it.each([[0], [-5000]])('refuses an advance of %d', async (amount) => {
    const { company, admin } = await setup();
    await seed.employee(company.id, { empNumber: 4 });
    const res = await admin
      .post('/advances')
      .send({ emp_id: 4, amount, date: '2026-10-05' });
    expect(res.status).toBe(400);
  });

  // BUG-402: advances and bonuses are accepted for an employee number that doesn't exist
  it('refuses an advance or a bonus for an employee who does not exist', async () => {
    const { admin } = await setup();
    expect(
      (
        await admin
          .post('/advances')
          .send({ emp_id: 999, amount: 100, date: '2026-10-05' })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin
          .post('/bonuses')
          .send({ emp_id: 999, amount: 100, date: '2026-10-05', reason: 'x' })
      ).status,
    ).toBe(400);
  });

  it('doesn’t count another company’s employee as existing', async () => {
    const { admin } = await setup();
    await seed.employee((await seed.company()).id, { empNumber: 55 });
    const res = await admin
      .post('/advances')
      .send({ emp_id: 55, amount: 100, date: '2026-10-05' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Employee not found');
  });

  it('accepts the employee number and the amount as text', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, { empNumber: 56 });
    const res = await admin
      .post('/advances')
      .send({ emp_id: '56', amount: '250.50', date: '2026-10-05' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ emp_id: 56, amount: 250.5 });
  });

  it('hides another manager from a manager', async () => {
    const { company, me } = await withHiddenManager();
    const theirs = await seed.advance(company.id, {
      emp_id: 20,
      amount: 900,
      date: '2026-10-05',
    });
    await seed.advance(company.id, {
      emp_id: 21,
      amount: 300,
      date: '2026-10-05',
    });

    expect((await me.get('/advances')).body.map((a: any) => a.emp_id)).toEqual([
      21,
    ]);
    expect((await me.get('/advances/employee/20')).status).toBe(403);
    expect(
      (
        await me
          .post('/advances')
          .send({ emp_id: 20, amount: 1, date: '2026-10-06' })
      ).status,
    ).toBe(403);
    expect((await me.delete(`/advances/${theirs._id}`)).status).toBe(403);
  });

  it("can't revoke another company's advance", async () => {
    const { admin } = await setup();
    const theirs = await seed.advance((await seed.company()).id, {
      emp_id: 1,
      amount: 100,
      date: '2026-10-05',
    });
    expect((await admin.delete(`/advances/${theirs._id}`)).status).toBe(404);
    expect((await admin.delete('/advances/nope')).status).toBe(400);
  });
});

describe('bonuses', () => {
  it('gives, lists by dates and employee, and revokes', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, { empNumber: 1 });
    const res = await admin.post('/bonuses').send({
      emp_id: '1',
      amount: '1500',
      date: '2026-10-05',
      reason: ' Best month ',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      emp_id: 1,
      amount: 1500,
      date: '2026-10-05',
      reason: 'Best month',
    });
    await seed.bonus(company.id, {
      emp_id: 2,
      amount: 100,
      date: '2026-11-01',
    });

    const ids = async (q: string) =>
      (await admin.get(`/bonuses${q}`)).body.map((b: any) => b.emp_id);
    expect(await ids('')).toEqual([2, 1]);
    expect(await ids('?start=2026-10-01&end=2026-10-31')).toEqual([1]);
    expect(await ids('?start=2026-10-06')).toEqual([2]);
    expect(await ids('?end=2026-10-06')).toEqual([1]);
    expect(await ids('?empId=2')).toEqual([2]);

    expect((await admin.delete(`/bonuses/${res.body._id}`)).body).toEqual({
      deleted: true,
    });
    expect((await admin.delete(`/bonuses/${res.body._id}`)).status).toBe(404);
  });

  it.each([
    [{ amount: 0 }, 'amount must be greater than 0'],
    [{ amount: 'x' }, 'amount must be greater than 0'],
    [{ date: '05/10/2026' }, 'date must be YYYY-MM-DD'],
    [{ reason: '  ' }, 'reason is required'],
    [{ emp_id: null }, 'emp_id is required'],
  ])('refuses %j', async (over, message) => {
    const { admin } = await setup();
    const res = await admin.post('/bonuses').send({
      emp_id: 1,
      amount: 100,
      date: '2026-10-05',
      reason: 'Good',
      ...over,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it('hides another manager from a manager', async () => {
    const { company, me } = await withHiddenManager();
    const theirs = await seed.bonus(company.id, {
      emp_id: 20,
      amount: 900,
      date: '2026-10-05',
    });
    await seed.bonus(company.id, {
      emp_id: 21,
      amount: 300,
      date: '2026-10-05',
    });
    expect((await me.get('/bonuses')).body.map((b: any) => b.emp_id)).toEqual([
      21,
    ]);
    expect(
      (
        await me
          .post('/bonuses')
          .send({ emp_id: 20, amount: 1, date: '2026-10-06', reason: 'x' })
      ).status,
    ).toBe(403);
    expect((await me.delete(`/bonuses/${theirs._id}`)).status).toBe(403);
  });
});

describe('work time', () => {
  const day = (over: object = {}) => ({
    emp_id: 7,
    shift_id: 's1',
    work_date: '2026-10-20',
    clock_in: '08:05',
    clock_out: '16:30',
    late_minutes: '5',
    overtime_minutes: '30',
    work_hours: '08:25',
    ...over,
  });

  it('saves a day, reads it back and fills in the defaults', async () => {
    const { admin } = await setup();
    const created = await admin
      .post('/worktime')
      .send({ emp_id: 7, work_date: '2026-10-20' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      emp_id: 7,
      work_date: '2026-10-20T00:00:00.000Z',
      clock_in: '00:00',
      clock_out: '00:00',
      work_hours: '00:00',
      penalty: 0,
      bonus: 0,
      consomation: 0,
      absent: false,
    });
    expect((await admin.get(`/worktime/${created.body._id}`)).body.emp_id).toBe(
      7,
    );
  });

  it('finds the records of one employee, shift or day', async () => {
    const { admin } = await setup();
    await admin.post('/worktime').send(day());
    await admin.post('/worktime').send(day({ emp_id: 8 }));
    await admin.post('/worktime').send(day({ shift_id: 's2' }));
    await admin.post('/worktime').send(day({ work_date: '2026-10-21' }));
    const count = async (q: string) =>
      (await admin.get(`/worktime?${q}`)).body.length;
    expect(await count('')).toBe(4);
    expect(await count('emp_id=7')).toBe(3);
    expect(await count('emp_id=abc')).toBe(4);
    expect(await count('shift_id=s2')).toBe(1);
    expect(await count('work_date=2026-10-20')).toBe(3);
    expect(await count('emp_id=7&shift_id=s1&work_date=2026-10-21')).toBe(1);
  });

  it('finds the day the same way on a server in Algeria', async () => {
    const { admin } = await setup();
    await admin.post('/worktime').send(day());
    await withTimeZone('Africa/Algiers', async () => {
      expect(
        (await admin.get('/worktime?work_date=2026-10-20')).body,
      ).toHaveLength(1);
      expect(
        (await admin.get('/worktime?work_date=2026-10-19')).body,
      ).toHaveLength(0);
    });
  });

  it('updates a record and refuses bad values', async () => {
    const { admin } = await setup();
    const { _id } = (await admin.post('/worktime').send(day())).body;
    const res = await admin
      .put(`/worktime/${_id}`)
      .send({ clock_out: '17:00', penalty: 200, absent: true });
    expect(res.body).toMatchObject({
      clock_in: '08:05',
      clock_out: '17:00',
      penalty: 200,
      absent: true,
    });
    expect(
      (await admin.put(`/worktime/${_id}`).send({ penalty: 'lots' })).status,
    ).toBe(400);
    const missing = await admin
      .put(`/worktime/${unknownId()}`)
      .send({ penalty: 1 });
    expect(missing.status).toBe(404);
  });

  it('deletes a record', async () => {
    const { admin } = await setup();
    const { _id } = (await admin.post('/worktime').send(day())).body;
    expect((await admin.delete(`/worktime/${_id}`)).body._id).toBe(_id);
    expect((await admin.get('/worktime')).body).toEqual([]);
  });

  // BUG-403: two records can be saved for the same employee, shift and day, and payroll counts both
  it('keeps one record per employee, shift and day', async () => {
    const { admin } = await setup();
    await Promise.all([
      admin.post('/worktime').send(day()),
      admin.post('/worktime').send(day()),
    ]);
    expect(
      (await admin.get('/worktime?emp_id=7&work_date=2026-10-20')).body,
    ).toHaveLength(1);
  });

  it('updates the day on a second save, and keeps what it doesn’t send', async () => {
    const { admin } = await setup();
    const first = await admin.post('/worktime').send(day({ penalty: 200 }));
    const second = await admin
      .post('/worktime')
      .send({
        emp_id: 7,
        shift_id: 's1',
        work_date: '2026-10-20',
        clock_out: '17:00',
      });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      _id: first.body._id,
      clock_in: '08:05',
      clock_out: '17:00',
      penalty: 200,
    });
  });

  it('keeps one record for a day without a shift', async () => {
    const { admin } = await setup();
    const body = { emp_id: 7, work_date: '2026-10-20' };
    await admin.post('/worktime').send(body);
    await admin.post('/worktime').send(body);
    expect((await admin.get('/worktime')).body).toHaveLength(1);
  });

  it('never lands a save without an employee on someone else’s record', async () => {
    const { admin } = await setup();
    await admin.post('/worktime').send(day());
    const res = await admin
      .post('/worktime')
      .send({ shift_id: 's1', work_date: '2026-10-20', clock_in: '23:59' });
    expect(res.status).toBe(400);
    const [kept] = (await admin.get('/worktime')).body;
    expect(kept).toMatchObject({ emp_id: 7, clock_in: '08:05' });
  });

  it('keeps two companies’ days apart', async () => {
    const a = await setup();
    const b = await setup();
    await a.admin.post('/worktime').send(day());
    await b.admin.post('/worktime').send(day({ clock_in: '09:00' }));
    expect((await a.admin.get('/worktime')).body[0].clock_in).toBe('08:05');
    expect((await b.admin.get('/worktime')).body[0].clock_in).toBe('09:00');
  });

  describe('the report', () => {
    it('lists a date range, for everyone or one employee', async () => {
      const { admin } = await setup();
      for (const d of [
        '2026-09-30',
        '2026-10-01',
        '2026-10-31',
        '2026-11-01',
      ]) {
        await admin.post('/worktime').send(day({ work_date: d }));
      }
      await admin
        .post('/worktime')
        .send(day({ emp_id: 8, work_date: '2026-10-15' }));
      const dates = async (q: string) =>
        (await admin.get(`/worktime/report?${q}`)).body.map((w: any) =>
          w.work_date.slice(0, 10),
        );
      expect(await dates('start=2026-10-01&end=2026-10-31')).toEqual([
        '2026-10-01',
        '2026-10-15',
        '2026-10-31',
      ]);
      expect(await dates('start=2026-10-01&end=2026-10-31&empId=7')).toEqual([
        '2026-10-01',
        '2026-10-31',
      ]);
      expect(await dates('emp_id=8')).toEqual(['2026-10-15']);
    });

    it("leaves out another manager's days for a manager", async () => {
      const { company, me } = await withHiddenManager();
      await seed.worktime(company.id, { emp_id: 20, work_date: '2026-10-05' });
      await seed.worktime(company.id, { emp_id: 21, work_date: '2026-10-05' });
      expect(
        (await me.get('/worktime/report')).body.map((w: any) => w.emp_id),
      ).toEqual([21]);
    });
  });

  it("keeps each company's work time apart", async () => {
    const { admin } = await setup();
    const theirs = await seed.worktime((await seed.company()).id, {
      emp_id: 7,
      penalty: 0,
    });
    expect((await admin.get('/worktime')).body).toEqual([]);
    expect(
      (await admin.put(`/worktime/${theirs._id}`).send({ penalty: 999 }))
        .status,
    ).toBe(404);
    const stored = await t
      .model('Worktime')
      .collection.findOne({ _id: theirs._id });
    expect(stored?.penalty).toBe(0);
  });
});
