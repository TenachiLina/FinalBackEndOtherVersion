import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as dns from 'dns';
import * as express from 'express';
import { tenantContextMiddleware } from './tenancy/tenant-context';

dns.setServers(['1.1.1.1', '8.8.8.8']);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Room for company logos sent as data URLs
  app.useBodyParser('json', { limit: '1mb' });

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
