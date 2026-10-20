import './source-maps';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as dns from 'dns';
import * as express from 'express';
import { tenantContextMiddleware } from './tenancy/tenant-context';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AppLogger } from './error-logs/app-logger';
import { reportError } from './error-logs/error-reporter';

dns.setServers(['1.1.1.1', '8.8.8.8']);

// Crashes outside any request are saved to the system error log too.
const processLogger = new Logger('Process');
process.on('unhandledRejection', (reason) => {
  processLogger.error(
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
  reportError(reason, {
    level: 'error',
    source: 'process',
    context: 'Unhandled promise rejection',
  });
});
process.on('uncaughtException', (err) => {
  processLogger.error(err.stack ?? err.message);
  reportError(err, {
    level: 'error',
    source: 'process',
    context: 'Uncaught exception',
  });
  // The process may be in a broken state: give the log a moment, then exit
  // so the host restarts it.
  setTimeout(() => process.exit(1), 2000);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Also saves every logger.error(...) to the system error log
    logger: new AppLogger(),
  });
  // Room for company logos sent as data URLs
  app.useBodyParser('json', { limit: '1mb' });
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
  // (comma-separated, no trailing slashes)
  const allowedOrigins = [
    'http://localhost:3000',
    ...(process.env.FRONTEND_URL?.split(',').map((u) => u.trim()) ?? []),
  ];

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
    credentials: true,
    // lets the frontend read export file names
    exposedHeaders: ['Content-Disposition'],
  });

  // Render provides the port via process.env.PORT; 0.0.0.0 lets it detect the open port
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on port ${port}`);
}
bootstrap();
