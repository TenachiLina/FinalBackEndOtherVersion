import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, PASSWORD, seeder } from './helpers/seed';

// A user's own profile: PATCH /auth/me changes their name and photo. The
// email, role and company stay with the admin.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

const PHOTO = `data:image/png;base64,${'A'.repeat(400)}`;

async function setup(
  role: 'admin' | 'manager' | 'employee' | 'staff' = 'manager',
) {
  const company = await seed.company();
  const account = await seed.user(role, company.id, { name: 'Mia Manager' });
  const client = await loginAs(t, account);
  return { company, account, client };
}

describe('PATCH /auth/me', () => {
  it('changes the name and the photo, and /auth/me shows them', async () => {
    const { client, account } = await setup();
    const res = await client
      .patch('/auth/me')
      .send({ name: '  Mia Benali ', photo: PHOTO });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: account.id,
      email: account.email,
      name: 'Mia Benali',
      role: 'manager',
      photo: PHOTO,
    });
    const me = await client.get('/auth/me');
    expect(me.body.user).toMatchObject({ name: 'Mia Benali', photo: PHOTO });
  });

  it('gives the photo at sign-in, and null without one', async () => {
    const { client, account } = await setup();
    expect((await client.get('/auth/me')).body.user.photo).toBeNull();
    await client.patch('/auth/me').send({ photo: PHOTO });
    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(login.body.user.photo).toBe(PHOTO);
  });

  it('changes only what is sent', async () => {
    const { client } = await setup();
    await client.patch('/auth/me').send({ photo: PHOTO });
    const res = await client.patch('/auth/me').send({ name: 'Mia B' });
    expect(res.body.user).toMatchObject({ name: 'Mia B', photo: PHOTO });
    const same = await client.patch('/auth/me').send({});
    expect(same.status).toBe(200);
    expect(same.body.user).toMatchObject({ name: 'Mia B', photo: PHOTO });
  });

  it.each(['', null])('removes the photo with %p', async (photo) => {
    const { client } = await setup();
    await client.patch('/auth/me').send({ photo: PHOTO });
    const res = await client.patch('/auth/me').send({ photo });
    expect(res.body.user.photo).toBeNull();
    expect((await client.get('/auth/me')).body.user.photo).toBeNull();
  });

  it('never changes the email, the role or the company', async () => {
    const { client, account, company } = await setup();
    const other = await seed.company();
    const res = await client.patch('/auth/me').send({
      name: 'Mia',
      email: 'boss@test.dz',
      role: 'admin',
      companyId: other.id,
      active: false,
    });
    expect(res.status).toBe(200);
    const me = await client.get('/auth/me');
    expect(me.body.user).toMatchObject({
      email: account.email,
      role: 'manager',
      companyId: company.id,
      name: 'Mia',
    });
    expect(me.body.company.id).toBe(company.id);
  });

  it.each([
    [{ name: '' }, 'Name is required'],
    [{ name: '   ' }, 'Name is required'],
    [{ name: 42 }, 'Name is required'],
    [{ name: 'n'.repeat(81) }, 'Name must be at most 80 characters'],
    [
      { photo: 'https://example.com/me.png' },
      'The photo must be a PNG, JPEG or WebP image of at most 200 KB',
    ],
    [
      { photo: 'data:image/svg+xml;base64,AAAA' },
      'The photo must be a PNG, JPEG or WebP image of at most 200 KB',
    ],
    [
      { photo: 'data:text/html;base64,AAAA' },
      'The photo must be a PNG, JPEG or WebP image of at most 200 KB',
    ],
    [
      { photo: 42 },
      'The photo must be a PNG, JPEG or WebP image of at most 200 KB',
    ],
    [
      { photo: `data:image/png;base64,${'A'.repeat(280_000)}` },
      'The photo must be a PNG, JPEG or WebP image of at most 200 KB',
    ],
  ])('refuses %j', async (body, message) => {
    const { client } = await setup();
    const res = await client.patch('/auth/me').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect((await client.get('/auth/me')).body.user).toMatchObject({
      name: 'Mia Manager',
      photo: null,
    });
  });

  it('needs a login', async () => {
    const res = await api(t.app).patch('/auth/me').send({ name: 'Nobody' });
    expect(res.status).toBe(401);
  });

  it("changes one's own account only", async () => {
    const a = await setup();
    const b = await setup();
    await a.client.patch('/auth/me').send({ name: 'Changed' });
    expect((await b.client.get('/auth/me')).body.user.name).toBe('Mia Manager');
  });

  it.each(['admin', 'employee', 'staff'] as const)(
    'works for a %s account',
    async (role) => {
      const { client } = await setup(role);
      const res = await client.patch('/auth/me').send({ name: 'New Name' });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ name: 'New Name', role });
    },
  );

  it('works for a super admin without a company', async () => {
    const root = await loginAs(t, await seed.user('superadmin', null));
    const res = await root
      .patch('/auth/me')
      .send({ name: 'Root', photo: PHOTO });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: 'Root',
      companyId: null,
      photo: PHOTO,
    });
  });

  it('is written to the activity log, without the picture itself', async () => {
    const { client, company } = await setup();
    await client.patch('/auth/me').send({ name: 'Mia B', photo: PHOTO });
    const read = () =>
      t
        .model('AuditLog')
        .find({ companyId: company._id, action: 'auth.updateProfile' })
        .lean();
    let logs = await read();
    for (let i = 0; i < 50 && logs.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 100));
      logs = await read();
    }
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]).length).toBeLessThan(3000);
  });
});
