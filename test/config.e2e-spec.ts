import mongoose from 'mongoose';
import request from 'supertest';
import { api, createTestApp, type TestApp } from './helpers/app';

// How the environment changes the app: the JWT secret checks at start-up,
// and which browser origins CORS lets in (development vs production,
// FRONTEND_URL, the Vercel preview URLs).

/** Runs fn with these env vars set, then puts the old values back. */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  const set = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  set(vars);
  try {
    return await fn();
  } finally {
    set(before);
  }
}

describe('the JWT secret, checked at start-up', () => {
  // A start-up that fails leaves its database connection open
  afterAll(() => Promise.all(mongoose.connections.map((c) => c.close())));

  it.each([
    ['missing', undefined],
    ['shorter than 32 characters', 'too-short-secret'],
  ])('refuses to start when it is %s', async (_, secret) => {
    await withEnv({ JWT_SECRET: secret }, async () => {
      await expect(createTestApp()).rejects.toThrow(
        'JWT_SECRET must be set to a random string of at least 32 characters',
      );
    });
  });

  it.each([
    [
      'the old published secret',
      '390e28b2b76799d433bb9f9636585d7cf0d34ebb65a066d1aaabb607840a40bb4875838002aef81585444f7b4da6d844',
    ],
    ['a "change me" example', 'please-change-me-to-a-long-random-string-0123'],
  ])('refuses %s in production', async (_, secret) => {
    await withEnv({ JWT_SECRET: secret, NODE_ENV: 'production' }, async () => {
      await expect(createTestApp()).rejects.toThrow(
        'JWT_SECRET is a published example value',
      );
    });
  });

  it('only warns about an example secret outside production', async () => {
    await withEnv(
      { JWT_SECRET: 'please-change-me-to-a-long-random-string-0123' },
      async () => {
        const t = await createTestApp();
        await t.close();
      },
    );
  });
});

describe('CORS', () => {
  const allowed = async (t: TestApp, origin: string) => {
    const res = await api(t.app).get('/no-such-route').set('Origin', origin);
    return res.headers['access-control-allow-origin'] === origin;
  };

  describe('in development', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await withEnv(
        { FRONTEND_URL: 'https://app.example.dz, https://staging.example.dz' },
        createTestApp,
      );
    });
    afterAll(() => t.close());

    it.each([
      ['https://localhost:3000'],
      ['http://localhost:3000'],
      ['https://app.example.dz'],
      ['https://staging.example.dz'],
      ['https://final-front-end-other-version.vercel.app'],
      ['https://final-front-end-other-version-git-dev-team.vercel.app'],
    ])('lets %s in', async (origin) => {
      expect(await allowed(t, origin)).toBe(true);
    });

    it.each([
      ['https://evil.example.com'],
      ['https://final-front-end-other-version.vercel.app.evil.com'],
      ['https://other-project.vercel.app'],
      ['http://localhost:3001'],
    ])('keeps %s out', async (origin) => {
      expect(await allowed(t, origin)).toBe(false);
    });

    it('answers the preflight with the headers the frontend sends', async () => {
      const res = await request(t.app.getHttpServer())
        .options('/employees')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://app.example.dz')
        .set('Access-Control-Request-Method', 'PATCH');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-headers']).toContain(
        'X-Company-Id',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('in production', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await withEnv(
        {
          NODE_ENV: 'production',
          FRONTEND_URL: 'https://app.example.dz,http://insecure.example.dz,',
        },
        createTestApp,
      );
    });
    afterAll(() => t.close());

    it('lets the HTTPS frontends in', async () => {
      expect(await allowed(t, 'https://app.example.dz')).toBe(true);
      expect(await allowed(t, 'https://localhost:3000')).toBe(true);
    });

    it('keeps plain-HTTP origins out, local ones included', async () => {
      expect(await allowed(t, 'http://insecure.example.dz')).toBe(false);
      expect(await allowed(t, 'http://localhost:3000')).toBe(false);
    });
  });
});
