import { parseDuration, securityConfig } from './security.config';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
    ['90', 90_000],
    [' 2 H ', 7_200_000],
  ])('%s → %d ms', (value, ms) => {
    expect(parseDuration(value, '1s')).toBe(ms);
  });

  it('uses the fallback when empty', () => {
    expect(parseDuration(undefined, '15m')).toBe(900_000);
    expect(parseDuration('  ', '1h')).toBe(3_600_000);
  });

  it('refuses what it cannot read', () => {
    expect(() => parseDuration('1.5h', '1s')).toThrow(
      'Invalid duration "1.5h"',
    );
    expect(() => parseDuration('-5m', '1s')).toThrow(/Invalid/);
    expect(() => parseDuration('soon', '1s')).toThrow(/Invalid/);
    expect(() => parseDuration('0m', '1s')).toThrow('must be positive');
  });
});

describe('securityConfig', () => {
  const keys = [
    'ACCESS_TOKEN_TTL',
    'SESSION_IDLE_TIMEOUT',
    'SESSION_MAX_AGE',
    'JWT_EXPIRES_IN',
  ];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('has safe defaults', () => {
    expect(securityConfig()).toEqual({
      accessTokenMs: 15 * 60_000,
      idleTimeoutMs: 4 * 3_600_000,
      maxAgeMs: 12 * 3_600_000,
    });
  });

  it('reads the environment, including the old JWT_EXPIRES_IN name', () => {
    process.env.ACCESS_TOKEN_TTL = '5m';
    process.env.SESSION_IDLE_TIMEOUT = '1h';
    process.env.JWT_EXPIRES_IN = '2d';
    expect(securityConfig()).toEqual({
      accessTokenMs: 5 * 60_000,
      idleTimeoutMs: 3_600_000,
      maxAgeMs: 2 * 86_400_000,
    });
    process.env.SESSION_MAX_AGE = '8h';
    expect(securityConfig().maxAgeMs).toBe(8 * 3_600_000);
  });
});
