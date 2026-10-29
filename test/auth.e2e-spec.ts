import { api, createTestApp, type TestApp } from './helpers/app';
import { loginAs, PASSWORD, seeder, unknownId } from './helpers/seed';
import { setNow } from './helpers/time';

// Signing in, the current user, sessions and passwords. Token rotation and
// theft detection are in security.e2e-spec.ts.

let t: TestApp;
let seed: ReturnType<typeof seeder>;
let company: Awaited<ReturnType<ReturnType<typeof seeder>['company']>>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
  company = await seed.company({ name: 'Pizza Nexo', slug: 'pizza-nexo' });
});
afterAll(() => t.close());
afterEach(() => jest.useRealTimers());

const login = (email: string, password: unknown = PASSWORD) =>
  api(t.app).post('/auth/login').send({ email, password });

describe('POST /auth/login', () => {
  it('answers tokens, the user and their company', async () => {
    const user = await seed.user('manager', company.id, { name: 'Mia' });
    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.stringMatching(/^[0-9a-f]{24}\./),
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        name: 'Mia',
        role: 'manager',
        companyId: company.id,
      },
      company: expect.objectContaining({
        id: company.id,
        name: 'Pizza Nexo',
        slug: 'pizza-nexo',
        active: true,
        settings: expect.objectContaining({
          currency: 'DA',
          utcOffset: '+01:00',
        }),
      }),
    });
  });

  it('ignores the case and spaces of the email', async () => {
    const user = await seed.user('manager', company.id);
    expect((await login(`  ${user.email.toUpperCase()} `)).status).toBe(200);
  });

  it('gives a super admin no company', async () => {
    const user = await seed.user('superadmin', null);
    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body.company).toBeNull();
    expect(res.body.user.companyId).toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await seed.user('manager', company.id);
    const wrong = await login(user.email, 'Wrong-pass-1');
    const unknown = await login('nobody@test.dz');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe('Invalid email or password');
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it.each([
    [{}],
    [{ email: 'a@b.dz' }],
    [{ email: ['a@b.dz'], password: PASSWORD }],
    [{ email: 'a@b.dz', password: 12345678 }],
  ])('refuses %j', async (body) => {
    const res = await api(t.app).post('/auth/login').send(body);
    expect(res.status).toBe(401);
  });

  it('refuses a disabled account, even with the right password', async () => {
    const user = await seed.user('manager', company.id, { active: false });
    expect((await login(user.email)).status).toBe(401);
  });

  it('refuses users of a suspended company', async () => {
    const closed = await seed.company({ active: false });
    const user = await seed.user('admin', closed.id);
    const res = await login(user.email);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('This company account is suspended');
  });

  it('answers in French when asked', async () => {
    const res = await api(t.app)
      .post('/auth/login')
      .set('Accept-Language', 'fr')
      .send({ email: 'nobody@test.dz', password: 'x' });
    expect(res.body.message).toBe('E-mail ou mot de passe incorrect');
  });

  describe('lockout', () => {
    const fail = (email: string, times: number) =>
      Promise.all(
        Array.from({ length: times }, () => login(email, 'Wrong-pass-1')),
      );

    it('locks an unknown email like a real account, so it reveals nothing', async () => {
      await fail('ghost@test.dz', 5);
      const res = await login('ghost@test.dz');
      expect(res.status).toBe(429);
      expect(res.body.message).toBe(
        'Too many failed attempts. Try again in a few minutes.',
      );
    });

    it('unlocks after 15 minutes', async () => {
      const user = await seed.user('manager', company.id);
      await fail(user.email, 5);
      expect((await login(user.email)).status).toBe(429);
      setNow(Date.now() + 16 * 60_000);
      expect((await login(user.email)).status).toBe(200);
    });

    it('starts counting again after a successful sign-in', async () => {
      const user = await seed.user('manager', company.id);
      await fail(user.email, 4);
      expect((await login(user.email)).status).toBe(200);
      await fail(user.email, 4);
      expect((await login(user.email)).status).toBe(200);
    });
  });
});

describe('GET /auth/me', () => {
  it('answers who is signed in, and their company', async () => {
    const user = await seed.user('admin', company.id);
    const me = await (await loginAs(t, user)).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({
      id: user.id,
      role: 'admin',
      companyId: company.id,
      sessionId: expect.any(String),
    });
    expect(me.body.company).toMatchObject({
      id: company.id,
      name: 'Pizza Nexo',
    });
  });

  it("doesn't let a company user switch company with X-Company-Id", async () => {
    const other = await seed.company();
    const user = await seed.user('admin', company.id);
    const me = await (
      await loginAs(t, user, { companyId: other.id })
    ).get('/auth/me');
    expect(me.body.user.companyId).toBe(company.id);
  });

  it('lets a super admin work inside a company', async () => {
    const sa = await seed.user('superadmin', null);
    const me = await (
      await loginAs(t, sa, { companyId: company.id })
    ).get('/auth/me');
    expect(me.body.user.companyId).toBe(company.id);
    expect(me.body.company.name).toBe('Pizza Nexo');
  });

  it("refuses a super admin's bad or unknown company id", async () => {
    const sa = await seed.user('superadmin', null);
    const bad = await (
      await loginAs(t, sa, { companyId: 'nope' })
    ).get('/auth/me');
    expect(bad.status).toBe(400);
    const unknown = await (
      await loginAs(t, sa, { companyId: unknownId() })
    ).get('/auth/me');
    expect(unknown.status).toBe(403);
    expect(unknown.body.message).toBe('Company not found');
  });

  it('lets a super admin into a suspended company, but not its users', async () => {
    const closed = await seed.company();
    const admin = await loginAs(t, await seed.user('admin', closed.id));
    const sa = await loginAs(t, await seed.user('superadmin', null));
    expect(
      (await sa.patch(`/companies/${closed.id}`).send({ active: false }))
        .status,
    ).toBe(200);

    const blocked = await admin.get('/auth/me');
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('This company account is suspended');

    const inside = await (
      await loginAs(t, await seed.user('superadmin', null), {
        companyId: closed.id,
      })
    ).get('/auth/me');
    expect(inside.status).toBe(200);
  });

  it('signs out a user whose account is disabled, at the next request', async () => {
    const user = await seed.user('manager', company.id);
    const client = await loginAs(t, user);
    await t.model('User').updateOne({ _id: user.id }, { active: false });
    const res = await client.get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      message: 'Account is disabled',
      code: 'SESSION_ENDED',
    });
  });
});

describe('session lifetime', () => {
  it('an access token expires after 15 minutes, and the refresh token gets a new one', async () => {
    const user = await seed.user('manager', company.id);
    const res = await login(user.email);
    setNow(Date.now() + 16 * 60_000);

    const expired = await api(t.app, { token: res.body.accessToken }).get(
      '/auth/me',
    );
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');

    const renewed = await api(t.app)
      .post('/auth/refresh')
      .send({ refreshToken: res.body.refreshToken });
    expect(renewed.status).toBe(200);
    expect(
      (await api(t.app, { token: renewed.body.accessToken }).get('/auth/me'))
        .status,
    ).toBe(200);
  });

  it('ends after 4 hours without any request', async () => {
    const user = await seed.user('manager', company.id);
    const res = await login(user.email);
    setNow(Date.now() + 4 * 3_600_000 + 60_000);
    const renewed = await api(t.app)
      .post('/auth/refresh')
      .send({ refreshToken: res.body.refreshToken });
    expect(renewed.status).toBe(401);
    expect(renewed.body.code).toBe('SESSION_ENDED');
  });

  it('ends 12 hours after sign-in, even when used all along', async () => {
    const user = await seed.user('manager', company.id);
    let tokens = (await login(user.email)).body;
    const start = Date.now();
    for (let h = 3; h <= 12; h += 3) {
      setNow(start + h * 3_600_000 + 60_000);
      const res = await api(t.app)
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });
      if (h < 12) {
        expect(res.status).toBe(200);
        tokens = res.body;
      } else {
        expect(res.status).toBe(401);
      }
    }
  });

  it('a new access token is never valid beyond the end of the session', async () => {
    const user = await seed.user('manager', company.id);
    let tokens = (await login(user.email)).body;
    const signedIn = Date.now();
    // Stay active (refresh every 3 hours) until 5 minutes before the end
    for (const at of [3, 6, 9]
      .map((h) => h * 3_600_000)
      .concat(12 * 3_600_000 - 5 * 60_000)) {
      setNow(signedIn + at);
      const res = await api(t.app)
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });
      expect(res.status).toBe(200);
      tokens = res.body;
    }
    expect(tokens.expiresIn).toBeLessThanOrEqual(5 * 60);
  });
});

describe('POST /auth/refresh', () => {
  it.each([[undefined], ['no-dot'], ['not-an-id.abc'], [`${unknownId()}.abc`]])(
    'refuses %s',
    async (refreshToken) => {
      const res = await api(t.app).post('/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_ENDED');
    },
  );

  it('tells a second tab refreshing at the same moment to reuse the new tokens', async () => {
    const user = await seed.user('manager', company.id);
    const { refreshToken } = (await login(user.email)).body;
    expect(
      (await api(t.app).post('/auth/refresh').send({ refreshToken })).status,
    ).toBe(200);
    const again = await api(t.app).post('/auth/refresh').send({ refreshToken });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('REFRESH_RACE');
  });

  it('keeps the previous access token working for 30 seconds after a refresh', async () => {
    const user = await seed.user('manager', company.id);
    const first = (await login(user.email)).body;
    const start = Date.now();
    await api(t.app)
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(
      (await api(t.app, { token: first.accessToken }).get('/auth/me')).status,
    ).toBe(200);
    setNow(start + 31_000);
    expect(
      (await api(t.app, { token: first.accessToken }).get('/auth/me')).status,
    ).toBe(401);
  });

  it('refuses a disabled account and a suspended company', async () => {
    const closed = await seed.company();
    const admin = await seed.user('admin', closed.id);
    const manager = await seed.user('manager', company.id);
    const a = (await login(admin.email)).body;
    const m = (await login(manager.email)).body;
    await t.model('Company').updateOne({ _id: closed.id }, { active: false });
    await t.model('User').updateOne({ _id: manager.id }, { active: false });

    expect(
      (
        await api(t.app)
          .post('/auth/refresh')
          .send({ refreshToken: a.refreshToken })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(t.app)
          .post('/auth/refresh')
          .send({ refreshToken: m.refreshToken })
      ).status,
    ).toBe(401);
  });
});

describe('your own sessions', () => {
  it('lists your devices, marks this one, and ends another', async () => {
    const user = await seed.user('manager', company.id);
    const phone = await loginAs(t, user);
    const laptop = await loginAs(t, user);

    const list = await laptop.get('/auth/sessions');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: any) => s.current)).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('refreshTokenHash');

    const phoneId = list.body.find((s: any) => !s.current).id;
    expect((await laptop.delete(`/auth/sessions/${phoneId}`)).status).toBe(204);
    expect((await phone.get('/auth/me')).status).toBe(401);
    expect((await laptop.get('/auth/me')).status).toBe(200);
  });

  it("can't end someone else's session", async () => {
    const mine = await loginAs(t, await seed.user('manager', company.id));
    const theirs = await loginAs(t, await seed.user('manager', company.id));
    const theirId = (await theirs.get('/auth/sessions')).body[0].id;
    expect((await mine.delete(`/auth/sessions/${theirId}`)).status).toBe(404);
    expect((await mine.delete('/auth/sessions/not-an-id')).status).toBe(404);
    expect((await theirs.get('/auth/me')).status).toBe(200);
  });

  it('signs out every other device', async () => {
    const user = await seed.user('manager', company.id);
    const others = [await loginAs(t, user), await loginAs(t, user)];
    const me = await loginAs(t, user);
    const res = await me.post('/auth/logout-others');
    expect(res.body).toEqual({ ended: 2 });
    for (const o of others) expect((await o.get('/auth/me')).status).toBe(401);
    expect((await me.get('/auth/me')).status).toBe(200);
  });
});

describe('POST /auth/change-password', () => {
  it('changes it, keeps this device signed in and signs out the others', async () => {
    const user = await seed.user('manager', company.id);
    const other = await loginAs(t, user);
    const me = await loginAs(t, user);
    const res = await me
      .post('/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'Brand-new-pass-7' });
    expect(res.status).toBe(204);
    expect((await me.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, 'Brand-new-pass-7')).status).toBe(200);
  });

  it('answers 400, not 401, to a wrong current password (401 would sign the user out)', async () => {
    const me = await loginAs(t, await seed.user('manager', company.id));
    const res = await me.post('/auth/change-password').send({
      currentPassword: 'Wrong-pass-1',
      newPassword: 'Brand-new-pass-7',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Current password is incorrect');
    expect((await me.post('/auth/change-password').send({})).status).toBe(400);
  });

  it('refuses the same password, or a weak one', async () => {
    const me = await loginAs(t, await seed.user('manager', company.id));
    const same = await me
      .post('/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.body.message).toBe(
      'The new password must be different from the current one',
    );
    const weak = await me
      .post('/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'short1' });
    expect(weak.status).toBe(400);
  });
});

describe('login sessions, for the super admin', () => {
  it('lists active, ended or all sessions, per company and per user, a page at a time', async () => {
    const c = await seed.company();
    const mia = await seed.user('manager', c.id);
    const sam = await seed.user('manager', c.id);
    const miaPhone = await loginAs(t, mia);
    await loginAs(t, mia);
    await loginAs(t, sam);
    await miaPhone.post('/auth/logout');

    const sa = await loginAs(t, await seed.user('superadmin', null), {
      companyId: c.id,
    });
    const list = async (q: string) =>
      (await sa.get(`/login-sessions?${q}`)).body;

    expect((await list('')).total).toBe(2);
    expect((await list('status=ended')).items).toEqual([
      expect.objectContaining({
        userId: mia.id,
        active: false,
        endReason: 'logout',
      }),
    ]);
    expect((await list('status=all')).total).toBe(3);
    expect((await list(`status=all&userId=${mia.id}`)).total).toBe(2);
    expect(await list('status=all&limit=2&page=2')).toMatchObject({
      total: 3,
      page: 2,
      limit: 2,
      items: [expect.anything()],
    });
    expect((await list('limit=999')).limit).toBe(200);
    for (const s of (await list('status=all')).items) {
      expect(s).not.toHaveProperty('refreshTokenHash');
      expect(s.companyId).toBe(c.id);
    }
  });

  it('shows sessions that timed out as ended', async () => {
    const c = await seed.company();
    await loginAs(t, await seed.user('manager', c.id));
    setNow(Date.now() + 5 * 3_600_000);
    const sa = await loginAs(t, await seed.user('superadmin', null), {
      companyId: c.id,
    });
    const ended = (await sa.get('/login-sessions?status=ended')).body.items;
    expect(ended).toContainEqual(
      expect.objectContaining({ active: false, endReason: 'idle_timeout' }),
    );
  });

  it('ends a session of the chosen company only', async () => {
    const c = await seed.company();
    const other = await seed.company();
    const mine = await loginAs(t, await seed.user('manager', c.id));
    const theirs = await loginAs(t, await seed.user('manager', other.id));
    const theirId = (await theirs.get('/auth/sessions')).body[0].id;
    const mineId = (await mine.get('/auth/sessions')).body[0].id;

    const sa = await loginAs(t, await seed.user('superadmin', null), {
      companyId: c.id,
    });
    expect((await sa.delete(`/login-sessions/${theirId}`)).status).toBe(404);
    expect((await sa.delete(`/login-sessions/${mineId}`)).status).toBe(204);
    expect((await mine.get('/auth/me')).status).toBe(401);
    expect((await theirs.get('/auth/me')).status).toBe(200);

    const everywhere = await loginAs(t, await seed.user('superadmin', null));
    expect((await everywhere.delete(`/login-sessions/${theirId}`)).status).toBe(
      204,
    );
  });
});

describe('tokens signed with the right secret but not by a login', () => {
  // Someone who got hold of the secret (or a bug that signs other tokens)
  // must still not get in without a real session.
  const resign = async (token: string, change: Record<string, unknown>) => {
    const { JwtService } = require('@nestjs/jwt');
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    );
    const { iat, exp, iss, aud, ...rest } = claims;
    void [iat, exp, iss, aud];
    const payload = Object.fromEntries(
      Object.entries({ ...rest, ...change }).filter(([, v]) => v !== undefined),
    );
    return t.app.get(JwtService).signAsync(payload) as Promise<string>;
  };
  const me = (token: string) => api(t.app, { token }).get('/auth/me');

  it.each([
    ['without a session id', { sid: undefined }],
    ['without a token id', { jti: undefined }],
    ['with a session id that is not an id', { sid: 'abc' }],
  ])('refuses a token %s', async (_, change) => {
    const user = await loginAs(t, await seed.user('admin', company.id));
    const res = await me(await resign(user.token, change));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it("refuses a token pointing at someone else's session", async () => {
    const mine = await loginAs(t, await seed.user('admin', company.id));
    const other = await seed.user('admin', company.id);
    const res = await me(await resign(mine.token, { sub: other.id }));
    expect(res.status).toBe(401);
  });

  it('refuses a token for an unknown session', async () => {
    const user = await loginAs(t, await seed.user('admin', company.id));
    expect(
      (await me(await resign(user.token, { sid: unknownId() }))).status,
    ).toBe(401);
  });
});

describe('accounts and sessions over time', () => {
  it('refuses a company user whose account lost its company', async () => {
    const user = await seed.user('manager', company.id);
    const api = await loginAs(t, user);
    await t.model('User').updateOne({ _id: user.id }, { companyId: null });
    const res = await api.get('/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Your account has no company');
  });

  it('records activity on the session at most once a minute', async () => {
    const user = await seed.user('admin', company.id);
    setNow('2026-10-20T08:00:00Z');
    const api = await loginAs(t, user);
    const sid = JSON.parse(
      Buffer.from(api.token.split('.')[1], 'base64url').toString(),
    ).sid;
    const lastSeen = async () =>
      (await t.model('LoginSession').findById(sid).lean<any>()).lastSeenAt;
    const first = await lastSeen();

    setNow('2026-10-20T08:00:30Z');
    await api.get('/auth/me');
    expect(await lastSeen()).toEqual(first);

    setNow('2026-10-20T08:02:00Z');
    await api.get('/auth/me');
    // The write isn't awaited by the request
    const until = Date.now() + 2000;
    let seen = await lastSeen();
    while (seen?.getTime() === first?.getTime() && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 25));
      seen = await lastSeen();
    }
    expect(seen.toISOString()).toBe('2026-10-20T08:02:00.000Z');
  });

  it('forgets expired lockouts of unknown emails once 10 000 are tracked', async () => {
    const { AuthService } = require('../src/auth/auth.service');
    const failures: Map<string, { count: number; lockedUntil: number }> =
      t.app.get(AuthService).unknownFailures;
    const kept = failures.size;
    for (let i = 0; i < 10_001; i++) {
      failures.set(`old-${i}`, { count: 0, lockedUntil: Date.now() - 1000 });
    }
    failures.set('still-locked', {
      count: 0,
      lockedUntil: Date.now() + 60_000,
    });

    await login('nobody-here@test.dz', 'Wrong-pass-1');

    expect(failures.has('old-0')).toBe(false);
    expect(failures.has('still-locked')).toBe(true);
    expect(failures.size).toBeLessThan(kept + 10);
    failures.delete('still-locked');
  });
});
