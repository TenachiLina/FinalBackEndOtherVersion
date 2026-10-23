/**
 * Security settings, read from environment variables with safe defaults.
 * Durations accept "30s", "15m", "12h", "7d" or a number of seconds.
 */

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function parseDuration(value: string | undefined, fallback: string) {
  const raw = (value ?? '').trim() || fallback;
  const match = /^(\d+)\s*([smhd]?)$/i.exec(raw);
  if (!match) throw new Error(`Invalid duration "${raw}" (use e.g. 15m, 12h)`);
  const seconds = Number(match[1]) * UNITS[(match[2] || 's').toLowerCase()];
  if (seconds <= 0) throw new Error(`Duration "${raw}" must be positive`);
  return seconds * 1000;
}

export const securityConfig = () => ({
  // Lifetime of one access token. Short, because it is sent on every request.
  accessTokenMs: parseDuration(process.env.ACCESS_TOKEN_TTL, '15m'),
  // The session ends after this long without any request...
  idleTimeoutMs: parseDuration(process.env.SESSION_IDLE_TIMEOUT, '4h'),
  // ...and in any case this long after sign-in.
  // (JWT_EXPIRES_IN is the old name of this setting.)
  maxAgeMs: parseDuration(
    process.env.SESSION_MAX_AGE ?? process.env.JWT_EXPIRES_IN,
    '12h',
  ),
});

// After a rotation the previous tokens stay valid this long, so requests
// already on their way (or a second tab refreshing at the same moment)
// don't fail.
export const ROTATION_GRACE_MS = 30 * 1000;
// lastSeenAt / lastIp are written at most this often per session.
export const TOUCH_EVERY_MS = 60 * 1000;

// Signed into every token and checked on every request.
export const JWT_ISSUER = 'clockin-api';
export const JWT_AUDIENCE = 'clockin-app';

// Codes the frontend uses to decide what to do after a 401.
export const AUTH_CODES = {
  // The access token is too old: get a new one with the refresh token.
  tokenExpired: 'TOKEN_EXPIRED',
  // The token is not one of ours, or was tampered with.
  tokenInvalid: 'TOKEN_INVALID',
  // The session was ended (logout, revoked, expired): sign in again.
  sessionEnded: 'SESSION_ENDED',
  // Another tab refreshed with the same refresh token a moment ago:
  // read the new tokens from storage and retry.
  refreshRace: 'REFRESH_RACE',
} as const;
