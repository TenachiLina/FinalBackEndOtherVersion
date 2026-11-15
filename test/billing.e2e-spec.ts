import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { runAsSystem } from '../src/tenancy/tenant-context';

// Packs (the offers the super admin sells), a company's subscription (trial
// or paid, with payments recorded by hand), what happens when it ends
// (read-only), the pack's employee limit, and pages switched off one by one.

let t: TestApp;
let seed: ReturnType<typeof seeder>;
let root: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
  root = await loginAs(t, await seed.user('superadmin', null, { name: 'Root' }));
});
afterAll(() => t.close());

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (days: number) => iso(new Date(Date.now() + days * DAY));

let packNumber = 0;
async function makePack(overrides: Record<string, unknown> = {}) {
  const res = await root.post('/packs').send({
    name: `Pack ${++packNumber}`,
    price: 5000,
    periodMonths: 1,
    trialDays: 14,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** A company with a signed-in admin. */
async function makeCompany() {
  const company = await seed.company();
  const admin = await loginAs(t, await seed.user('admin', company.id));
  return { company, admin };
}

/** Sets the end of a company's subscription directly (to test the days around it). */
async function endAt(companyId: string, endsAt: Date) {
  await runAsSystem(async () => {
    await t
      .model('Company')
      .updateOne({ _id: companyId }, { $set: { 'subscription.endsAt': endsAt } });
  });
  // The guard keeps companies for a moment: read it fresh
  await root.get(`/companies/${companyId}`);
}

describe('packs', () => {
  it('the super admin creates a pack', async () => {
    const res = await root.post('/packs').send({
      name: 'Starter',
      description: 'Planning and clock-in for small teams',
      price: 3000,
      currency: 'DA',
      periodMonths: 1,
      features: ['planning', 'clockin'],
      disabledPages: ['kiosk'],
      maxEmployees: 15,
      trialDays: 30,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Starter',
      description: 'Planning and clock-in for small teams',
      price: 3000,
      currency: 'DA',
      periodMonths: 1,
      features: ['planning', 'clockin'],
      disabledPages: ['kiosk'],
      maxEmployees: 15,
      trialDays: 30,
      active: true,
    });
    const list = await root.get('/packs');
    expect(list.body.map((p: any) => p.name)).toContain('Starter');
  });

  it('a pack gets every feature, no limit and a 14-day trial by default', async () => {
    const res = await root.post('/packs').send({ name: 'Everything' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      price: 0,
      periodMonths: 1,
      maxEmployees: null,
      trialDays: 14,
      disabledPages: [],
    });
    expect(res.body.features).toHaveLength(6);
  });

  it('changes a pack, and archives it', async () => {
    const pack = await makePack();
    const res = await root
      .patch(`/packs/${pack._id}`)
      .send({ price: 9000, maxEmployees: '', active: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ price: 9000, maxEmployees: null, active: false });
  });

  it.each([
    [{ name: '' }, 'Pack name is required'],
    [{ name: 'x'.repeat(61) }, 'Pack name must be at most 60 characters'],
    [{ name: 'P', price: -1 }, 'Price must be 0 or more'],
    [{ name: 'P', price: 'free' }, 'Price must be 0 or more'],
    [{ name: 'P', periodMonths: 0 }, 'Billing period must be 1 to 36 months'],
    [{ name: 'P', periodMonths: 1.5 }, 'Billing period must be 1 to 36 months'],
    [{ name: 'P', features: ['payroll'] }, /^Features must be from: /],
    [{ name: 'P', disabledPages: ['settings'] }, 'Unknown page'],
    [
      { name: 'P', maxEmployees: -3 },
      'Employee limit must be a whole number, or empty for no limit',
    ],
    [{ name: 'P', trialDays: 400 }, 'Trial length must be 0 to 365 days'],
    [{ name: 'P', currency: '' }, 'Currency must be 1 to 8 characters'],
    [{ name: 'P', description: 'd'.repeat(301) }, 'Description must be at most 300 characters'],
  ])('refuses %j', async (body, message) => {
    const res = await root.post('/packs').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      typeof message === 'string' ? message : expect.stringMatching(message),
    );
  });

  it('refuses two packs with the same name', async () => {
    const pack = await makePack();
    const res = await root.post('/packs').send({ name: pack.name });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A pack with this name already exists');
  });

  it('deletes a pack no company uses, not one in use', async () => {
    const unused = await makePack();
    const del = await root.delete(`/packs/${unused._id}`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, name: unused.name });

    const used = await makePack();
    const { company } = await makeCompany();
    await root.put(`/companies/${company.id}/subscription`).send({ packId: used._id, kind: 'trial' });
    const refused = await root.delete(`/packs/${used._id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe(
      'This pack is used by a company: archive it instead of deleting it',
    );
  });

  it('answers 404 for an unknown pack', async () => {
    for (const id of [unknownId(), 'nope']) {
      expect((await root.patch(`/packs/${id}`).send({ price: 1 })).status).toBe(404);
      expect((await root.delete(`/packs/${id}`)).status).toBe(404);
    }
  });

  it('lists the pages that can be switched off, with their feature', async () => {
    const res = await root.get('/packs/pages');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kiosk: 'clockin', payslips: 'reporting', insuredEmployees: null });
  });

  it('is for the super admin only', async () => {
    const { admin } = await makeCompany();
    expect((await admin.get('/packs')).status).toBe(403);
    expect((await admin.post('/packs').send({ name: 'Mine' })).status).toBe(403);
  });
});

describe('giving a company a pack', () => {
  it('starts a trial of the pack length, and applies what the pack contains', async () => {
    const pack = await makePack({
      features: ['planning', 'clockin'],
      disabledPages: ['kiosk'],
      maxEmployees: 10,
      trialDays: 30,
    });
    const { company, admin } = await makeCompany();
    const res = await root
      .put(`/companies/${company.id}/subscription`)
      .send({ packId: pack._id, kind: 'trial' });
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual(['planning', 'clockin']);
    expect(res.body.disabledPages).toEqual(['kiosk']);
    expect(res.body.subscription).toMatchObject({
      packName: pack.name,
      status: 'trial',
      maxEmployees: 10,
      price: 5000,
      payments: [],
    });
    expect(iso(new Date(res.body.subscription.startsAt))).toBe(inDays(0));
    expect(iso(new Date(res.body.subscription.endsAt))).toBe(inDays(30));
    expect(res.body.subscriptionState).toMatchObject({
      status: 'trial',
      readOnly: false,
      endingSoon: false,
      maxEmployees: 10,
    });

    // The company's own users see where it stands, without prices or payments
    const me = await admin.get('/auth/me');
    expect(me.body.company.features).toEqual(['planning', 'clockin']);
    expect(me.body.company.disabledPages).toEqual(['kiosk']);
    expect(me.body.company.subscription).toMatchObject({
      status: 'trial',
      kind: 'trial',
      packName: pack.name,
      readOnly: false,
      maxEmployees: 10,
    });
    expect(me.body.company.subscription.payments).toBeUndefined();
    expect(me.body.company.subscription.price).toBeUndefined();
  });

  it('starts a paid period of the pack billing length', async () => {
    const pack = await makePack({ periodMonths: 3 });
    const { company } = await makeCompany();
    const res = await root
      .put(`/companies/${company.id}/subscription`)
      .send({ packId: pack._id, kind: 'active', startsAt: '2030-01-15' });
    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe('active');
    expect(new Date(res.body.subscription.startsAt).toISOString()).toBe('2030-01-15T00:00:00.000Z');
    expect(new Date(res.body.subscription.endsAt).toISOString()).toBe('2030-04-15T23:59:59.999Z');
  });

  it('takes the dates, trial length, months and employee limit given', async () => {
    const pack = await makePack({ maxEmployees: 10 });
    const { company } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    const dates = await root
      .put(url)
      .send({ packId: pack._id, kind: 'active', startsAt: '2030-01-01', endsAt: '2030-12-31', maxEmployees: 25, note: 'Paid by cheque' });
    expect(new Date(dates.body.subscription.endsAt).toISOString()).toBe('2030-12-31T23:59:59.999Z');
    expect(dates.body.subscription).toMatchObject({ maxEmployees: 25, note: 'Paid by cheque' });

    const trial = await root.put(url).send({ packId: pack._id, kind: 'trial', trialDays: 7 });
    expect(iso(new Date(trial.body.subscription.endsAt))).toBe(inDays(7));

    const months = await root.put(url).send({ packId: pack._id, kind: 'active', startsAt: '2030-01-31', months: 1 });
    expect(new Date(months.body.subscription.endsAt).toISOString()).toBe('2030-02-28T23:59:59.999Z');

    const unlimited = await root.put(url).send({ packId: pack._id, kind: 'active', maxEmployees: '' });
    expect(unlimited.body.subscription.maxEmployees).toBeNull();
  });

  it('changes the dates of a subscription without choosing the pack again', async () => {
    const pack = await makePack();
    const { company } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    await root.put(url).send({ packId: pack._id, kind: 'active', startsAt: '2030-01-01' });
    const res = await root.put(url).send({ endsAt: '2030-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.subscription).toMatchObject({ packName: pack.name, status: 'active' });
    expect(new Date(res.body.subscription.startsAt).toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(new Date(res.body.subscription.endsAt).toISOString()).toBe('2030-06-30T23:59:59.999Z');
  });

  it.each([
    [{ kind: 'trial' }, 'Choose a pack'],
    [{ packId: 'PACK', kind: 'forever' }, 'Choose a trial or a paid subscription'],
    [{ packId: 'PACK' }, 'Choose a trial or a paid subscription'],
    [{ packId: 'PACK', kind: 'active', startsAt: '01/01/2030' }, 'Start date must be YYYY-MM-DD'],
    [{ packId: 'PACK', kind: 'active', endsAt: '2030-02-30' }, 'End date must be YYYY-MM-DD'],
    [
      { packId: 'PACK', kind: 'active', startsAt: '2030-02-01', endsAt: '2030-01-01' },
      'The end date must be on or after the start',
    ],
    [{ packId: 'PACK', kind: 'trial', trialDays: 0 }, 'Trial length must be 1 to 365 days'],
    [{ packId: 'PACK', kind: 'active', months: 40 }, 'Months must be 1 to 36'],
    [
      { packId: 'PACK', kind: 'active', maxEmployees: 2.5 },
      'Employee limit must be a whole number, or empty for no limit',
    ],
    [{ packId: 'PACK', kind: 'active', note: 'n'.repeat(301) }, 'Note must be at most 300 characters'],
  ])('refuses %j', async (body, message) => {
    const pack = await makePack();
    const { company } = await makeCompany();
    const res = await root
      .put(`/companies/${company.id}/subscription`)
      .send({ ...body, ...('packId' in body ? { packId: pack._id } : {}) });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it('refuses an archived or unknown pack, and an unknown company', async () => {
    const archived = await makePack({ active: false });
    const { company } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    const old = await root.put(url).send({ packId: archived._id, kind: 'trial' });
    expect(old.status).toBe(400);
    expect(old.body.message).toBe('This pack is archived: choose another one');
    expect((await root.put(url).send({ packId: unknownId(), kind: 'trial' })).status).toBe(404);
    const pack = await makePack();
    const nowhere = await root
      .put(`/companies/${unknownId()}/subscription`)
      .send({ packId: pack._id, kind: 'trial' });
    expect(nowhere.status).toBe(404);
  });

  it("is for the super admin only: a company can't change its own subscription", async () => {
    const pack = await makePack();
    const { company, admin } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    expect((await admin.put(url).send({ packId: pack._id, kind: 'active' })).status).toBe(403);
    expect((await admin.post(`${url}/payments`).send({ amount: 1 })).status).toBe(403);
    expect((await admin.delete(url)).status).toBe(403);
  });

  it('removing the subscription leaves the company unlimited', async () => {
    const pack = await makePack({ maxEmployees: 1 });
    const { company, admin } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    await root.put(url).send({ packId: pack._id, kind: 'trial' });
    const res = await root.delete(url);
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
    expect(res.body.subscriptionState).toMatchObject({ status: 'none', readOnly: false });
    const me = await admin.get('/auth/me');
    expect(me.body.company.subscription).toMatchObject({ status: 'none', maxEmployees: null });
  });
});

describe('payments, recorded by hand', () => {
  async function onTrial(packOverrides: Record<string, unknown> = {}) {
    const pack = await makePack(packOverrides);
    const { company, admin } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    await root.put(url).send({ packId: pack._id, kind: 'trial', trialDays: 10 });
    return { pack, company, admin, url };
  }

  it('a payment turns the trial into a paid subscription and adds its months', async () => {
    const { url } = await onTrial({ periodMonths: 1 });
    const res = await root.post(`${url}/payments`).send({
      amount: 5000,
      date: '2026-11-10',
      method: 'Bank transfer',
      reference: 'VIR-2291',
      note: 'First month',
      months: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.subscription.status).toBe('active');
    expect(res.body.subscription.payments).toHaveLength(1);
    expect(res.body.subscription.payments[0]).toMatchObject({
      amount: 5000,
      date: '2026-11-10',
      method: 'Bank transfer',
      reference: 'VIR-2291',
      note: 'First month',
      months: 3,
      recordedBy: 'Root',
    });
    // 3 months after the end of the 10-day trial
    const end = new Date(Date.now() + 10 * DAY);
    end.setUTCMonth(end.getUTCMonth() + 3);
    expect(iso(new Date(res.body.subscription.endsAt)).slice(0, 7)).toBe(iso(end).slice(0, 7));
    expect(res.body.subscriptionState).toMatchObject({ status: 'active', readOnly: false });
  });

  it('uses the pack billing length and today when months and date are left out', async () => {
    const { url } = await onTrial({ periodMonths: 6 });
    const res = await root.post(`${url}/payments`).send({ amount: 30000 });
    expect(res.status).toBe(201);
    expect(res.body.subscription.payments[0]).toMatchObject({ months: 6, date: inDays(0) });
  });

  it('months 0 records a payment without moving the end date', async () => {
    const { url } = await onTrial();
    const before = (await root.put(url).send({})).body.subscription.endsAt;
    const res = await root.post(`${url}/payments`).send({ amount: 100, months: 0 });
    expect(res.status).toBe(201);
    expect(res.body.subscription.endsAt).toBe(before);
    expect(res.body.subscription.status).toBe('trial');
    expect(res.body.subscription.payments).toHaveLength(1);
  });

  it('a payment after the end starts again from today: the gap is not charged', async () => {
    const { url, company } = await onTrial();
    await endAt(company.id, new Date(Date.now() - 40 * DAY));
    const res = await root.post(`${url}/payments`).send({ amount: 5000, months: 1 });
    const end = new Date();
    end.setUTCMonth(end.getUTCMonth() + 1);
    expect(iso(new Date(res.body.subscription.endsAt))).toBe(iso(end));
    expect(res.body.subscriptionState.readOnly).toBe(false);
  });

  it('keeps every payment, in order', async () => {
    const { url } = await onTrial();
    await root.post(`${url}/payments`).send({ amount: 1000, months: 1 });
    const res = await root.post(`${url}/payments`).send({ amount: 2000, months: 1 });
    expect(res.body.subscription.payments.map((p: any) => p.amount)).toEqual([1000, 2000]);
  });

  it.each([
    [{}, 'amount must be greater than 0'],
    [{ amount: 0 }, 'amount must be greater than 0'],
    [{ amount: -50 }, 'amount must be greater than 0'],
    [{ amount: 'a lot' }, 'amount must be greater than 0'],
    [{ amount: 100, date: '10/11/2026' }, 'date must be YYYY-MM-DD'],
    [{ amount: 100, months: -1 }, 'Months must be 0 to 36'],
    [{ amount: 100, months: 1.5 }, 'Months must be 0 to 36'],
    [{ amount: 100, method: 'm'.repeat(41) }, 'Payment method must be at most 40 characters'],
    [{ amount: 100, reference: 'r'.repeat(81) }, 'Reference must be at most 80 characters'],
  ])('refuses %j', async (body, message) => {
    const { url } = await onTrial();
    const res = await root.post(`${url}/payments`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it('needs a subscription first', async () => {
    const { company } = await makeCompany();
    const res = await root.post(`/companies/${company.id}/subscription/payments`).send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Give this company a pack before recording a payment');
  });
});

describe('the end of a subscription', () => {
  async function subscribed() {
    const pack = await makePack();
    const { company, admin } = await makeCompany();
    await root.put(`/companies/${company.id}/subscription`).send({ packId: pack._id, kind: 'active' });
    const employee = await seed.employee(company.id, { empNumber: 1 });
    return { company, admin, employee };
  }

  it('says nothing while more than 7 days are left', async () => {
    const { company, admin } = await subscribed();
    await endAt(company.id, new Date(Date.now() + 20 * DAY));
    const me = await admin.get('/auth/me');
    expect(me.body.company.subscription).toMatchObject({ endingSoon: false, readOnly: false, daysLeft: 19 });
  });

  it('warns during the last 7 days, and still works', async () => {
    const { company, admin } = await subscribed();
    await endAt(company.id, new Date(Date.now() + 3 * DAY + 60_000));
    const me = await admin.get('/auth/me');
    expect(me.body.company.subscription).toMatchObject({ endingSoon: true, readOnly: false, daysLeft: 3 });
    const res = await admin.post('/employees').send({ empNumber: 2, firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(201);
  });

  it('is read-only after the end: everything can be read, nothing changed', async () => {
    const { company, admin, employee } = await subscribed();
    await endAt(company.id, new Date(Date.now() - DAY));
    const me = await admin.get('/auth/me');
    expect(me.body.company.subscription).toMatchObject({ status: 'expired', readOnly: true });

    for (const url of ['/employees', '/shifts', '/planning', '/company', '/worktime']) {
      expect((await admin.get(url)).status).toBe(200);
    }
    const message = 'Your subscription has ended: the account is read-only until it is renewed';
    const refused = [
      await admin.post('/employees').send({ empNumber: 9, firstName: 'A', lastName: 'B' }),
      await admin.put(`/employees/${employee._id}`).send({ firstName: 'New' }),
      await admin.delete(`/employees/${employee._id}`),
      await admin.patch('/company').send({ name: 'Renamed' }),
      await admin.post('/shifts').send({ startTime: '08:00', endTime: '16:00' }),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(message);
    }
    expect((await seed.find(company.id, 'Employee')).map((e: any) => e.firstName)).toEqual([
      employee.firstName,
    ]);
  });

  it('people can still sign in, change their password and sign out', async () => {
    const { company } = await subscribed();
    await endAt(company.id, new Date(Date.now() - DAY));
    const user = await seed.user('manager', company.id);
    const client = await loginAs(t, user);
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await client.post('/auth/logout')).status).toBeLessThan(300);
  });

  it('the super admin can still change things inside the company, to help', async () => {
    const { company } = await subscribed();
    await endAt(company.id, new Date(Date.now() - DAY));
    const inside = await loginAs(t, await seed.user('superadmin', null), { companyId: company.id });
    const res = await inside.post('/employees').send({ empNumber: 5, firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(201);
  });

  it('works again as soon as a payment is recorded', async () => {
    const { company, admin } = await subscribed();
    await endAt(company.id, new Date(Date.now() - DAY));
    expect((await admin.patch('/company').send({ name: 'Renamed' })).status).toBe(403);
    await root.post(`/companies/${company.id}/subscription/payments`).send({ amount: 5000, months: 1 });
    expect((await admin.patch('/company').send({ name: 'Renamed' })).status).toBe(200);
  });

  it('a company without a subscription never ends', async () => {
    const { admin } = await makeCompany();
    const me = await admin.get('/auth/me');
    expect(me.body.company.subscription).toMatchObject({ status: 'none', readOnly: false, endsAt: null });
    expect((await admin.patch('/company').send({ name: 'Free' })).status).toBe(200);
  });
});

describe("the pack's employee limit", () => {
  it('refuses one employee too many', async () => {
    const pack = await makePack({ maxEmployees: 2 });
    const { company, admin } = await makeCompany();
    await root.put(`/companies/${company.id}/subscription`).send({ packId: pack._id, kind: 'active' });
    const add = (n: number) => admin.post('/employees').send({ empNumber: n, firstName: 'A', lastName: `B${n}` });
    expect((await add(1)).status).toBe(201);
    expect((await add(2)).status).toBe(201);
    const third = await add(3);
    expect(third.status).toBe(403);
    expect(third.body.message).toBe(
      'Your pack is full: it has no room for another employee. Contact us to upgrade',
    );
    expect(await seed.find(company.id, 'Employee')).toHaveLength(2);
  });

  it('makes room again when the limit is raised or removed', async () => {
    const pack = await makePack({ maxEmployees: 1 });
    const { company, admin } = await makeCompany();
    const url = `/companies/${company.id}/subscription`;
    await root.put(url).send({ packId: pack._id, kind: 'active' });
    await admin.post('/employees').send({ empNumber: 1, firstName: 'A', lastName: 'B' });
    expect((await admin.post('/employees').send({ empNumber: 2, firstName: 'A', lastName: 'C' })).status).toBe(403);
    await root.put(url).send({ maxEmployees: '' });
    expect((await admin.post('/employees').send({ empNumber: 2, firstName: 'A', lastName: 'C' })).status).toBe(201);
  });

  it("counts this company's employees only", async () => {
    const pack = await makePack({ maxEmployees: 1 });
    const a = await makeCompany();
    const b = await makeCompany();
    for (const c of [a, b]) {
      await root.put(`/companies/${c.company.id}/subscription`).send({ packId: pack._id, kind: 'active' });
    }
    expect((await a.admin.post('/employees').send({ empNumber: 1, firstName: 'A', lastName: 'B' })).status).toBe(201);
    expect((await b.admin.post('/employees').send({ empNumber: 1, firstName: 'A', lastName: 'B' })).status).toBe(201);
  });
});

describe('pages switched off one by one', () => {
  it('clock-in on with the kiosk off: the kiosk routes are refused, the rest works', async () => {
    const { company, admin } = await makeCompany();
    const kiosk = await loginAs(t, await seed.user('employee', company.id));
    expect((await kiosk.get('/kiosk/employees')).status).toBe(200);

    const res = await root.patch(`/companies/${company.id}`).send({ disabledPages: ['kiosk'] });
    expect(res.status).toBe(200);
    expect(res.body.disabledPages).toEqual(['kiosk']);

    const off = await kiosk.get('/kiosk/employees');
    expect(off.status).toBe(403);
    expect(off.body.message).toBe('This page is not enabled for this company');
    expect((await kiosk.post('/kiosk/clock').send({ empNumber: 1, action: 'in' })).status).toBe(403);
    // Clock-in itself stays on for the managers
    expect((await admin.get('/worktime')).status).toBe(200);
    expect((await admin.get('/auth/me')).body.company.disabledPages).toEqual(['kiosk']);
  });

  it('reporting on with payslips off', async () => {
    const { company, admin } = await makeCompany();
    await root.patch(`/companies/${company.id}`).send({ disabledPages: ['payslips'] });
    expect((await admin.get('/payroll/payslips?month=2026-10')).status).toBe(403);
    expect((await admin.get('/payroll/period?start=2026-10-01&end=2026-10-31')).status).toBe(200);
  });

  it('switching a page back on', async () => {
    const { company, admin } = await makeCompany();
    await root.patch(`/companies/${company.id}`).send({ disabledPages: ['payslips'] });
    await root.patch(`/companies/${company.id}`).send({ disabledPages: [] });
    expect((await admin.get('/payroll/payslips?month=2026-10')).status).toBe(200);
  });

  it('refuses a page that does not exist', async () => {
    const { company } = await makeCompany();
    for (const disabledPages of [['users'], 'kiosk', [42]]) {
      const res = await root.patch(`/companies/${company.id}`).send({ disabledPages });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Unknown page');
    }
  });

  it("a company admin can't switch pages on or off", async () => {
    const { company, admin } = await makeCompany();
    await root.patch(`/companies/${company.id}`).send({ disabledPages: ['kiosk'] });
    const res = await admin.patch('/company').send({ disabledPages: [] });
    expect(res.status).toBe(200);
    expect(res.body.disabledPages).toEqual(['kiosk']);
  });
});
