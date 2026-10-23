import './source-maps';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as dns from 'dns';
import { AppLogger } from './error-logs/app-logger';
import { reportError } from './error-logs/error-reporter';
import { httpsOptions } from './common/security';
import { configureApp } from './app.setup';

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
  const https = httpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Also saves every logger.error(...) to the system error log
    logger: new AppLogger(),
    // Serve HTTPS directly when a certificate is configured (see .env.example)
    ...(https && { httpsOptions: https }),
  });

  configureApp(app);

  // Render provides the port via process.env.PORT; 0.0.0.0 lets it detect the open port
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(
    `Backend running on ${https ? 'https' : 'http'}://localhost:${port}`,
  );
}
bootstrap();
