/**
 * Security tests: run the real app against a throw-away in-memory MongoDB.
 *   npm run test:security
 */
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Model } from 'mongoose';
import { createHmac } from 'crypto';
const request = require('supertest');

const JWT_SECRET = 'test-secret-'.padEnd(64, 'x');
const PASSWORD = 'Str0ng-pass-1';

let mongo: MongoMemoryServer;
let app: NestExpressApplication;
let sessionModel: Model<any>;
let userModel: Model<any>;
let ipCounter = 1;

// Behaves like Render: HTTPS ended at the proxy, real IP in X-Forwarded-For.
// Each call can use its own IP so rate limits don't spill between tests.
function api(ip = '203.0.113.1') {
  const agent = request(app.getHttpServer());
  const wrap =
    (method: 'get' | 'post' | 'patch' | 'delete' | 'put') => (url: string) =>
      agent[method](url)
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-For', ip)
        .set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36',
        );
  return {
    get: wrap('get'),
    post: wrap('post'),
    patch: wrap('patch'),
    delete: wrap('delete'),
    put: wrap('put'),
  };
}
const freshIp = () => `198.51.100.${ipCounter++}`;

async function login(email: string, password = PASSWORD, ip = freshIp()) {
  return api(ip).post('/auth/login').send({ email, password });
}

const decode = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri('security_test'),
    JWT_SECRET,
    FORCE_HTTPS: 'true',
    TRUST_PROXY: 'loopback',
    ACCESS_TOKEN_TTL: '15m',
  });
  // Loaded after the environment is set: modules read it when loaded.
  const { AppModule } = require('../src/app.module');
  const { configureApp } = require('../src/app.setup');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();

  sessionModel = app.get(getModelToken('LoginSession'));
  userModel = app.get(getModelToken('User'));
  const { CompaniesService } = require('../src/companies/companies.service');
  const { UsersService } = require('../src/auth/users.service');
  const company = await app
    .get(CompaniesService)
    .create({ name: 'Test Co' } as any);
  const users = app.get(UsersService);
  const cid = String(company._id);
  await users.create(cid, {
    email: 'admin@test.dz',
    name: 'Admin',
    password: PASSWORD,
    role: 'admin',
  });
  await users.create(cid, {
    email: 'manager@test.dz',
    name: 'Manager',
    password: PASSWORD,
    role: 'manager',
  });
  await users.create(cid, {
    email: 'victim@test.dz',
    name: 'Victim',
    password: PASSWORD,
    role: 'manager',
  });
  await users.create(cid, {
    email: 'kiosk@test.dz',
    name: 'Kiosk',
    password: PASSWORD,
    role: 'employee',
  });
  // A super admin has no company; created directly like the create-superadmin script
  await userModel.create({
    email: 'super@test.dz',
    name: 'Super',
    role: 'superadmin',
    companyId: null,
    passwordHash: await UsersService.hashPassword(PASSWORD),
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await mongo?.stop();
});

describe('Password hashing', () => {
  it('stores only a bcrypt hash, never the password', async () => {
    const user = await userModel
      .findOne({ email: 'admin@test.dz' })
      .select('+passwordHash')
      .lean<any>();
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('never returns the hash from the API', async () => {
    const { body } = await login('admin@test.dz');
    const res = await api()
      .get('/users')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('refuses weak passwords', async () => {
    const { body } = await login('admin@test.dz');
    for (const password of [
      'short1',
      'onlyletters',
      '12345678',
      'Password123',
    ]) {
      const res = await api()
        .post('/users')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({
          email: `weak${Math.random()}@test.dz`,
          name: 'Weak',
          password,
          role: 'manager',
        });
      expect(res.status).toBe(400);
    }
  });
});

describe('Login sessions and tokens', () => {
  it('creates a login_sessions record with IP, device and token id', async () => {
    const ip = freshIp();
    const res = await login('manager@test.dz', PASSWORD, ip);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    const claims = decode(res.body.accessToken);
    expect(claims.role).toBeUndefined(); // the role is never trusted from the token
    expect(claims.iss).toBe('clockin-api');

    const session = await sessionModel
      .findById(claims.sid)
      .select('+refreshTokenHash')
      .lean<any>();
    expect(session.ip).toBe(ip);
    expect(session.device).toBe('Chrome on Windows');
    expect(session.accessTokenId).toBe(claims.jti);
    // Only a hash of the refresh token is stored
    expect(session.refreshTokenHash).toHaveLength(64);
    expect(session.refreshTokenHash).not.toBe(res.body.refreshToken);
  });

  it('rotates both tokens on refresh, and old ones stop working', async () => {
    const first = (await login('manager@test.dz')).body;
    const refreshed = await api()
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).not.toBe(first.accessToken);
    expect(refreshed.body.refreshToken).not.toBe(first.refreshToken);

    const sid = decode(first.accessToken).sid;
    expect((await sessionModel.findById(sid).lean<any>()).rotationCount).toBe(
      1,
    );

    // New token works
    const me = await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(me.status).toBe(200);

    // After the 30 s grace period the old access token is refused
    await sessionModel.updateOne(
      { _id: sid },
      { rotatedAt: new Date(Date.now() - 60_000) },
    );
    const old = await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(old.status).toBe(401);
    expect(old.body.code).toBe('TOKEN_EXPIRED');
  });

  it('ends the whole session when an old refresh token is reused (theft)', async () => {
    const first = (await login('manager@test.dz')).body;
    const second = (
      await api()
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
    ).body;
    const sid = decode(first.accessToken).sid;

    // Within the grace period (another tab): answered "already renewed"
    const race = await api()
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(race.status).toBe(409);
    expect(race.body.code).toBe('REFRESH_RACE');

    // Later: it can only be a copy. The session is ended for everyone.
    await sessionModel.updateOne(
      { _id: sid },
      { rotatedAt: new Date(Date.now() - 60_000) },
    );
    const reuse = await api()
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('SESSION_ENDED');

    const session = await sessionModel.findById(sid).lean<any>();
    expect(session.revokedReason).toBe('refresh_token_reused');
    const legit = await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${second.accessToken}`);
    expect(legit.status).toBe(401);
  });

  it('logout ends the session at once', async () => {
    const { accessToken, refreshToken } = (await login('manager@test.dz')).body;
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await api().post('/auth/logout').set(auth)).status).toBe(204);
    const after = await api().get('/auth/me').set(auth);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('SESSION_ENDED');
    expect(
      (await api().post('/auth/refresh').send({ refreshToken })).status,
    ).toBe(401);
  });

  it('refuses forged or tampered tokens', async () => {
    const { accessToken } = (await login('manager@test.dz')).body;
    const [h, p, sig] = accessToken.split('.');
    // Payload changed (e.g. to claim another user), signature kept
    const claims = decode(accessToken);
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...claims,
        role: 'admin',
        sub: '000000000000000000000000',
      }),
    ).toString('base64url');
    const tampered = await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${h}.${forgedPayload}.${sig}`);
    expect(tampered.status).toBe(401);

    // "alg: none" token
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    expect(
      (await api().get('/auth/me').set('Authorization', `Bearer ${none}`))
        .status,
    ).toBe(401);

    // Signed with a wrong secret
    const body = `${h}.${p}`;
    const wrongSig = createHmac('sha256', 'wrong-secret')
      .update(body)
      .digest('base64url');
    expect(
      (
        await api()
          .get('/auth/me')
          .set('Authorization', `Bearer ${body}.${wrongSig}`)
      ).status,
    ).toBe(401);
  });

  it('lists your sessions and lets the super admin see and end them', async () => {
    const mine = (await login('victim@test.dz')).body;
    const admin = (await login('super@test.dz')).body;
    const list = await api()
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${mine.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.some((s: any) => s.current)).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/refreshTokenHash/);

    const all = await api()
      .get('/login-sessions')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(all.status).toBe(200);
    const victimSession = all.body.items.find(
      (s: any) => s.id === decode(mine.accessToken).sid,
    );
    expect(victimSession.ip).toBeDefined();
    expect(victimSession.accessTokenId).toBeDefined();

    const end = await api()
      .delete(`/login-sessions/${victimSession.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(end.status).toBe(204);
    expect(
      (
        await api()
          .get('/auth/me')
          .set('Authorization', `Bearer ${mine.accessToken}`)
      ).status,
    ).toBe(401);
  });
});

describe('Roles are checked on the server', () => {
  it('only the super admin sees the login sessions of others', async () => {
    const { accessToken } = (await login('admin@test.dz')).body;
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await api().get('/login-sessions').set(auth)).status).toBe(403);
    expect(
      (await api().delete('/login-sessions/000000000000000000000000').set(auth))
        .status,
    ).toBe(403);
    // Their own sessions stay visible to everyone
    expect((await api().get('/auth/sessions').set(auth)).status).toBe(200);
  });

  it('a manager cannot open admin routes', async () => {
    const { accessToken } = (await login('manager@test.dz')).body;
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await api().get('/users').set(auth)).status).toBe(403);
    expect((await api().get('/login-sessions').set(auth)).status).toBe(403);
    const self = await userModel
      .findOne({ email: 'manager@test.dz' })
      .lean<any>();
    expect(
      (
        await api()
          .patch(`/users/${self._id}`)
          .set(auth)
          .send({ role: 'admin' })
      ).status,
    ).toBe(403);
    expect((await userModel.findById(self._id).lean<any>()).role).toBe(
      'manager',
    );
  });

  it('a kiosk account only reaches kiosk routes', async () => {
    const { accessToken } = (await login('kiosk@test.dz')).body;
    expect(
      (
        await api()
          .get('/employees')
          .set('Authorization', `Bearer ${accessToken}`)
      ).status,
    ).toBe(403);
  });

  it('nobody can create or promote a super admin', async () => {
    const { accessToken } = (await login('admin@test.dz')).body;
    const auth = { Authorization: `Bearer ${accessToken}` };
    const create = await api().post('/users').set(auth).send({
      email: 'evil@test.dz',
      name: 'Evil',
      password: PASSWORD,
      role: 'superadmin',
    });
    expect(create.status).toBe(400);
    const victim = await userModel
      .findOne({ email: 'victim@test.dz' })
      .lean<any>();
    expect(
      (
        await api()
          .patch(`/users/${victim._id}`)
          .set(auth)
          .send({ role: 'superadmin' })
      ).status,
    ).toBe(400);
  });

  it('a role change signs the person out everywhere', async () => {
    const victimLogin = (await login('victim@test.dz')).body;
    const admin = (await login('admin@test.dz')).body;
    const victim = await userModel
      .findOne({ email: 'victim@test.dz' })
      .lean<any>();
    const res = await api()
      .patch(`/users/${victim._id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'employee' });
    expect(res.status).toBe(200);
    const after = await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${victimLogin.accessToken}`);
    expect(after.status).toBe(401);
    await userModel.updateOne({ _id: victim._id }, { role: 'manager' });
  });
});

describe('Attacks on login', () => {
  it('refuses NoSQL injection in the body', async () => {
    const res = await api(freshIp())
      .post('/auth/login')
      .send({ email: { $ne: '' }, password: { $ne: '' } });
    expect(res.status).toBe(400);
  });

  it('locks an account after 5 wrong passwords', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('victim@test.dz', 'Wrong-pass-1')).status).toBe(401);
    }
    // Even the right password is refused while locked
    expect((await login('victim@test.dz')).status).toBe(429);
    await userModel.updateOne(
      { email: 'victim@test.dz' },
      { lockedUntil: null },
    );
  });

  it('rate-limits login attempts per IP', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push(
        (await login(`nobody${i}@test.dz`, 'Wrong-pass-1', ip)).status,
      );
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('HTTPS and headers', () => {
  it('refuses plain HTTP: POST is blocked, GET is redirected', async () => {
    const http = request(app.getHttpServer());
    const post = await http
      .post('/auth/login')
      .send({ email: 'admin@test.dz', password: PASSWORD });
    expect(post.status).toBe(403);
    const get = await http.get('/auth/me');
    expect(get.status).toBe(308);
    expect(get.headers.location).toMatch(/^https:\/\//);
  });

  it('sends security headers', async () => {
    const res = await api().get('/');
    expect(res.headers['strict-transport-security']).toMatch(
      /max-age=31536000/,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
