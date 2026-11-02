import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { FEATURES } from '../src/companies/company.schema';

// Companies: the super admin creates and manages them, a company admin edits
// their own name and settings, and the sign-in page reads public branding.

let t: TestApp;
let seed: ReturnType<typeof seeder>;
let sa: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
  sa = await loginAs(t, await seed.user('superadmin', null));
});
afterAll(() => t.close());

let n = 0;
const admin = (over: object = {}) => ({
  email: `boss${++n}@company.dz`,
  name: 'Boss',
  password: 'Good-pass-42',
  ...over,
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('POST /companies', () => {
  it('creates a company with all features, default settings and its first admin', async () => {
    const res = await sa
      .post('/companies')
      .send({ name: 'Café Été', admin: admin() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Café Été',
      slug: 'cafe-ete',
      active: true,
      features: [...FEATURES],
      settings: {
        language: 'en',
        currency: 'DA',
        utcOffset: '+01:00',
        hoursPerDay: 8,
        workingDaysPerMonth: 26,
        weeklyAdvanceRatio: 0.5,
      },
    });
    const boss = await t
      .model('User')
      .findOne({ companyId: res.body._id })
      .lean<any>();
    expect(boss).toMatchObject({ role: 'admin', name: 'Boss' });
  });

  it("doesn't create a company when its admin can't be created", async () => {
    const before = await t.model('Company').countDocuments();
    const weak = await sa
      .post('/companies')
      .send({ name: 'No Admin', admin: admin({ password: 'weak' }) });
    expect(weak.status).toBe(400);
    const taken = await seed.user('manager', (await seed.company()).id);
    const dup = await sa
      .post('/companies')
      .send({ name: 'Dup Admin', admin: admin({ email: taken.email }) });
    expect(dup.status).toBe(409);
    expect(await t.model('Company').countDocuments()).toBe(before + 1); // only the seeded one
  });

  it('requires a name', async () => {
    const res = await sa
      .post('/companies')
      .send({ name: '  ', admin: admin() });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Company name is required');
  });

  // BUG-103: a second company whose name gives the same sign-in link name can't be created
  it('creates a second company with the same name', async () => {
    expect(
      (await sa.post('/companies').send({ name: 'Pizza Roma', admin: admin() }))
        .status,
    ).toBe(201);
    const second = await sa
      .post('/companies')
      .send({ name: 'Pizza  Roma!', admin: admin() });
    expect(second.status).toBe(201);
    expect(second.body.slug).not.toBe('pizza-roma');
  });

  it('can be given its own sign-in link name', async () => {
    const res = await sa
      .post('/companies')
      .send({ name: 'Pizza Oran', slug: 'oran-1', admin: admin() });
    expect(res.body.slug).toBe('oran-1');
  });
});

describe('GET /companies', () => {
  it('lists every company, finds one, and lists the features', async () => {
    const c = await seed.company({ name: 'AAA First' });
    const list = await sa.get('/companies');
    expect(list.body.map((x: any) => x.name)).toContain('AAA First');
    expect((await sa.get(`/companies/${c.id}`)).body.name).toBe('AAA First');
    expect((await sa.get(`/companies/${unknownId()}`)).status).toBe(404);
    expect((await sa.get('/companies/nope')).status).toBe(404);
    expect((await sa.get('/companies/features')).body).toEqual([...FEATURES]);
  });
});

describe('PATCH /companies/:id', () => {
  const patch = async (body: object) => {
    const c = await seed.company();
    return sa.patch(`/companies/${c.id}`).send(body);
  };

  it('switches features, and the change applies at once', async () => {
    const c = await seed.company();
    const user = await loginAs(t, await seed.user('admin', c.id));
    expect((await user.get('/shifts')).status).toBe(200);
    const res = await sa
      .patch(`/companies/${c.id}`)
      .send({ features: ['clockin', 'clockin'] });
    expect(res.body.features).toEqual(['clockin']);
    expect((await user.get('/shifts')).status).toBe(403);
  });

  it('refuses an empty name and keeps the old one', async () => {
    const c = await seed.company({ name: 'Pizza' });
    const res = await sa.patch(`/companies/${c.id}`).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Company name is required');
    expect((await sa.get(`/companies/${c.id}`)).body.name).toBe('Pizza');
  });

  it('refuses unknown features', async () => {
    expect((await patch({ features: ['payroll'] })).status).toBe(400);
    expect((await patch({ features: 'planning' })).status).toBe(400);
  });

  it('keeps the settings it was not sent', async () => {
    const res = await patch({ settings: { currency: 'EUR' } });
    expect(res.body.settings).toMatchObject({
      currency: 'EUR',
      utcOffset: '+01:00',
      hoursPerDay: 8,
    });
  });

  it.each([
    [{ currency: '' }, 'Currency must be 1 to 8 characters'],
    [{ currency: 'TOOLONGCUR' }, 'Currency must be 1 to 8 characters'],
    [{ utcOffset: '+1' }, 'UTC offset must look like +01:00'],
    [{ utcOffset: '+24:00' }, 'UTC offset must look like +01:00'],
    [{ language: 'de' }, 'Language must be en, fr or ar'],
    [{ hoursPerDay: 0 }, 'Hours per day must be between 0 and 24'],
    [{ hoursPerDay: 25 }, 'Hours per day must be between 0 and 24'],
    [
      { workingDaysPerMonth: 'x' },
      'Working days per month must be between 0 and 31',
    ],
    [
      { weeklyAdvanceRatio: 1.5 },
      'Weekly advance ratio must be between 0 and 1',
    ],
  ])('refuses settings %j', async (settings, message) => {
    const res = await patch({ settings });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  // BUG-104: a weekly advance share of 0% is refused, although the message says 0 is allowed
  it('accepts a weekly advance share of 0 (no weekly advances)', async () => {
    const res = await patch({ settings: { weeklyAdvanceRatio: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.weeklyAdvanceRatio).toBe(0);
  });

  it('sets branding, and checks the logo and colour', async () => {
    const ok = await patch({
      branding: {
        logo: PNG,
        color: '#1E40AF',
        title: ' Welcome ',
        subtitle: '',
      },
    });
    expect(ok.body.branding).toEqual({
      logo: PNG,
      color: '#1E40AF',
      title: 'Welcome',
    });
    expect(
      (await patch({ branding: { logo: 'https://evil.example/x.png' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await patch({
          branding: { logo: `data:image/png;base64,${'A'.repeat(400_001)}` },
        })
      ).status,
    ).toBe(400);
    expect((await patch({ branding: { color: 'red' } })).body.message).toBe(
      'Colour must look like #1E40AF',
    );
    expect(
      (await patch({ branding: { title: 'x'.repeat(81) } })).body.message,
    ).toBe('Title must be at most 80 characters');
  });

  it('sets the clocking machines, each serial once and in one company only', async () => {
    const c = await seed.company();
    const res = await sa
      .patch(`/companies/${c.id}`)
      .send({ devices: [{ serial: ' SN1 ', name: 'Door' }, { serial: '' }] });
    expect(res.body.devices).toEqual([{ serial: 'SN1', name: 'Door' }]);
    expect(
      (
        await sa
          .patch(`/companies/${c.id}`)
          .send({ devices: [{ serial: 'A' }, { serial: 'A' }] })
      ).status,
    ).toBe(400);
    expect(
      (await sa.patch(`/companies/${c.id}`).send({ devices: 'SN1' })).status,
    ).toBe(400);
    const taken = await patch({ devices: [{ serial: 'SN1' }] });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toMatch(/already used by another company/);
  });

  it('refuses a sign-in link name with other characters, or one already used', async () => {
    expect((await patch({ slug: 'Not OK!' })).status).toBe(400);
    expect((await patch({ slug: 'taken-name' })).status).toBe(200);
    expect((await patch({ slug: 'taken-name' })).status).toBe(409);
  });

  it('answers 404 for an unknown company', async () => {
    expect(
      (await sa.patch(`/companies/${unknownId()}`).send({ name: 'x' })).status,
    ).toBe(404);
  });
});

describe('/company (a company admin)', () => {
  it('shows the company to its admin and managers', async () => {
    const c = await seed.company({ name: 'Mine' });
    const manager = await loginAs(t, await seed.user('manager', c.id));
    const res = await manager.get('/company');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: c.id, name: 'Mine' });
  });

  it('lets the admin change only the name and settings', async () => {
    const c = await seed.company({ name: 'Mine', features: ['planning'] });
    const boss = await loginAs(t, await seed.user('admin', c.id));
    const res = await boss.patch('/company').send({
      name: 'Mine Renamed',
      settings: { currency: 'EUR' },
      features: [...FEATURES],
      active: false,
      devices: [{ serial: 'SNEAKY' }],
      slug: 'hijack',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Mine Renamed',
      features: ['planning'],
      active: true,
    });
    expect(res.body.settings.currency).toBe('EUR');
    const stored = await t.model('Company').findById(c.id).lean<any>();
    expect(stored.devices).toEqual([]);
    expect(stored.slug).not.toBe('hijack');
  });
});

describe('GET /branding/:slug', () => {
  it('shows a company its logo and texts before sign-in, and nothing else', async () => {
    await seed.company({
      name: 'Brand Co',
      slug: 'brand-co',
      settings: { currency: 'EUR' } as any,
      devices: [{ serial: 'S1' }],
    });
    const res = await api(t.app).get('/branding/BRAND-CO');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Brand Co',
      slug: 'brand-co',
      branding: {},
    });
  });

  it('hides suspended and unknown companies', async () => {
    await seed.company({ slug: 'closed-co', active: false });
    expect((await api(t.app).get('/branding/closed-co')).status).toBe(404);
    expect((await api(t.app).get('/branding/nobody')).status).toBe(404);
  });
});
