import { Controller, Get, Req } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { DashboardService } from './dashboard.service';

/** The figures of the Home page: today at a glance, for admins and managers. */
@Roles('admin', 'manager')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** GET /dashboard → { day, time, attendance, pending, month, subscription } */
  @Get()
  today(@CurrentUser() user: AuthUser, @Req() req: { company: any }) {
    // The guard refuses this route without a company
    return this.dashboard.today(user, req.company);
  }
}
