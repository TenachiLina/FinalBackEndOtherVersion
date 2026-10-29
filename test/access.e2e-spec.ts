import { api, createTestApp, type TestApp } from './helpers/app';
import {
  allRoutes,
  registeredControllers,
  type RouteInfo,
} from './helpers/routes';
import { loginAs, seeder, unknownId } from './helpers/seed';
import { FEATURES } from '../src/companies/company.schema';

// Every route of the API against every kind of caller. The rules come from
// the routes' own decorators; these tests check that the server enforces them,
// and that the sensitive ones are what the business expects.

let t: TestApp;
// Read when the file loads: it.each needs the list before the app starts
const routes: RouteInfo[] = allRoutes(registeredControllers());
type Client = Awaited<ReturnType<typeof loginAs>>;
let as: Record<
  'admin' | 'manager' | 'kiosk' | 'superadmin' | 'noFeatures',
  Client
>;
let superInCompany: Client;

beforeAll(async () => {
  t = await createTestApp();
  const seed = seeder(t);
  const company = await seed.company();
  const bare = await seed.company({ features: [] });
  as = {
    admin: await loginAs(t, await seed.user('admin', company.id)),
    manager: await loginAs(t, await seed.user('manager', company.id)),
    kiosk: await loginAs(t, await seed.user('employee', company.id)),
    superadmin: await loginAs(t, await seed.user('superadmin', null)),
    noFeatures: await loginAs(t, await seed.user('admin', bare.id)),
  };
  superInCompany = await loginAs(t, await seed.user('superadmin', null), {
    companyId: company.id,
  });
}, 60_000);
afterAll(() => t.close());

/** The route's URL with every parameter filled in with something harmless. */
const urlOf = (r: RouteInfo) =>
  r.path
    .replace(':date', '2026-10-20')
    .replace(':slug', 'no-such-company')
    .replace(/:[a-zA-Z]+/g, unknownId());

const call = (client: Pick<Client, 'get' | 'post'>, r: RouteInfo) =>
  (client as any)[r.method.toLowerCase()](urlOf(r)).send({});

const privateRoutes = () => routes.filter((r) => !r.isPublic);
const each = (filter: (r: RouteInfo) => boolean) =>
  privateRoutes()
    .filter(filter)
    .map((r) => [r.key, r] as const);

it('finds every route', () => {
  expect(routes.length).toBeGreaterThanOrEqual(84);
});

describe('without a login', () => {
  it.each(each(() => true))('%s → 401', async (_key, r) => {
    expect((await call(api(t.app), r)).status).toBe(401);
  });
});

describe('a kiosk account', () => {
  it.each(each((r) => !r.kiosk))('%s → 403', async (_key, r) => {
    const res = await call(as.kiosk, r);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'This account can only clock employees in and out',
    );
  });
});

describe('a manager', () => {
  it.each(each((r) => r.roles.length > 0 && !r.roles.includes('manager')))(
    '%s → 403',
    async (_key, r) => {
      expect((await call(as.manager, r)).status).toBe(403);
    },
  );
});

describe('a company admin', () => {
  it.each(each((r) => r.roles.length > 0 && !r.roles.includes('admin')))(
    '%s → 403',
    async (_key, r) => {
      expect((await call(as.admin, r)).status).toBe(403);
    },
  );
});

describe('a company without the feature', () => {
  it.each(each((r) => !!r.feature))('%s → 403', async (_key, r) => {
    const res = await call(as.noFeatures, r);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      `The "${r.feature}" feature is not enabled for this company`,
    );
  });
});

describe('a super admin who has not picked a company', () => {
  it.each(each((r) => !r.noCompany))('%s → 403', async (_key, r) => {
    const res = await call(as.superadmin, r);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Choose a company first');
  });
});

// Allowed callers get past the checks, and the route copes with an empty
// body and ids that match nothing: a 4xx at worst, never a crash.
// (/auth routes are left out: logout would end the session used here.)
describe('an allowed caller with an empty request', () => {
  // Known crashes, each with its own failing test below
  const CRASHES = ['POST /planning/copy-month'];
  const allowed = (r: RouteInfo) =>
    !r.path.startsWith('/auth/') && !CRASHES.includes(r.key);

  it.each(
    each(
      (r) => allowed(r) && (r.roles.length === 0 || r.roles.includes('admin')),
    ),
  )('%s as admin', async (_key, r) => {
    const res = await call(as.admin, r);
    expect([401, 403]).not.toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });

  // BUG-301: copying a month without the months crashes (500) instead of a 400
  it.failing('POST /planning/copy-month as admin', async () => {
    const res = await as.admin.post('/planning/copy-month').send({});
    expect(res.status).toBe(400);
  });

  it.each(each((r) => allowed(r) && r.roles.includes('superadmin')))(
    '%s as super admin',
    async (_key, r) => {
      const res = await call(r.noCompany ? as.superadmin : superInCompany, r);
      expect([401, 403]).not.toContain(res.status);
      expect(res.status).toBeLessThan(500);
    },
  );
});

describe('the rules for sensitive routes', () => {
  const rule = (key: string) => {
    const r = routes.find((x) => x.key === key);
    if (!r) throw new Error(`no route ${key}`);
    return {
      roles: [...r.roles].sort(),
      feature: r.feature,
      kiosk: r.kiosk,
      isPublic: r.isPublic,
    };
  };

  it('only the super admin manages companies, login sessions and the error log', () => {
    for (const key of [
      'GET /companies',
      'POST /companies',
      'PATCH /companies/:id',
      'GET /login-sessions',
      'DELETE /login-sessions/:id',
      'GET /error-logs',
    ]) {
      expect(rule(key).roles).toEqual(['superadmin']);
    }
  });

  it('only admins manage users and company settings', () => {
    for (const key of [
      'GET /users',
      'POST /users',
      'PATCH /users/:id',
      'POST /users/:id/password',
      'DELETE /users/:id',
      'PATCH /company',
    ]) {
      expect(rule(key).roles).toEqual(['admin']);
    }
  });

  it('money routes are for admins and managers, behind their feature', () => {
    expect(rule('POST /advances')).toMatchObject({
      roles: ['admin', 'manager'],
      feature: 'advances',
    });
    expect(rule('POST /bonuses')).toMatchObject({
      roles: ['admin', 'manager'],
      feature: 'bonuses',
    });
    expect(rule('GET /worktime/report')).toMatchObject({
      roles: ['admin', 'manager'],
      feature: 'reporting',
    });
  });

  it('a kiosk account reaches only its own account and the clock', () => {
    const kioskRoutes = routes
      .filter((r) => r.kiosk && !r.isPublic)
      .map((r) => r.key);
    expect(kioskRoutes.filter((k) => !k.includes('/auth/'))).toEqual([
      'GET /kiosk/employees',
      'POST /error-logs/client',
      'POST /kiosk/clock',
    ]);
  });

  it('only sign-in, branding and the clocking machine are public', () => {
    expect(routes.filter((r) => r.isPublic).map((r) => r.key)).toEqual([
      'GET /branding/:slug',
      'GET /iclock/cdata/cdata.aspx',
      'GET /iclock/getrequest/getrequest.aspx',
      'GET /iclock/ping/ping.aspx',
      'POST /auth/login',
      'POST /auth/refresh',
      'POST /iclock/cdata/cdata.aspx',
    ]);
  });

  it('every feature guards at least one route', () => {
    const used = new Set(routes.map((r) => r.feature).filter(Boolean));
    expect(FEATURES.filter((f) => !used.has(f))).toEqual(['faceRecognition']);
  });
});
