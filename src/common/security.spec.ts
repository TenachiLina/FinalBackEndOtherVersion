import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  hasForbiddenKey,
  httpsOptions,
  isProduction,
  noStore,
  rejectInjection,
  requireHttps,
  trustProxySetting,
} from './security';

const ENV_KEYS = [
  'NODE_ENV',
  'RENDER',
  'FORCE_HTTPS',
  'TRUST_PROXY',
  'SSL_KEY_PATH',
  'SSL_CERT_PATH',
];
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Just enough of an Express response to see what a middleware answered. */
function fakeRes() {
  const res: any = { headers: {} as Record<string, string> };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  res.setHeader = jest.fn((k: string, v: string) => (res.headers[k] = v));
  return res;
}

function run(
  middleware: (req: any, res: any, next: () => void) => void,
  req: any,
) {
  const res = fakeRes();
  const next = jest.fn();
  middleware(req, res, next);
  return { res, next };
}

describe('isProduction', () => {
  it('is false locally', () => {
    expect(isProduction()).toBe(false);
  });

  it('is true with NODE_ENV=production or on Render', () => {
    process.env.NODE_ENV = 'production';
    expect(isProduction()).toBe(true);
    delete process.env.NODE_ENV;
    process.env.RENDER = 'true';
    expect(isProduction()).toBe(true);
  });
});

describe('httpsOptions', () => {
  it('serves plain HTTP when no certificate is configured', () => {
    expect(httpsOptions()).toBeUndefined();
  });

  it('refuses half a certificate', () => {
    process.env.SSL_KEY_PATH = 'key.pem';
    expect(() => httpsOptions()).toThrow(/both SSL_KEY_PATH and SSL_CERT_PATH/);
    delete process.env.SSL_KEY_PATH;
    process.env.SSL_CERT_PATH = 'cert.pem';
    expect(() => httpsOptions()).toThrow(/both/);
  });

  it('reads the key and certificate files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'https-'));
    try {
      writeFileSync(join(dir, 'key.pem'), 'KEY');
      writeFileSync(join(dir, 'cert.pem'), 'CERT');
      process.env.SSL_KEY_PATH = join(dir, 'key.pem');
      process.env.SSL_CERT_PATH = join(dir, 'cert.pem');
      const opts = httpsOptions()!;
      expect(opts.key.toString()).toBe('KEY');
      expect(opts.cert.toString()).toBe('CERT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('trustProxySetting', () => {
  it('trusts only loopback locally and one proxy in production', () => {
    expect(trustProxySetting()).toBe('loopback');
    process.env.RENDER = 'true';
    expect(trustProxySetting()).toBe(1);
  });

  it('follows TRUST_PROXY: a number of hops, false, or a list', () => {
    process.env.TRUST_PROXY = ' 2 ';
    expect(trustProxySetting()).toBe(2);
    process.env.TRUST_PROXY = 'false';
    expect(trustProxySetting()).toBe(false);
    process.env.TRUST_PROXY = 'No';
    expect(trustProxySetting()).toBe(false);
    process.env.TRUST_PROXY = '10.0.0.1, 10.0.0.2';
    expect(trustProxySetting()).toBe('10.0.0.1, 10.0.0.2');
  });
});

describe('requireHttps', () => {
  const req = (over: any) => ({
    secure: false,
    path: '/employees',
    method: 'GET',
    headers: { host: 'api.example.dz' },
    originalUrl: '/employees?x=1',
    ...over,
  });

  it('lets everything through locally', () => {
    const { next, res } = run(requireHttps(), req({ method: 'POST' }));
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('is on by default in production, and FORCE_HTTPS can switch it off', () => {
    process.env.NODE_ENV = 'production';
    expect(run(requireHttps(), req({})).res.redirect).toHaveBeenCalled();
    process.env.FORCE_HTTPS = 'false';
    expect(run(requireHttps(), req({})).next).toHaveBeenCalled();
  });

  describe('when on', () => {
    beforeEach(() => (process.env.FORCE_HTTPS = 'true'));

    it('lets HTTPS requests through', () => {
      expect(
        run(requireHttps(), req({ secure: true })).next,
      ).toHaveBeenCalled();
    });

    it('redirects plain-HTTP reads to the same address on HTTPS', () => {
      for (const method of ['GET', 'HEAD']) {
        const { res, next } = run(requireHttps(), req({ method }));
        expect(next).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
          308,
          'https://api.example.dz/employees?x=1',
        );
      }
    });

    it('refuses plain-HTTP writes, since the data already crossed the network', () => {
      const { res, next } = run(requireHttps(), req({ method: 'POST' }));
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'HTTPS is required' }),
      );
    });

    it('lets the clocking machine use plain HTTP on /iclock/', () => {
      const r = req({ method: 'POST', path: '/iclock/cdata' });
      expect(run(requireHttps(), r).next).toHaveBeenCalled();
    });
  });
});

describe('hasForbiddenKey', () => {
  it('accepts ordinary data', () => {
    expect(hasForbiddenKey({ email: 'a@b.dz', tags: ['x', { y: 1 }] })).toBe(
      false,
    );
    expect(hasForbiddenKey(null)).toBe(false);
    expect(hasForbiddenKey('$ne')).toBe(false);
    expect(hasForbiddenKey({ price: '$5' })).toBe(false);
  });

  it('finds MongoDB operators at any level, in objects and arrays', () => {
    expect(hasForbiddenKey({ email: { $ne: '' } })).toBe(true);
    expect(hasForbiddenKey({ $where: 'sleep(1000)' })).toBe(true);
    expect(hasForbiddenKey({ list: [{ ok: 1 }, { a: { $gt: 0 } }] })).toBe(
      true,
    );
  });

  it('finds prototype keys, as JSON.parse creates them', () => {
    expect(hasForbiddenKey(JSON.parse('{"__proto__": {"admin": true}}'))).toBe(
      true,
    );
    expect(hasForbiddenKey({ a: { constructor: { prototype: {} } } })).toBe(
      true,
    );
    expect(hasForbiddenKey({ prototype: 1 })).toBe(true);
  });

  // BUG-001: an operator nested more than 20 levels deep is let through
  it.failing('finds an operator hidden deeper than 20 levels', () => {
    let body: any = { $ne: '' };
    for (let i = 0; i < 25; i++) body = { a: body };
    expect(hasForbiddenKey(body)).toBe(true);
  });
});

describe('rejectInjection', () => {
  it('answers 400 to a body with an operator', () => {
    const { res, next } = run(rejectInjection(), {
      body: { email: { $ne: '' } },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'bad request',
      message: 'The data sent was not valid',
    });
  });

  it('lets a clean body through', () => {
    expect(
      run(rejectInjection(), { body: { email: 'a@b.dz' } }).next,
    ).toHaveBeenCalled();
    expect(run(rejectInjection(), {}).next).toHaveBeenCalled();
  });
});

describe('noStore', () => {
  it('tells browsers and proxies not to keep a copy', () => {
    const { res, next } = run(noStore(), {});
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(next).toHaveBeenCalled();
  });
});
