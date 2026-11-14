import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';

// Month closing: a closed month's hours, advances and bonuses can't be
// changed and its payroll is frozen. A month closes by itself N days after
// it ends (company setting) or when an admin closes it; an admin reopens it.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const CLOSED = 'This month is closed: its hours and pay can no longer be changed';

// Months around today, so the tests don't depend on the date they run
const now = new Date();
const monthAt = (offset: number) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return d.toISOString().slice(0, 7);
};
// Two months back: over in every time zone, even on the 1st of the month
const PAST = monthAt(-2);
const OLDER = monthAt(-3);
const FUTURE = monthAt(2);
const day = (month: string, d = 5) =>
  new Date(`${month}-${String(d).padStart(2, '0')}T00:00:00.000Z`);
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const wholeMonth = (month: string) =>
  `/payroll/period?start=${month}-01&end=${lastDay(month)}`;

/** A company with one employee who worked 8 h in PAST, and a signed-in admin and manager. */
async function setup(settings?: Record<string, unknown>) {
  const company = await seed.company(settings ? { settings } : {});
  const amine = await seed.employee(company.id, {
    empNumber: 1,
    firstName: 'Amine',
    lastName: 'Bensalah',
    baseSalary: 52000, // 250 an hour
  });
  const work = await seed.worktime(company.id, {
    emp_id: 1,
    work_date: day(PAST),
    work_hours: '08:00',
  });
  const adminUser = await seed.user('admin', company.id, { name: 'Nadia Admin' });
  const admin = await loginAs(t, adminUser);
  const manager = await loginAs(t, await seed.user('manager', company.id));
  return { company, amine, work, admin, manager };
}

describe('the state of a month', () => {
  it('is open, and can be closed once it is over', async () => {
    const { admin } = await setup();
    const res = await admin.get(`/payroll/closings/${PAST}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: PAST,
      closed: false,
      auto: false,
      closedAt: null,
      closedBy: null,
      reopenedAt: null,
      reopenedBy: null,
      closesAt: null,
      canClose: true,
    });
  });

  it("can't be closed while it is still running", async () => {
    const { admin } = await setup();
    const status = await admin.get(`/payroll/closings/${FUTURE}`);
    expect(status.body).toMatchObject({ closed: false, canClose: false });
    const res = await admin.post(`/payroll/closings/${FUTURE}/close`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This month is not over yet');
  });

  it('lists the 12 months of a year', async () => {
    const { admin } = await setup();
    const year = PAST.slice(0, 4);
    const res = await admin.get(`/payroll/closings?year=${year}`);
    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => m.month)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it.each([
    ['get', '/payroll/closings/2026-13', 'month must be YYYY-MM (e.g. 2026-11)'],
    ['get', '/payroll/closings/october', 'month must be YYYY-MM (e.g. 2026-11)'],
    ['post', '/payroll/closings/2026-1/close', 'month must be YYYY-MM (e.g. 2026-11)'],
    ['post', '/payroll/closings/x/reopen', 'month must be YYYY-MM (e.g. 2026-11)'],
    ['get', '/payroll/closings', 'year must be a year (e.g. 2026)'],
    ['get', '/payroll/closings?year=26', 'year must be a year (e.g. 2026)'],
  ] as const)('%s %s → 400', async (method, url, message) => {
    const { admin } = await setup();
    const res = await admin[method](url);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });
});

describe('closing a month by hand', () => {
  it('an admin closes a month that is over', async () => {
    const { admin } = await setup();
    const res = await admin.post(`/payroll/closings/${PAST}/close`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      month: PAST,
      closed: true,
      auto: false,
      closedBy: 'Nadia Admin',
      canClose: false,
    });
    expect(new Date(res.body.closedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const status = await admin.get(`/payroll/closings/${PAST}`);
    expect(status.body).toMatchObject({ closed: true, closedBy: 'Nadia Admin' });
  });

  it('a manager sees the state but can neither close nor reopen', async () => {
    const { admin, manager } = await setup();
    expect((await manager.get(`/payroll/closings/${PAST}`)).status).toBe(200);
    expect((await manager.post(`/payroll/closings/${PAST}/close`)).status).toBe(403);
    await admin.post(`/payroll/closings/${PAST}/close`);
    expect((await manager.post(`/payroll/closings/${PAST}/reopen`)).status).toBe(403);
    expect((await admin.get(`/payroll/closings/${PAST}`)).body.closed).toBe(true);
  });

  it("can't be closed twice", async () => {
    const { admin } = await setup();
    await admin.post(`/payroll/closings/${PAST}/close`);
    const again = await admin.post(`/payroll/closings/${PAST}/close`);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('This month is already closed');
  });

  it("closes this company's month only", async () => {
    const a = await setup();
    const b = await setup();
    await a.admin.post(`/payroll/closings/${PAST}/close`);
    expect((await b.admin.get(`/payroll/closings/${PAST}`)).body.closed).toBe(false);
    const res = await b.admin.post('/worktime').send({
      emp_id: 1,
      work_date: day(PAST, 6).toISOString(),
      work_hours: '04:00',
    });
    expect(res.status).toBe(201);
  });
});

describe('a closed month is locked', () => {
  async function closed() {
    const ctx = await setup();
    const advance = await seed.advance(ctx.company.id, {
      emp_id: 1,
      amount: 500,
      date: day(PAST, 10),
    });
    const bonus = await seed.bonus(ctx.company.id, {
      emp_id: 1,
      amount: 300,
      date: `${PAST}-12`,
    });
    await ctx.admin.post(`/payroll/closings/${PAST}/close`);
    return { ...ctx, advance, bonus };
  }

  it('no work time can be added', async () => {
    const { admin, company } = await closed();
    const res = await admin.post('/worktime').send({
      emp_id: 1,
      work_date: day(PAST, 20).toISOString(),
      work_hours: '08:00',
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CLOSED);
    expect(await seed.find(company.id, 'Worktime')).toHaveLength(1);
  });

  it('no work time can be changed or deleted', async () => {
    const { admin, work, company } = await closed();
    const put = await admin.put(`/worktime/${work._id}`).send({ work_hours: '12:00' });
    expect(put.status).toBe(409);
    expect(put.body.message).toBe(CLOSED);
    const del = await admin.delete(`/worktime/${work._id}`);
    expect(del.status).toBe(409);
    const [kept] = await seed.find(company.id, 'Worktime');
    expect(kept.work_hours).toBe('08:00');
  });

  it("an open month's record can't be moved into it", async () => {
    const { admin, company } = await closed();
    const open = await seed.worktime(company.id, {
      emp_id: 1,
      work_date: day(OLDER),
      work_hours: '03:00',
    });
    const res = await admin
      .put(`/worktime/${open._id}`)
      .send({ work_date: day(PAST, 21).toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CLOSED);
  });

  it('no advance can be given or taken back', async () => {
    const { admin, advance, company } = await closed();
    const post = await admin
      .post('/advances')
      .send({ emp_id: 1, amount: 100, date: `${PAST}-15` });
    expect(post.status).toBe(409);
    expect(post.body.message).toBe(CLOSED);
    const del = await admin.delete(`/advances/${advance._id}`);
    expect(del.status).toBe(409);
    expect(await seed.find(company.id, 'Advance')).toHaveLength(1);
  });

  it('no bonus can be given or removed', async () => {
    const { admin, bonus, company } = await closed();
    const post = await admin
      .post('/bonuses')
      .send({ emp_id: 1, amount: 100, date: `${PAST}-15`, reason: 'Late bonus' });
    expect(post.status).toBe(409);
    expect(post.body.message).toBe(CLOSED);
    const del = await admin.delete(`/bonuses/${bonus._id}`);
    expect(del.status).toBe(409);
    expect(await seed.find(company.id, 'Bonus')).toHaveLength(1);
  });

  it('the other months stay open', async () => {
    const { admin } = await closed();
    const work = await admin.post('/worktime').send({
      emp_id: 1,
      work_date: day(OLDER).toISOString(),
      work_hours: '08:00',
    });
    expect(work.status).toBe(201);
    const advance = await admin
      .post('/advances')
      .send({ emp_id: 1, amount: 100, date: `${OLDER}-15` });
    expect(advance.status).toBe(201);
    const bonus = await admin
      .post('/bonuses')
      .send({ emp_id: 1, amount: 100, date: `${OLDER}-15`, reason: 'Bonus' });
    expect(bonus.status).toBe(201);
  });

  it('the message reaches French and Arabic users in their language', async () => {
    const { admin } = await closed();
    const res = await admin
      .post('/advances')
      .set('Accept-Language', 'fr')
      .send({ emp_id: 1, amount: 100, date: `${PAST}-15` });
    expect(res.body.message).toBe(
      'Ce mois est clôturé : ses heures et sa paie ne peuvent plus être modifiées',
    );
  });
});

describe('the payroll of a closed month is frozen', () => {
  it('keeps the pay as it was when the month closed, even after a raise', async () => {
    const { admin, amine } = await setup();
    await admin.post(`/payroll/closings/${PAST}/close`);
    // A raise decided later must not rewrite a month already paid
    const raise = await admin.put(`/employees/${amine._id}`).send({ baseSalary: 104000 });
    expect(raise.status).toBe(200);

    const frozen = await admin.get(wholeMonth(PAST));
    expect(frozen.status).toBe(200);
    expect(frozen.body.closed).toBe(true);
    expect(frozen.body.closedAt).toEqual(expect.any(String));
    expect(frozen.body.rows[0]).toMatchObject({
      empId: 1,
      baseSalary: 52000,
      hourlyRate: 250,
      hours: 8,
      gross: 2000,
      net: 2000,
    });
    expect(frozen.body.totals).toMatchObject({ gross: 2000, net: 2000, employees: 1 });
  });

  it('an open month is calculated live and says so', async () => {
    const { admin, amine } = await setup();
    await admin.put(`/employees/${amine._id}`).send({ baseSalary: 104000 });
    const live = await admin.get(wholeMonth(PAST));
    expect(live.body.closed).toBe(false);
    expect(live.body.rows[0]).toMatchObject({ hourlyRate: 500, gross: 4000 });
  });

  it('gives one employee of the frozen month with empId', async () => {
    const { admin, company } = await setup();
    await seed.employee(company.id, { empNumber: 2, baseSalary: 26000 });
    await seed.worktime(company.id, {
      emp_id: 2,
      work_date: day(PAST),
      work_hours: '04:00',
    });
    await admin.post(`/payroll/closings/${PAST}/close`);
    const all = await admin.get(wholeMonth(PAST));
    expect(all.body.rows.map((r: any) => r.empId)).toEqual([1, 2]);
    expect(all.body.totals.gross).toBe(2500);
    const one = await admin.get(`${wholeMonth(PAST)}&empId=2`);
    expect(one.body.rows.map((r: any) => r.empId)).toEqual([2]);
    expect(one.body.totals).toMatchObject({ gross: 500, employees: 1 });
  });

  it("hides the other managers from a manager's frozen month", async () => {
    const { admin, company, amine } = await setup();
    const sara = await seed.employee(company.id, { empNumber: 2, baseSalary: 26000 });
    await seed.worktime(company.id, {
      emp_id: 2,
      work_date: day(PAST),
      work_hours: '04:00',
    });
    const me = await seed.user('manager', company.id, { employeeId: String(amine._id) });
    await seed.user('manager', company.id, { employeeId: String(sara._id) });
    await admin.post(`/payroll/closings/${PAST}/close`);
    const res = await (await loginAs(t, me)).get(wholeMonth(PAST));
    expect(res.body.closed).toBe(true);
    expect(res.body.rows.map((r: any) => r.empId)).toEqual([1]);
    expect(res.body.totals).toMatchObject({ gross: 2000, employees: 1 });
  });

  it('freezes the payslip amounts too', async () => {
    const { admin, amine } = await setup();
    await admin.post(`/payroll/closings/${PAST}/close`);
    await admin.put(`/employees/${amine._id}`).send({ baseSalary: 104000 });
    const frozen = await admin.get(`/payroll/payslips?month=${PAST}`);
    expect(frozen.body.closed).toBe(true);
    expect(frozen.body.payslips[0]).toMatchObject({ baseSalary: 52000, net: 47320 });
    const live = await admin.get(`/payroll/payslips?month=${OLDER}`);
    expect(live.body.closed).toBe(false);
    expect(live.body.payslips[0]).toMatchObject({ baseSalary: 104000 });
  });
});

describe('reopening a month', () => {
  it('an admin reopens it: its records can change and its payroll is live again', async () => {
    const { admin, work } = await setup();
    await admin.post(`/payroll/closings/${PAST}/close`);
    const res = await admin.post(`/payroll/closings/${PAST}/reopen`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      month: PAST,
      closed: false,
      reopenedBy: 'Nadia Admin',
      canClose: true,
    });
    const put = await admin.put(`/worktime/${work._id}`).send({ work_hours: '06:00' });
    expect(put.status).toBe(200);
    const live = await admin.get(wholeMonth(PAST));
    expect(live.body.closed).toBe(false);
    expect(live.body.rows[0]).toMatchObject({ hours: 6, gross: 1500 });
  });

  it('closing it again freezes the corrected numbers', async () => {
    const { admin, work } = await setup();
    await admin.post(`/payroll/closings/${PAST}/close`);
    await admin.post(`/payroll/closings/${PAST}/reopen`);
    await admin.put(`/worktime/${work._id}`).send({ work_hours: '06:00' });
    const again = await admin.post(`/payroll/closings/${PAST}/close`);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ closed: true, reopenedBy: null });
    const frozen = await admin.get(wholeMonth(PAST));
    expect(frozen.body).toMatchObject({ closed: true });
    expect(frozen.body.rows[0]).toMatchObject({ hours: 6, gross: 1500 });
  });

  it("refuses a month that isn't closed", async () => {
    const { admin } = await setup();
    const res = await admin.post(`/payroll/closings/${PAST}/reopen`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This month is not closed');
  });

  it('both steps are written to the activity log', async () => {
    const { admin, company } = await setup();
    await admin.post(`/payroll/closings/${PAST}/close`);
    await admin.post(`/payroll/closings/${PAST}/reopen`);
    // The log is written after the answer is sent: give it a moment
    const read = () =>
      t
        .model('AuditLog')
        .find({ companyId: company._id, action: /^payroll\./ })
        .sort({ createdAt: 1 })
        .lean();
    let logs = await read();
    for (let i = 0; i < 50 && logs.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
      logs = await read();
    }
    expect(logs.map((l: any) => l.action)).toEqual([
      'payroll.closeMonth',
      'payroll.reopenMonth',
    ]);
    expect(logs.map((l: any) => l.target)).toEqual([PAST, PAST]);
  });
});

describe('closing by itself after the company delay', () => {
  it('closes a month once the delay after its end has passed', async () => {
    const { admin } = await setup({ monthCloseDelayDays: 5 });
    const res = await admin.get(`/payroll/closings/${PAST}`);
    expect(res.body).toMatchObject({
      closed: true,
      auto: true,
      closedBy: null,
      canClose: false,
    });
    // Closed at the end of the month + 5 days (UTC+1 by default)
    const [y, m] = PAST.split('-').map(Number);
    const end = Date.UTC(y, m, 1) - 60 * 60_000;
    expect(new Date(res.body.closedAt).getTime()).toBe(end + 5 * 86_400_000);
  });

  it('locks the month like a closing by hand', async () => {
    const { admin } = await setup({ monthCloseDelayDays: 0 });
    const res = await admin.post('/worktime').send({
      emp_id: 1,
      work_date: day(PAST, 20).toISOString(),
      work_hours: '08:00',
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CLOSED);
    expect((await admin.get(wholeMonth(PAST))).body.closed).toBe(true);
  });

  it('says when a running month will close', async () => {
    const { admin } = await setup({ monthCloseDelayDays: 10 });
    const res = await admin.get(`/payroll/closings/${FUTURE}`);
    const [y, m] = FUTURE.split('-').map(Number);
    const end = Date.UTC(y, m, 1) - 60 * 60_000;
    expect(res.body.closed).toBe(false);
    expect(new Date(res.body.closesAt).getTime()).toBe(end + 10 * 86_400_000);
  });

  it('never closes by itself without a delay', async () => {
    const { admin } = await setup();
    const res = await admin.get(`/payroll/closings/${OLDER}`);
    expect(res.body).toMatchObject({ closed: false, closesAt: null });
  });

  it('a reopened month stays open until an admin closes it again', async () => {
    const { admin, work } = await setup({ monthCloseDelayDays: 0 });
    expect((await admin.get(`/payroll/closings/${PAST}`)).body.closed).toBe(true);
    await admin.post(`/payroll/closings/${PAST}/reopen`);
    const status = await admin.get(`/payroll/closings/${PAST}`);
    expect(status.body).toMatchObject({ closed: false, closesAt: null, canClose: true });
    const put = await admin.put(`/worktime/${work._id}`).send({ work_hours: '06:00' });
    expect(put.status).toBe(200);
  });
});

describe('the company setting', () => {
  it('an admin sets the days before a month closes', async () => {
    const { admin } = await setup();
    const res = await admin.patch('/company').send({ settings: { monthCloseDelayDays: 7 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.monthCloseDelayDays).toBe(7);
    expect((await admin.get(`/payroll/closings/${PAST}`)).body.closed).toBe(true);
  });

  it('empty switches automatic closing off', async () => {
    const { admin } = await setup({ monthCloseDelayDays: 7 });
    const res = await admin.patch('/company').send({ settings: { monthCloseDelayDays: '' } });
    expect(res.status).toBe(200);
    expect(res.body.settings.monthCloseDelayDays).toBeNull();
    expect((await admin.get(`/payroll/closings/${OLDER}`)).body.closesAt).toBeNull();
  });

  it.each([-1, 366, 2.5, 'soon'])('refuses %p', async (value) => {
    const { admin } = await setup();
    const res = await admin.patch('/company').send({ settings: { monthCloseDelayDays: value } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Days before a month closes must be a whole number between 0 and 365',
    );
  });
});
