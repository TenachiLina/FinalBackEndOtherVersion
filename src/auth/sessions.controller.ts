import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import type { SessionQuery } from './sessions.service';
import { AllowNoCompany, CurrentUser, Roles } from './auth.decorators';
import type { AuthUser } from './auth.decorators';

/**
 * Super admin only (IP addresses and devices are personal data): login
 * sessions of every company, or of the company they are working inside.
 * Who is signed in, from which device and IP, with
 * which token, and until when.
 */
@Roles('superadmin')
@AllowNoCompany()
@Controller('login-sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  findAll(@CurrentUser() actor: AuthUser, @Query() query: SessionQuery) {
    return this.sessions.listForCompany(actor.companyId, query);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.sessions.revokeInCompany(actor.companyId, id, actor.id);
  }
}
