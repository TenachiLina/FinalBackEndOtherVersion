import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';

// Request bodies are checked before they reach a service or the database
// (src/common/validate.ts): wrong values are refused with a clear message,
// and fields the route doesn't know are never saved.

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

describe('employees', () => {
  it.each([
    [
      {},
      [
        'Employee number is required',
        'First name is required',
        'Last name is required',
      ],
    ],
    [
      { empNumber: 0, firstName: 'A', lastName: 'B' },
      ['Employee number is too small'],
    ],
    [
      { empNumber: 'x', firstName: 'A', lastName: 'B' },
      ['Employee number has an invalid value'],
    ],
    [
      { empNumber: 1, firstName: 'A', lastName: 'B', baseSalary: -10 },
      ['Base salary is too small'],
    ],
    [
      { empNumber: 1, firstName: 'A', lastName: 'B', familyStatus: 'X' },
      ["Family status has a value that isn't allowed"],
    ],
    [
      { empNumber: 1, firstName: 'A', lastName: 'B', birthDate: '31/01/2000' },
      ['Date of birth has an invalid value'],
    ],
    [
      { empNumber: 1, firstName: { $ne: '' }, lastName: 'B' },
      'The data sent was not valid',
    ],
  ])('POST %j → 400', async (body, message) => {
    const { admin, company } = await setup();
    const res = await admin.post('/employees').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(message);
    expect(await seed.find(company.id, 'Employee')).toEqual([]);
  });

  it.each([[[]], ['text']])('POST %j (not an object) → 400', async (body) => {
    const { admin } = await setup();
    const res = await admin.post('/employees').send(body as any);
    expect(res.status).toBe(400);
  });

  it('saves the known fields, cleaned, and nothing else', async () => {
    const { admin, company } = await setup();
    const res = await admin.post('/employees').send({
      empNumber: '7',
      firstName: '  Ali ',
      lastName: 'Zerrouki',
      baseSalary: '45000',
      companyId: '000000000000000000000000',
      isArchived: true,
      role: 'admin',
      unknown: 'x',
    });
    expect(res.status).toBe(201);
    const [saved] = await seed.find(company.id, 'Employee');
    expect(saved).toMatchObject({
      empNumber: 7,
      firstName: 'Ali',
      baseSalary: 45000,
      isArchived: false,
    });
    expect(String(saved.companyId)).toBe(company.id);
    expect(saved.role).toBeUndefined();
    expect(saved.unknown).toBeUndefined();
  });

  it('an edit checks only what it sends, and refuses to empty the name', async () => {
    const { admin, company } = await setup();
    const employee = await seed.employee(company.id, {
      empNumber: 1,
      firstName: 'Ali',
    });
    const ok = await admin
      .put(`/employees/${employee._id}`)
      .send({ jobTitle: 'Chef', address: '' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      firstName: 'Ali',
      jobTitle: 'Chef',
      address: '',
    });

    const empty = await admin
      .put(`/employees/${employee._id}`)
      .send({ firstName: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toEqual(['First name is required']);
    const bad = await admin
      .put(`/employees/${employee._id}`)
      .send({ baseSalary: 'a lot' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toEqual(['Base salary has an invalid value']);
    const [kept] = await seed.find(company.id, 'Employee');
    expect(kept).toMatchObject({ firstName: 'Ali', baseSalary: 30000 });
  });

  it('answers in French and Arabic', async () => {
    const { admin } = await setup();
    const fr = await admin
      .post('/employees')
      .set('Accept-Language', 'fr')
      .send({ empNumber: 1, lastName: 'B' });
    expect(fr.body.message).toEqual(['Prénom : champ obligatoire']);
    const ar = await admin
      .post('/employees')
      .set('Accept-Language', 'ar')
      .send({ empNumber: 1, lastName: 'B' });
    expect(ar.body.message).toEqual(['الاسم الشخصي مطلوب']);
  });
});

describe('shifts and posts', () => {
  it('a shift needs two real times', async () => {
    const { admin, company } = await setup();
    const missing = await admin.post('/shifts').send({ startTime: '08:00' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toEqual(['End time is required']);
    const wrong = await admin
      .post('/shifts')
      .send({ startTime: '8h', endTime: '25:00' });
    expect(wrong.body.message).toEqual([
      'Start time has an invalid value',
      'End time has an invalid value',
    ]);
    expect(await seed.find(company.id, 'Shift')).toEqual([]);
    const ok = await admin
      .post('/shifts')
      .send({ startTime: '08:00', endTime: '16:00', isArchived: true });
    expect(ok.status).toBe(201);
    expect(ok.body.isArchived).toBe(false);
    const edit = await admin
      .put(`/shifts/${ok.body._id}`)
      .send({ endTime: 'late' });
    expect(edit.status).toBe(400);
  });

  it('a post needs a number and a name', async () => {
    const { admin } = await setup();
    const res = await admin.post('/tasks').send({ taskId: 'one' });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'Task number has an invalid value',
      'Task name is required',
    ]);
    expect(
      (await admin.post('/tasks').send({ taskId: 1, taskName: 'Grill' }))
        .status,
    ).toBe(201);
  });
});

describe('work time', () => {
  it('refuses wrong times and negative money', async () => {
    const { admin, company } = await setup();
    const res = await admin.post('/worktime').send({
      emp_id: 1,
      work_date: '2026-10-05T00:00:00.000Z',
      clock_in: '8am',
      penalty: -50,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'Clock-in time has an invalid value',
      'Penalty is too small',
    ]);
    expect(await seed.find(company.id, 'Worktime')).toEqual([]);
    expect((await admin.post('/worktime').send({})).body.message).toEqual([
      'Employee is required',
    ]);
  });

  it('accepts a normal record, with an empty clock-out meaning "not clocked out"', async () => {
    const { admin } = await setup();
    const res = await admin.post('/worktime').send({
      emp_id: 1,
      shift_id: 's1',
      work_date: '2026-10-05T00:00:00.000Z',
      clock_in: '08:00',
      clock_out: '',
      work_hours: '00:00',
      consomation: '120',
      companyId: '000000000000000000000000',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      emp_id: 1,
      clock_in: '08:00',
      clock_out: null,
      consomation: 120,
    });
    const edit = await admin
      .put(`/worktime/${res.body._id}`)
      .send({ clock_out: '16:30', late_minutes: 'x' });
    expect(edit.status).toBe(400);
    expect(edit.body.message).toEqual(['Late minutes has an invalid value']);
  });
});

describe('planning entries', () => {
  it('a single entry needs a shift, an employee, a post and a day', async () => {
    const { admin } = await setup();
    const res = await admin.post('/planning').send({ planDate: 'someday' });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'Shift is required',
      'Employee is required',
      'Task number is required',
      'Date has an invalid value',
    ]);
  });
});
