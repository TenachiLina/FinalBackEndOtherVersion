import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder } from './helpers/seed';

// Smoke test for the shared helpers: the app boots on its own database,
// requests go through the real middleware, and data stays in its company.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());

describe('the app', () => {
  it('answers an unknown route with a JSON 404', async () => {
    const res = await api(t.app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404 });
  });

  it('redirects a plain-HTTP read to HTTPS', async () => {
    const res = await api(t.app)
      .get('/employees')
      .set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(308);
    expect(res.headers.location).toMatch(/^https:\/\//);
  });

  it('refuses a route without a login', async () => {
    const res = await api(t.app).get('/employees');
    expect(res.status).toBe(401);
  });

  it("shows a signed-in admin only their own company's employees", async () => {
    const pizza = await seed.company({ name: 'Pizza' });
    const burger = await seed.company({ name: 'Burger' });
    await seed.employee(pizza.id, { firstName: 'Ali' });
    await seed.employee(burger.id, { firstName: 'Sam' });
    const admin = await loginAs(t, await seed.user('admin', pizza.id));

    const res = await admin.get('/employees');

    expect(res.status).toBe(200);
    expect(res.body.map((e: { firstName: string }) => e.firstName)).toEqual([
      'Ali',
    ]);
  });
});
