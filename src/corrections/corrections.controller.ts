import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { CorrectionsService } from './corrections.service';

/**
 * Mistakes employees reported from the mobile app (worked time, advances,
 * bonuses). Managers and admins read them here, fix the record on its usual
 * page, then mark the report corrected or rejected. Employees send and read
 * their own reports through /me/corrections.
 */
@Roles('admin', 'manager')
@Controller('corrections')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.corrections.list(user, status);
  }

  @Get('count')
  count(@CurrentUser() user: AuthUser) {
    return this.corrections.pendingCount(user);
  }

  @Patch(':id')
  handle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status?: string; reply?: string },
  ) {
    return this.corrections.handle(user, id, body ?? {});
  }
}
