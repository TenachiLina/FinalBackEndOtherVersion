import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import helmet from 'helmet';
import { tenantContextMiddleware } from './tenancy/tenant-context';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import {
  isProduction,
  noStore,
  rejectInjection,
  requireHttps,
  trustProxySetting,
} from './common/security';

/** Middleware, security headers and CORS. Shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication) {
  // Behind Render's proxy: real visitor IP in req.ip, and HTTPS detected
  app.set('trust proxy', trustProxySetting());
  // Plain HTTP is redirected or refused (except the clocking machine)
  app.use(requireHttps());
  // Security headers: HTTPS only for a year (HSTS), no framing, no MIME
  // sniffing, no referrer; this API serves no pages, so nothing may load.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      strictTransportSecurity: {
        maxAge: 365 * 24 * 60 * 60,
        includeSubDomains: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(noStore());
  // Room for company logos sent as data URLs
  app.useBodyParser('json', { limit: '1mb' });
  // Flat form bodies only: nested ones could carry query operators
  app.useBodyParser('urlencoded', { extended: false, limit: '1mb' });
  // No MongoDB operators ($ne, $where…) or prototype keys in request bodies
  app.use(rejectInjection());
  // Clear error messages instead of "Internal server error" (see common/)
  app.useGlobalFilters(new AllExceptionsFilter());

  // Gives every request its own "current company" slot (see tenancy/).
  app.use(tenantContextMiddleware);

  app.use(
    express.text({
      type: ['text/plain', 'application/octet-stream'],
      limit: '1mb',
    }),
  );
  // Allowed frontend origins: local dev + any URLs from the FRONTEND_URL env var
  // (comma-separated, no trailing slashes). In production, HTTPS ones only.
  const allowedOrigins = [
    'https://localhost:3000',
    ...(isProduction() ? [] : ['http://localhost:3000']),
    ...(process.env.FRONTEND_URL?.split(',').map((u) => u.trim()) ?? []),
  ].filter((u) => u && (!isProduction() || u.startsWith('https://')));

  // matches the production URL and every per-deployment/branch URL of this project
  const vercelPattern =
    /^https:\/\/final-front-end-other-version(-[a-z0-9-]+)?\.vercel\.app$/;

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        vercelPattern.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Accept-Language',
      'X-Company-Id',
    ],
    credentials: true,
    // lets the frontend read export file names
    exposedHeaders: ['Content-Disposition'],
  });
}
