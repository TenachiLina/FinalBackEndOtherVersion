import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { api, createTestApp, type TestApp } from './helpers/app';
import type { Response } from 'express';
import { setupApiDocs } from '../src/health/api-docs';
import { HealthController } from '../src/health/health.controller';

// GET /health for uptime checks and the hosting platform, and the API's
// documentation at /docs.

let t: TestApp;

beforeAll(async () => {
  // The documentation is set up before the app starts, as in main.ts
  t = await createTestApp({ beforeInit: setupApiDocs });
});
afterAll(() => t.close());

describe('GET /health', () => {
  it('says the server and the database are up, without signing in', async () => {
    const res = await api(t.app).get('/health');
    expect(res.status).toBe(200);
    expect([null, 'string']).toContain(
      res.body.version === null ? null : typeof res.body.version,
    );
    expect(res.body).toEqual({
      status: 'ok',
      database: 'up',
      uptime: expect.any(Number),
      version: res.body.version,
    });
  });

  it('answers the same at the root, for platforms that only look there', async () => {
    const res = await api(t.app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('says nothing about any company or user', async () => {
    const res = await api(t.app).get('/health');
    expect(Object.keys(res.body).sort()).toEqual([
      'database',
      'status',
      'uptime',
      'version',
    ]);
  });

  it('answers 503 when the database is unreachable', async () => {
    const connection = t.app.get<Connection>(getConnectionToken());
    const ping = jest.spyOn(connection.db!, 'admin').mockReturnValue({
      ping: () => Promise.reject(new Error('down')),
    } as never);
    try {
      const res = await api(t.app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: 'unavailable',
        database: 'down',
      });
    } finally {
      ping.mockRestore();
    }
  });

  it('answers 503 while the database is not connected', async () => {
    // Mongoose's connection state can't be faked on the live app: ask the check directly
    const status = jest.fn();
    const check = new HealthController({
      readyState: 0,
    } as unknown as Connection);
    const body = await check.health({ status } as unknown as Response);
    expect(status).toHaveBeenCalledWith(503);
    expect(body).toMatchObject({ status: 'unavailable', database: 'down' });
  });

  it('is never rate limited and never written to the activity log', async () => {
    const client = api(t.app);
    for (let i = 0; i < 20; i++)
      expect((await client.get('/health')).status).toBe(200);
    expect(await t.model('AuditLog').countDocuments({})).toBe(0);
  });
});

describe('the API documentation', () => {
  it('lists every route, grouped by area, with the sign-in they need', async () => {
    const res = await api(t.app).get('/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('Nexo InOuty API');
    const paths = Object.keys(res.body.paths);
    for (const path of [
      '/auth/login',
      '/employees',
      '/payroll/period',
      '/dashboard',
      '/health',
    ]) {
      expect(paths).toContain(path);
    }
    const period = res.body.paths['/payroll/period'].get;
    expect(period.tags).toEqual(['Payroll']);
    expect(period.security).toEqual([{ bearer: [] }]);
    expect(res.body.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('serves its page, which may load its own scripts and styles', async () => {
    const res = await api(t.app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nexo InOuty API');
    const policy = res.headers['content-security-policy'];
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('leaves the strict policy on every other route', async () => {
    const res = await api(t.app).get('/health');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    const lookalike = await api(t.app).get('/docsy');
    expect(lookalike.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
  });

  it('can be switched off', () => {
    const before = process.env.API_DOCS;
    process.env.API_DOCS = 'off';
    try {
      expect(setupApiDocs(t.app)).toBe(false);
    } finally {
      process.env.API_DOCS = before;
    }
  });
});
