import type { ClientInfo } from './sessions.service';

/**
 * Where a request comes from. `req.ip` honours the "trust proxy" setting
 * (see main.ts), so behind Render's proxy it is the visitor's real address
 * and can't be faked with a hand-written X-Forwarded-For header.
 */
export function clientInfo(req: any): ClientInfo {
  const ua = req?.headers?.['user-agent'];
  return {
    ip:
      typeof req?.ip === 'string' ? req.ip.replace(/^::ffff:/, '') : undefined,
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined,
  };
}
