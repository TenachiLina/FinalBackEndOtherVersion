import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import {
  AllowNoCompany,
  CurrentUser,
  KioskAllowed,
  Roles,
} from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { SkipAudit } from '../audit/audit-actions';
import { ErrorLogService } from './error-log.service';
import type { ErrorLogQuery } from './error-log.service';
import { reportError } from './error-reporter';

interface ClientErrorInput {
  name?: string;
  message?: string;
  stack?: string;
  pageUrl?: string;
  digest?: string;
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v ? v.slice(0, max) : undefined;

/**
 * System errors. Only the super admin reads them (they show code details);
 * inside a company they see that company's errors, otherwise all of them.
 */
@Roles('superadmin')
@AllowNoCompany()
@SkipAudit()
@Controller('error-logs')
export class ErrorLogsController {
  constructor(private readonly errorLogService: ErrorLogService) {}

  @Get()
  findAll(@CurrentUser() actor: AuthUser, @Query() query: ErrorLogQuery) {
    return this.errorLogService.find(actor.companyId, query);
  }

  @Get('summary')
  summary(@CurrentUser() actor: AuthUser) {
    return this.errorLogService.summary(actor.companyId);
  }

  /** The app reports pages that crashed in someone's browser. */
  @Roles('superadmin', 'admin', 'manager', 'employee')
  @KioskAllowed()
  @Post('client')
  @HttpCode(204)
  client(
    @CurrentUser() actor: AuthUser,
    @Body() body: ClientErrorInput,
    @Req() req: { headers: Record<string, string | undefined> },
  ) {
    const stack = text(body?.stack, 6000);
    reportError(null, {
      level: 'error',
      source: 'frontend',
      name: text(body?.name, 100) ?? 'Error',
      message: text(body?.message, 2000) ?? 'Unknown error',
      stack,
      code: text(body?.digest, 100),
      pageUrl: text(body?.pageUrl, 500),
      userAgent: text(req.headers['user-agent'], 300),
      companyId: actor.companyId,
      userId: actor.id,
      userName: actor.name,
      userEmail: actor.email,
      userRole: actor.role,
    });
  }
}
