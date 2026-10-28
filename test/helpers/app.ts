import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';

export interface TestApp {
  app: NestExpressApplication;
  /** A Mongoose model by name: model('Employee'), model('User')… */
  model<T = any>(name: string): Model<T>;
  /** Deletes every document, keeps the app running. */
  wipe(): Promise<void>;
  close(): Promise<void>;
}

let dbCounter = 0;

/**
 * Starts the real app (AppModule + configureApp, as in main.ts) on its own
 * database in the shared test MongoDB. Call once per file in beforeAll.
 */
export async function createTestApp(): Promise<TestApp> {
  const base = process.env.MONGO_TEST_URI;
  if (!base) throw new Error('MONGO_TEST_URI not set: run through jest');
  const dbName = `t${process.env.JEST_WORKER_ID ?? 0}_${Date.now()}_${dbCounter++}`;
  process.env.MONGODB_URI = `${base.replace(/\/?$/, '/')}${dbName}`;

  // Loaded here, after setup-env.ts, because modules read process.env when loaded
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } = require('../../src/app.module');
  const { configureApp } = require('../../src/app.setup');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  // Unique indexes must exist before tests rely on them
  await Promise.all(Object.values(connection.models).map((m) => m.init()));

  return {
    app,
    model: <T>(name: string) => app.get<Model<T>>(getModelToken(name)),
    async wipe() {
      await Promise.all(
        Object.values(connection.collections).map((c) => c.deleteMany({})),
      );
    },
    async close() {
      await connection.dropDatabase().catch(() => undefined);
      await app.close();
    },
  };
}

let ipCounter = 0;
/** A new client IP, so per-IP rate limits never spill between tests. */
export const freshIp = () =>
  `198.51.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type Api = Record<Method, (url: string) => request.Test>;

/**
 * HTTP client that behaves like the browser behind Render's proxy: HTTPS
 * ended at the proxy, real IP in X-Forwarded-For, a desktop Chrome.
 * Pass a token to call as a logged-in user, and companyId to set
 * X-Company-Id (super admin).
 */
export function api(
  app: NestExpressApplication,
  opts: { token?: string; companyId?: string; ip?: string } = {},
): Api {
  const ip = opts.ip ?? freshIp();
  const agent = request(app.getHttpServer());
  const wrap = (method: Method) => (url: string) => {
    let req = agent[method](url)
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-For', ip)
      .set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36',
      );
    if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
    if (opts.companyId) req = req.set('X-Company-Id', opts.companyId);
    return req;
  };
  return {
    get: wrap('get'),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    delete: wrap('delete'),
  };
}
