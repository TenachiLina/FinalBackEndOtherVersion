import { runForCompany } from '../tenancy/tenant-context';
import {
  ErrorReport,
  locate,
  newReference,
  reportError,
  setErrorWriter,
} from './error-reporter';

describe('error reporter', () => {
  let saved: ErrorReport[];
  beforeEach(() => {
    saved = [];
    setErrorWriter(async (r) => {
      saved.push(r);
    });
  });

  it('finds the first line of our own code in a stack trace', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'empNumber')",
      '    at PlanningService.findAll (D:\\app\\dist\\planning\\planning.service.js:212:31)',
      '    at D:\\app\\node_modules\\@nestjs\\core\\router\\router-execution-context.js:46:28',
    ].join('\n');
    expect(locate(stack)).toBe(
      'planning/planning.service.js:212 (PlanningService.findAll)',
    );
    expect(
      locate('Error: x\n    at node:internal/process:1:1'),
    ).toBeUndefined();
  });

  it('explains a missing value in plain words', () => {
    reportError(
      new TypeError(
        "Cannot read properties of undefined (reading 'empNumber')",
      ),
      { level: 'error', source: 'request' },
    );
    expect(saved[0].name).toBe('TypeError');
    expect(saved[0].hint).toContain('"empNumber"');
  });

  it('explains database connection failures', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:27017');
    err.name = 'MongoServerSelectionError';
    reportError(err, { level: 'error', source: 'background' });
    expect(saved[0].hint).toMatch(/couldn't reach the database/);
  });

  it('gives the same fingerprint to the same error with different IDs', () => {
    const opts = {
      level: 'error',
      source: 'request',
      route: '/x/:id',
    } as const;
    reportError(new Error('Shift 64b7f0c2a1b2c3d4e5f60718 not found'), opts);
    reportError(new Error('Shift 64b7f0c2a1b2c3d4e5f60719 not found'), opts);
    reportError(new Error('Something else'), opts);
    expect(saved[0].fingerprint).toBe(saved[1].fingerprint);
    expect(saved[2].fingerprint).not.toBe(saved[0].fingerprint);
  });

  it('accepts things that are not Error objects', () => {
    reportError('plain text failure', { level: 'error', source: 'process' });
    expect(saved[0]).toMatchObject({
      name: 'Error',
      message: 'plain text failure',
    });
  });

  it('copes with nothing at all', () => {
    reportError(null, { level: 'error', source: 'process' });
    reportError({}, { level: 'error', source: 'process' });
    expect(saved[0]).toMatchObject({ name: 'Error', message: 'Unknown error' });
    expect(saved[1]).toMatchObject({
      name: 'Object',
      message: 'Unknown error',
    });
  });

  it('keeps what the caller says over what the error says', () => {
    const err = Object.assign(new Error('raw'), { code: 'E1' });
    reportError(err, {
      level: 'warning',
      source: 'request',
      name: 'Custom',
      message: 'Shown',
      code: 'E2',
      where: 'here',
      hint: 'Try again',
      stack: 'none',
    });
    expect(saved[0]).toMatchObject({
      name: 'Custom',
      message: 'Shown',
      code: 'E2',
      where: 'here',
      hint: 'Try again',
      stack: 'none',
    });
  });

  it('turns error codes into text', () => {
    reportError(Object.assign(new Error('dup'), { code: 11000 }), {
      level: 'error',
      source: 'request',
    });
    expect(saved[0].code).toBe('11000');
  });

  it('shortens long messages and stacks', () => {
    const err = new Error('m'.repeat(5000));
    err.stack = 's'.repeat(10_000);
    reportError(err, { level: 'error', source: 'request' });
    expect(saved[0].message).toHaveLength(2000);
    expect(saved[0].stack).toHaveLength(6000);
  });

  it('records the company of the request it happened in', () => {
    runForCompany('64b7f0c2a1b2c3d4e5f60001', () =>
      reportError(new Error('x'), { level: 'error', source: 'request' }),
    );
    reportError(new Error('y'), {
      level: 'error',
      source: 'request',
      companyId: 'given',
    });
    expect(saved[0].companyId).toBe('64b7f0c2a1b2c3d4e5f60001');
    expect(saved[1].companyId).toBe('given');
  });

  it('makes short reference codes', () => {
    expect(newReference()).toMatch(/^[0-9A-F]{8}$/);
    expect(newReference()).not.toBe(newReference());
  });

  describe('hints', () => {
    const hintFor = (error: unknown, statusCode?: number) => {
      reportError(error, { level: 'error', source: 'request', statusCode });
      return saved[saved.length - 1].hint;
    };
    const named = (name: string, message = 'x', extra: object = {}) =>
      Object.assign(new Error(message), { name }, extra);

    it.each([
      [
        named('CastError', 'Cast failed', { path: 'empId' }),
        /wrong type for "empId"/,
      ],
      [named('CastError'), /wrong type for "a field"/],
      [named('ValidationError'), /missing required fields/],
      [
        Object.assign(new Error('E11000 duplicate'), { code: 11000 }),
        /same unique value/,
      ],
      [named('TenantContextError'), /without a company selected/],
      [named('TokenExpiredError'), /JWT_SECRET/],
      [
        new Error('connect ETIMEDOUT 192.0.2.10:4370'),
        /Couldn't connect to another machine/,
      ],
      [
        new Error('MongoNetworkError: buffering timed out'),
        /couldn't reach the database/,
      ],
      [new TypeError('Cannot read properties of null'), /a property.*was null/],
      [new TypeError('x.map is not a function'), /isn't a function/],
      [new ReferenceError('foo is not defined'), /name that does not exist/],
      [named('ChunkLoadError'), /Reloading the page/],
      [new Error('Loading chunk 12 failed.'), /Reloading the page/],
      [
        new Error('Hydration failed because the server HTML did not match'),
        /looked different/,
      ],
      [
        new SyntaxError('Unexpected token < in JSON at position 0'),
        /JSON couldn't be read/,
      ],
    ])('explains %s', (error, hint) => {
      expect(hintFor(error)).toMatch(hint);
    });

    it('says a 4xx was refused on purpose', () => {
      expect(hintFor(new Error('Shift not found'), 404)).toMatch(/status 404/);
    });

    it('says nothing when it has no idea', () => {
      expect(hintFor(new Error('Something odd'))).toBeUndefined();
    });
  });

  describe('locate', () => {
    it('reads source paths, frontend chunks and functions without names', () => {
      expect(locate('Error\n    at /app/src/common/x.ts:5:3')).toBe(
        'common/x.ts:5',
      );
      expect(
        locate(
          'Error\n    at Page (https://app.dz/_next/static/chunks/app/page-1a2b.js:1:200)',
        ),
      ).toBe('app/page-1a2b.js:1 (Page)');
      expect(locate(undefined)).toBeUndefined();
      expect(locate('Error\n    weird line')).toBeUndefined();
    });
  });
});

describe('errors raised before the database is ready', () => {
  it('are kept, then saved once a writer is set (at most 100)', () => {
    jest.isolateModules(() => {
      const fresh =
        require('./error-reporter') as typeof import('./error-reporter');
      for (let i = 0; i < 105; i++) {
        fresh.reportError(new Error(`early ${i}`), {
          level: 'error',
          source: 'process',
        });
      }
      const got: ErrorReport[] = [];
      fresh.setErrorWriter(async (r) => {
        got.push(r);
      });
      expect(got).toHaveLength(100);
      expect(got[0].message).toBe('early 0');

      fresh.setErrorWriter(async (r) => {
        got.push(r);
      });
      expect(got).toHaveLength(100);
    });
  });
});
