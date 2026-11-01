import { readFileSync } from 'fs';
import type { NextFunction, Request, Response } from 'express';

/** True on Render or when NODE_ENV=production. */
export const isProduction = () =>
  process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === ''
    ? fallback
    : /^(1|true|yes)$/i.test(value);

/**
 * TLS certificate for serving HTTPS directly (local development, or a server
 * without an HTTPS proxy in front). On Render, HTTPS is handled by Render's
 * proxy and these stay empty.
 */
export function httpsOptions() {
  const key = process.env.SSL_KEY_PATH;
  const cert = process.env.SSL_CERT_PATH;
  if (!key && !cert) return undefined;
  if (!key || !cert) {
    throw new Error('Set both SSL_KEY_PATH and SSL_CERT_PATH (or neither)');
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/**
 * How many proxies stand in front of the app. Needed so `req.ip` is the
 * visitor's address and `req.secure` sees HTTPS ended at the proxy.
 * Render has one. TRUST_PROXY overrides (a number of hops, or false).
 */
export function trustProxySetting(): number | string | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (raw) {
    if (/^\d+$/.test(raw)) return Number(raw);
    if (/^(false|no)$/i.test(raw)) return false;
    return raw; // e.g. "loopback" or a list of addresses
  }
  return isProduction() ? 1 : 'loopback';
}

// The ZKTeco clocking machine only speaks plain HTTP (ADMS protocol) and is
// authorized by its serial number instead (see zkteco.controller.ts).
const HTTP_ALLOWED = /^\/iclock\//;

/**
 * Refuses plain HTTP. Reads (GET) are redirected to the same address on
 * HTTPS; anything else is refused, because a password or token sent over
 * HTTP has already crossed the network unencrypted.
 * On by default in production; FORCE_HTTPS=true/false overrides.
 */
export function requireHttps() {
  const enabled = flag(process.env.FORCE_HTTPS, isProduction());
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled || req.secure || HTTP_ALLOWED.test(req.path)) return next();
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    res.status(403).json({
      statusCode: 403,
      error: 'forbidden',
      message: 'HTTPS is required',
    });
  };
}

// Keys that could change a database query ($where, $ne…) or the shape of
// JavaScript objects (prototype pollution).
const FORBIDDEN_KEY = /^\$|^(__proto__|constructor|prototype)$/;

export function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object') return false;
  // Fails closed: what isn't checked isn't let through. No form nests this deep.
  if (depth > 20) return true;
  if (Array.isArray(value)) {
    return value.some((v) => hasForbiddenKey(v, depth + 1));
  }
  return Object.keys(value).some(
    (k) =>
      FORBIDDEN_KEY.test(k) ||
      hasForbiddenKey((value as Record<string, unknown>)[k], depth + 1),
  );
}

/**
 * Refuses request bodies with MongoDB operators or prototype keys, e.g.
 * {"email": {"$ne": ""}}. Query strings can't contain objects (Express 5's
 * simple parser), so only the body needs checking.
 */
export function rejectInjection() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasForbiddenKey(req.body)) {
      return res.status(400).json({
        statusCode: 400,
        error: 'bad request',
        message: 'The data sent was not valid',
      });
    }
    next();
  };
}

/** API answers hold personal data: browsers and proxies must not keep copies. */
export function noStore() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
