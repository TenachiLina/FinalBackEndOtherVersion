import {
  ErrorReport,
  locate,
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
    expect(locate('Error: x\n    at node:internal/process:1:1')).toBeUndefined();
  });

  it('explains a missing value in plain words', () => {
    reportError(
      new TypeError("Cannot read properties of undefined (reading 'empNumber')"),
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
    const opts = { level: 'error', source: 'request', route: '/x/:id' } as const;
    reportError(new Error('Shift 64b7f0c2a1b2c3d4e5f60718 not found'), opts);
    reportError(new Error('Shift 64b7f0c2a1b2c3d4e5f60719 not found'), opts);
    reportError(new Error('Something else'), opts);
    expect(saved[0].fingerprint).toBe(saved[1].fingerprint);
    expect(saved[2].fingerprint).not.toBe(saved[0].fingerprint);
  });

  it('accepts things that are not Error objects', () => {
    reportError('plain text failure', { level: 'error', source: 'process' });
    expect(saved[0]).toMatchObject({ name: 'Error', message: 'plain text failure' });
  });
});
