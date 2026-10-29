import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, PASSWORD, seeder, unknownId } from './helpers/seed';

// Company users: an admin creates, changes, resets and deletes the accounts
// of their own company, and never ends up locking the company out.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

/** A company with one admin, signed in. */
async function setup() {
  const company = await seed.company();
  const adminUser = await seed.user('admin', company.id);
  const admin = await loginAs(t, adminUser);
  return { company, adminUser, admin };
}

const newUser = (over: object = {}) => ({
  email: `new${Math.random().toString(36).slice(2, 8)}@test.dz`,
  name: 'New Person',
  password: 'Good-pass-42',
  ...over,
});

describe('GET /users', () => {
  it("lists only this company's users, without password data", async () => {
    const { company, admin } = await setup();
    await seed.user('manager', company.id, { name: 'Mia' });
    await seed.user('manager', (await seed.company()).id, {
      name: 'Elsewhere',
    });

    const res = await admin.get('/users');
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.name).sort()).toEqual(
      ['Mia', expect.stringMatching(/^admin/)].sort(),
    );
    for (const u of res.body) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('failedLoginAttempts');
    }
  });
});

describe('POST /users', () => {
  it('creates a manager by default, who can then sign in', async () => {
    const { company, admin } = await setup();
    const body = newUser();
    const res = await admin.post('/users').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: body.email,
      name: 'New Person',
      role: 'manager',
      companyId: company.id,
      active: true,
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(
      (
        await api(t.app)
          .post('/auth/login')
          .send({ email: body.email, password: body.password })
      ).status,
    ).toBe(200);
  });

  it('creates admins and kiosk accounts, never a super admin', async () => {
    const { admin } = await setup();
    expect(
      (await admin.post('/users').send(newUser({ role: 'admin' }))).body.role,
    ).toBe('admin');
    expect(
      (await admin.post('/users').send(newUser({ role: 'employee' }))).body
        .role,
    ).toBe('employee');
    const res = await admin
      .post('/users')
      .send(newUser({ role: 'superadmin' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Role must be one of: admin, manager, employee',
    );
  });

  it.each([
    [{ email: 'not-an-email' }, 'A valid email is required'],
    [{ email: undefined }, 'A valid email is required'],
    [{ name: '   ' }, 'Name is required'],
    [{ password: 'short1' }, 'Password must be at least 8 characters'],
    [
      { password: 'onlyletters' },
      'Password must contain at least one letter and one number',
    ],
    [
      { password: 'Password123' },
      'This password is too easy to guess. Choose another one.',
    ],
    [
      { email: 'karima@test.dz', password: 'karima-2026x' },
      'This password is too easy to guess. Choose another one.',
    ],
    [
      { password: `A1${'é'.repeat(40)}` },
      'Password is too long (72 characters max)',
    ],
  ])('refuses %j', async (over, message) => {
    const { admin } = await setup();
    const res = await admin.post('/users').send(newUser(over));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it('refuses an email already used, in any company', async () => {
    const { admin } = await setup();
    const elsewhere = await seed.user('manager', (await seed.company()).id);
    const res = await admin
      .post('/users')
      .send(newUser({ email: elsewhere.email.toUpperCase() }));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A user with this email already exists');
  });

  describe('linking a manager to an employee', () => {
    it("links to one of this company's employees, once", async () => {
      const { company, admin } = await setup();
      const emp = await seed.employee(company.id);
      const first = await admin
        .post('/users')
        .send(newUser({ employeeId: String(emp._id) }));
      expect(first.body.employeeId).toBe(String(emp._id));
      const second = await admin
        .post('/users')
        .send(newUser({ employeeId: String(emp._id) }));
      expect(second.status).toBe(409);
      expect(second.body.message).toBe(
        'This employee is already linked to another user',
      );
    });

    it("refuses another company's employee, or one that doesn't exist", async () => {
      const { admin } = await setup();
      const theirs = await seed.employee((await seed.company()).id);
      for (const employeeId of [String(theirs._id), unknownId(), 'nope']) {
        const res = await admin.post('/users').send(newUser({ employeeId }));
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Employee not found');
      }
    });

    it('links only managers', async () => {
      const { company, admin } = await setup();
      const emp = await seed.employee(company.id);
      const res = await admin
        .post('/users')
        .send(newUser({ role: 'admin', employeeId: String(emp._id) }));
      expect(res.body.employeeId).toBeNull();
    });
  });
});

describe('PATCH /users/:id', () => {
  it('renames, changes the role and disables', async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    const res = await admin
      .patch(`/users/${mia.id}`)
      .send({ name: ' Mia B ', role: 'admin', active: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Mia B',
      role: 'admin',
      active: false,
    });
  });

  it('signs a disabled user out everywhere at once', async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    const session = await loginAs(t, mia);
    await admin.patch(`/users/${mia.id}`).send({ active: false });
    expect((await session.get('/auth/me')).status).toBe(401);
    const stored = await t
      .model('LoginSession')
      .findOne({ userId: mia.id })
      .lean<any>();
    expect(stored.revokedReason).toBe('account_disabled');
  });

  it('keeps sessions when only the name changes', async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    const session = await loginAs(t, mia);
    await admin.patch(`/users/${mia.id}`).send({ name: 'Mia' });
    expect((await session.get('/auth/me')).status).toBe(200);
  });

  it("won't let an admin remove their own admin access", async () => {
    const { company, adminUser, admin } = await setup();
    await seed.user('admin', company.id);
    for (const body of [{ role: 'manager' }, { active: false }]) {
      const res = await admin.patch(`/users/${adminUser.id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('You cannot remove your own admin access');
    }
  });

  it('always keeps one active admin', async () => {
    const { company, adminUser } = await setup();
    const sa = await loginAs(t, await seed.user('superadmin', null), {
      companyId: company.id,
    });
    const res = await sa
      .patch(`/users/${adminUser.id}`)
      .send({ role: 'manager' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'The company must keep at least one active admin',
    );
  });

  // BUG-102: two admins demoting each other at the same moment leave the company with no admin
  it.failing(
    'keeps one active admin when two admins demote each other at once',
    async () => {
      const { company, adminUser, admin } = await setup();
      const otherUser = await seed.user('admin', company.id);
      const other = await loginAs(t, otherUser);
      await Promise.all([
        admin.patch(`/users/${otherUser.id}`).send({ role: 'manager' }),
        other.patch(`/users/${adminUser.id}`).send({ role: 'manager' }),
      ]);
      const admins = await t
        .model('User')
        .countDocuments({ companyId: company.id, role: 'admin', active: true });
      expect(admins).toBeGreaterThanOrEqual(1);
    },
  );

  it("can't touch another company's user", async () => {
    const { admin } = await setup();
    const theirs = await seed.user('manager', (await seed.company()).id);
    expect(
      (await admin.patch(`/users/${theirs.id}`).send({ name: 'x' })).status,
    ).toBe(404);
    expect((await admin.patch('/users/nope').send({ name: 'x' })).status).toBe(
      404,
    );
  });

  it('refuses an empty name or a bad role', async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    expect(
      (await admin.patch(`/users/${mia.id}`).send({ name: ' ' })).body.message,
    ).toBe('Name is required');
    expect(
      (await admin.patch(`/users/${mia.id}`).send({ role: 'superadmin' }))
        .status,
    ).toBe(400);
  });
});

describe('POST /users/:id/password', () => {
  it('sets a new password, unlocks the account and signs the user out', async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    const session = await loginAs(t, mia);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        api(t.app)
          .post('/auth/login')
          .send({ email: mia.email, password: 'Wrong-pass-1' }),
      ),
    );

    const res = await admin
      .post(`/users/${mia.id}/password`)
      .send({ password: 'Reset-pass-2026' });
    expect(res.status).toBe(204);
    expect((await session.get('/auth/me')).status).toBe(401);
    expect(
      (
        await api(t.app)
          .post('/auth/login')
          .send({ email: mia.email, password: PASSWORD })
      ).status,
    ).toBe(401);
    expect(
      (
        await api(t.app)
          .post('/auth/login')
          .send({ email: mia.email, password: 'Reset-pass-2026' })
      ).status,
    ).toBe(200);
  });

  it("refuses a weak password and another company's user", async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    expect(
      (await admin.post(`/users/${mia.id}/password`).send({ password: 'weak' }))
        .status,
    ).toBe(400);
    const theirs = await seed.user('manager', (await seed.company()).id);
    expect(
      (
        await admin
          .post(`/users/${theirs.id}/password`)
          .send({ password: 'Reset-pass-2026' })
      ).status,
    ).toBe(404);
  });
});

describe('DELETE /users/:id', () => {
  it('deletes the account and signs it out', async () => {
    const { company, admin } = await setup();
    const mia = await seed.user('manager', company.id);
    const session = await loginAs(t, mia);
    expect((await admin.delete(`/users/${mia.id}`)).status).toBe(204);
    expect(await t.model('User').exists({ _id: mia.id })).toBeNull();
    expect((await session.get('/auth/me')).status).toBe(401);
  });

  it('refuses to delete yourself, or the last admin', async () => {
    const { company, adminUser, admin } = await setup();
    const self = await admin.delete(`/users/${adminUser.id}`);
    expect(self.body.message).toBe('You cannot delete your own account');
    const sa = await loginAs(t, await seed.user('superadmin', null), {
      companyId: company.id,
    });
    const last = await sa.delete(`/users/${adminUser.id}`);
    expect(last.status).toBe(400);
    expect(last.body.message).toBe(
      'The company must keep at least one active admin',
    );
  });

  it("can't delete another company's user", async () => {
    const { admin } = await setup();
    const theirs = await seed.user('manager', (await seed.company()).id);
    expect((await admin.delete(`/users/${theirs.id}`)).status).toBe(404);
    expect(await t.model('User').exists({ _id: theirs.id })).not.toBeNull();
  });
});
