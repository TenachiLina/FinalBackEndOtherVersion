import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Connection } from 'mongoose';
import { AllowNoCompany, Public } from '../auth/auth.decorators';
import { SkipAudit } from '../audit/audit-actions';

const STARTED = Date.now();
// The version deployed, when the hosting platform gives it (Render does)
const VERSION =
  process.env.RENDER_GIT_COMMIT?.slice(0, 7) ??
  process.env.npm_package_version ??
  null;

/**
 * For uptime checks and the hosting platform: is the server up, and can it
 * reach the database? Answers 503 when the database is unreachable, so the
 * platform can restart or alert. Says nothing about any company.
 */
@Public()
@AllowNoCompany()
@SkipThrottle()
@SkipAudit()
@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** GET /health → { status, database, uptime, version } */
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    let database: 'up' | 'down' = 'down';
    try {
      // readyState 1 = connected; a ping proves it still answers
      if (this.connection.readyState === 1) {
        await this.connection.db!.admin().ping();
        database = 'up';
      }
    } catch {
      database = 'down';
    }
    if (database === 'down') res.status(503);
    return {
      status: database === 'up' ? 'ok' : 'unavailable',
      database,
      uptime: Math.round((Date.now() - STARTED) / 1000),
      version: VERSION,
    };
  }

  /** GET / → the same check, for platforms that only look at the root. */
  @Get()
  @HttpCode(200)
  root(@Res({ passthrough: true }) res: Response) {
    return this.health(res);
  }
}
