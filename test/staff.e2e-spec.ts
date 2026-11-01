import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';

// Employees, shifts and tasks: the records everything else points to.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

/** A company with an admin signed in. */
async function setup() {
  const company = await seed.company();
  const admin = await loginAs(t, await seed.user('admin', company.id));
  return { company, admin };
}

describe('employees', () => {
  const ali = {
    empNumber: 7,
    firstName: 'Ali',
    lastName: 'Ben',
    baseSalary: 30000,
    phoneNumber: '0550',
    address: 'Oran',
  };

  it('creates, lists, reads, updates and deletes', async () => {
    const { admin } = await setup();
    const created = await admin.post('/employees').send(ali);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject(ali);
    const id = created.body._id;

    expect(
      (await admin.get('/employees')).body.map((e: any) => e.firstName),
    ).toEqual(['Ali']);
    expect((await admin.get(`/employees/${id}`)).body.lastName).toBe('Ben');
    const updated = await admin
      .put(`/employees/${id}`)
      .send({ baseSalary: 32000 });
    expect(updated.body).toMatchObject({ firstName: 'Ali', baseSalary: 32000 });
    expect((await admin.delete(`/employees/${id}`)).status).toBe(200);
    expect((await admin.get('/employees')).body).toEqual([]);
  });

  it('requires a first and a last name', async () => {
    const { admin } = await setup();
    const res = await admin.post('/employees').send({ empNumber: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message.sort()).toEqual([
      'First name is required',
      'Last name is required',
    ]);
  });

  it('refuses an employee number already used in the company, not in another one', async () => {
    const { company, admin } = await setup();
    await seed.employee(company.id, { empNumber: 12 });
    await seed.employee((await seed.company()).id, { empNumber: 13 });
    const dup = await admin.post('/employees').send({ ...ali, empNumber: 12 });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('The employee number "12" is already used');
    expect(
      (await admin.post('/employees').send({ ...ali, empNumber: 13 })).status,
    ).toBe(201);
  });

  // BUG-205: the API accepts an employee without an employee number (the app requires one), then refuses a second one as a duplicate
  it(
    'requires an employee number above 0, as the app does',
    async () => {
      const { admin } = await setup();
      for (const empNumber of [undefined, 0, -3]) {
        const res = await admin
          .post('/employees')
          .send({ firstName: 'A', lastName: 'One', empNumber });
        expect(res.status).toBe(400);
      }
    },
  );

  it('refuses text where a number is expected', async () => {
    const { admin } = await setup();
    const res = await admin
      .post('/employees')
      .send({ ...ali, baseSalary: 'a lot' });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(['Base salary has an invalid value']);
  });

  // BUG-201: an edit can blank an employee's name, which a new employee can't have
  it("refuses an edit that empties the employee's name", async () => {
    const { company, admin } = await setup();
    const emp = await seed.employee(company.id);
    const res = await admin
      .put(`/employees/${emp._id}`)
      .send({ firstName: '' });
    expect(res.status).toBe(400);
  });

  // BUG-202: an unknown id answers 200 with an empty body instead of 404
  it.each([
    ['get', 'employees'],
    ['put', 'employees'],
    ['delete', 'employees'],
    ['get', 'shifts'],
    ['put', 'shifts'],
    ['get', 'tasks'],
    ['put', 'tasks'],
    ['delete', 'tasks'],
  ])('%s /%s/:id with an unknown id → 404', async (method, resource) => {
    const { admin } = await setup();
    const res = await (admin as any)
      [method](`/${resource}/${unknownId()}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it("can't see, change or delete another company's employee", async () => {
    const { admin } = await setup();
    const theirs = await seed.employee((await seed.company()).id, {
      firstName: 'Theirs',
    });
    const id = String(theirs._id);
    expect((await admin.get(`/employees/${id}`)).status).toBe(404);
    await admin.put(`/employees/${id}`).send({ firstName: 'Hacked' });
    await admin.delete(`/employees/${id}`);
    const stored = await t
      .model('Employee')
      .collection.findOne({ _id: theirs._id });
    expect(stored).toMatchObject({ firstName: 'Theirs' });
  });

  describe('as a manager', () => {
    async function withManagers() {
      const company = await seed.company();
      const meEmp = await seed.employee(company.id, {
        firstName: 'Me',
        baseSalary: 40000,
      });
      const otherEmp = await seed.employee(company.id, {
        firstName: 'Other',
        baseSalary: 45000,
        phoneNumber: '0661',
        address: 'Alger',
      });
      const crew = await seed.employee(company.id, {
        firstName: 'Crew',
        baseSalary: 25000,
      });
      await seed.user('manager', company.id, {
        employeeId: String(otherEmp._id),
      });
      const me = await loginAs(
        t,
        await seed.user('manager', company.id, {
          employeeId: String(meEmp._id),
        }),
      );
      return { company, me, meEmp, otherEmp, crew };
    }

    it('sees other managers without their salary or contact details', async () => {
      const { me, otherEmp } = await withManagers();
      const list = (await me.get('/employees')).body;
      const other = list.find((e: any) => e.firstName === 'Other');
      expect(other).toMatchObject({ otherManager: true });
      expect(other).not.toHaveProperty('baseSalary');
      expect(other).not.toHaveProperty('phoneNumber');
      expect(other).not.toHaveProperty('address');
      expect(list.find((e: any) => e.firstName === 'Crew').baseSalary).toBe(
        25000,
      );
      const one = (await me.get(`/employees/${otherEmp._id}`)).body;
      expect(one).not.toHaveProperty('baseSalary');
    });

    it("can't change or delete another manager's record", async () => {
      const { me, otherEmp } = await withManagers();
      const put = await me
        .put(`/employees/${otherEmp._id}`)
        .send({ baseSalary: 1 });
      expect(put.status).toBe(403);
      expect(put.body.message).toBe(
        "You can't see or change another manager's information",
      );
      expect((await me.delete(`/employees/${otherEmp._id}`)).status).toBe(403);
    });

    it('manages the crew', async () => {
      const { me, crew } = await withManagers();
      expect(
        (await me.put(`/employees/${crew._id}`).send({ baseSalary: 26000 }))
          .body.baseSalary,
      ).toBe(26000);
    });

    // BUG-203: a manager can raise their own salary
    it.failing("can't change their own salary", async () => {
      const { me, meEmp } = await withManagers();
      const res = await me
        .put(`/employees/${meEmp._id}`)
        .send({ baseSalary: 99000 });
      expect(res.status).toBe(403);
      const stored = await t
        .model('Employee')
        .collection.findOne({ _id: meEmp._id });
      expect(stored?.baseSalary).toBe(40000);
    });

    it('sees everything when no other manager is linked to an employee', async () => {
      const company = await seed.company();
      await seed.employee(company.id, { firstName: 'Solo', baseSalary: 20000 });
      const me = await loginAs(t, await seed.user('manager', company.id));
      expect((await me.get('/employees')).body[0].baseSalary).toBe(20000);
    });
  });
});

describe('shifts', () => {
  it('creates, lists active/archived/all, archives and restores', async () => {
    const { admin } = await setup();
    const morning = (
      await admin.post('/shifts').send({ startTime: '08:00', endTime: '16:00' })
    ).body;
    const night = (
      await admin.post('/shifts').send({ startTime: '16:00', endTime: '00:00' })
    ).body;
    expect(morning).toMatchObject({
      startTime: '08:00',
      endTime: '16:00',
      isArchived: false,
    });

    expect(
      (await admin.patch(`/shifts/${night._id}/archive`)).body.isArchived,
    ).toBe(true);
    const times = async (q: string) =>
      (await admin.get(`/shifts${q}`)).body.map((s: any) => s.startTime).sort();
    expect(await times('')).toEqual(['08:00']);
    expect(await times('?status=archived')).toEqual(['16:00']);
    expect(await times('?status=all')).toEqual(['08:00', '16:00']);

    expect(
      (await admin.patch(`/shifts/${night._id}/restore`)).body.isArchived,
    ).toBe(false);
    expect(
      (await admin.put(`/shifts/${night._id}`).send({ endTime: '23:30' })).body
        .endTime,
    ).toBe('23:30');
    expect((await admin.get(`/shifts/${night._id}`)).body.endTime).toBe(
      '23:30',
    );
  });

  it('requires a start and an end time', async () => {
    const { admin } = await setup();
    expect(
      (await admin.post('/shifts').send({ startTime: '08:00' })).body.message,
    ).toEqual(['End time is required']);
  });

  it('answers 404 when archiving, restoring or deleting a shift that does not exist', async () => {
    const { admin } = await setup();
    for (const send of [
      () => admin.patch(`/shifts/${unknownId()}/archive`),
      () => admin.patch(`/shifts/${unknownId()}/restore`),
      () => admin.delete(`/shifts/${unknownId()}`),
    ]) {
      const res = await send();
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Shift not found');
    }
  });

  it('deletes a shift nobody is planned on', async () => {
    const { company, admin } = await setup();
    const shift = await seed.shift(company.id);
    expect((await admin.delete(`/shifts/${shift._id}`)).status).toBe(200);
    expect((await admin.get('/shifts?status=all')).body).toEqual([]);
  });

  // BUG-204: a shift still used in the planning is deleted at once (no 409, ?force ignored)
  it(
    'asks before deleting a shift that is still in the planning, then deletes with force',
    async () => {
      const { company, admin } = await setup();
      const shift = await seed.shift(company.id);
      const emp = await seed.employee(company.id);
      await seed.planning(company.id, {
        empId: String(emp._id),
        shiftId: String(shift._id),
        planDate: '2026-10-20',
      });

      const ask = await admin.delete(`/shifts/${shift._id}`);
      expect(ask.status).toBe(409);
      expect(ask.body.usageCount).toBe(1);
      expect((await admin.get('/shifts?status=all')).body).toHaveLength(1);

      expect(
        (await admin.delete(`/shifts/${shift._id}?force=true`)).status,
      ).toBe(200);
    },
  );

  it("keeps each company's shifts apart", async () => {
    const { admin } = await setup();
    const theirs = await seed.shift((await seed.company()).id);
    expect((await admin.get('/shifts?status=all')).body).toEqual([]);
    expect((await admin.delete(`/shifts/${theirs._id}`)).status).toBe(404);
  });
});

describe('tasks', () => {
  it('creates, lists by number, updates and deletes', async () => {
    const { admin } = await setup();
    await admin.post('/tasks').send({ taskId: 2, taskName: 'Kitchen' });
    const cashier = (
      await admin.post('/tasks').send({ taskId: 1, taskName: 'Cashier' })
    ).body;
    expect(
      (await admin.get('/tasks')).body.map((x: any) => x.taskName),
    ).toEqual(['Cashier', 'Kitchen']);
    expect(
      (await admin.put(`/tasks/${cashier._id}`).send({ taskName: 'Till' })).body
        .taskName,
    ).toBe('Till');
    expect((await admin.get(`/tasks/${cashier._id}`)).body.taskName).toBe(
      'Till',
    );
    expect((await admin.delete(`/tasks/${cashier._id}`)).body.taskName).toBe(
      'Till',
    );
    expect((await admin.get('/tasks')).body).toHaveLength(1);
  });

  it('refuses a task number already used in the company', async () => {
    const { company, admin } = await setup();
    await seed.task(company.id, { taskId: 5 });
    await seed.task((await seed.company()).id, { taskId: 6 });
    const dup = await admin
      .post('/tasks')
      .send({ taskId: 5, taskName: 'Again' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('The task number "5" is already used');
    expect(
      (await admin.post('/tasks').send({ taskId: 6, taskName: 'Fine' })).status,
    ).toBe(201);
  });

  it('requires a number and a name', async () => {
    const { admin } = await setup();
    expect((await admin.post('/tasks').send({})).body.message.sort()).toEqual([
      'Task name is required',
      'Task number is required',
    ]);
  });
});
