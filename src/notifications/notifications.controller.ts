import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  AllowWhenExpired,
  CurrentUser,
  Roles,
} from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { SkipAudit } from '../audit/audit-actions';
import { NotificationsService } from './notifications.service';

/**
 * The bell in the header: what is worth telling an admin or a manager right
 * now (late arrivals, people who haven't clocked in, absences, a month about
 * to close, the subscription about to end, a silent clocking machine).
 */
@Roles('admin', 'manager')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** GET /notifications → { items: [...], unread } */
  @Get()
  list(@CurrentUser() user: AuthUser, @Req() req: { company: any }) {
    // The guard refuses these routes without a company
    return this.notifications.list(user, req.company);
  }

  /** POST /notifications/read { keys: [...] }: marks those alerts as read by this user. */
  @SkipAudit()
  @AllowWhenExpired()
  @HttpCode(204)
  @Post('read')
  async read(@CurrentUser() user: AuthUser, @Body() body: { keys?: unknown }) {
    await this.notifications.markRead(user, body?.keys);
  }
}
