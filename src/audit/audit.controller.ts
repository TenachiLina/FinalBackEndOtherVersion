import { Controller, Get, Query } from '@nestjs/common';
import { AllowNoCompany, CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { AuditService } from './audit.service';
import type { AuditQuery } from './audit.service';

/**
 * The activity log. A company admin sees their own company's log; a super
 * admin sees the company they are working in, or every company otherwise.
 */
@Roles('admin', 'superadmin')
@AllowNoCompany()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findAll(@CurrentUser() actor: AuthUser, @Query() query: AuditQuery) {
    return this.auditService.find(actor.companyId, query);
  }

  @Get('users')
  users(@CurrentUser() actor: AuthUser) {
    return this.auditService.actors(actor.companyId);
  }
}
