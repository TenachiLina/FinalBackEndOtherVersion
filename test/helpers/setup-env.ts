// Runs before every test file (unit and integration).
// The app reads these when its modules load, so they are set before any import.

Object.assign(process.env, {
  NODE_ENV: 'test',
  // Servers run in UTC; tests that care about Algeria use withTimeZone()
  TZ: process.env.TZ || 'UTC',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256',
  FORCE_HTTPS: 'true',
  TRUST_PROXY: 'loopback',
  ACCESS_TOKEN_TTL: '15m',
  // Route-wide limit; login and refresh keep their own stricter limits
  RATE_LIMIT_PER_MINUTE: '100000',
  DEVICE_IP: '192.0.2.10',
});
