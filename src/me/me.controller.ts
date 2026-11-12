import { Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  CurrentUser,
  RequireFeature,
  Roles,
  StaffAllowed,
} from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { MeService } from './me.service';

interface MonthQuery {
  year?: string;
  month?: string;
}

/**
 * The logged-in employee's own information, for the employee mobile app.
 * Read only, and only for personal employee (staff) accounts: every answer is
 * about the employee linked to the account, whatever the request says.
 * Clocking in and out is not here on purpose: it stays on the machines.
 */
@Roles('staff')
@StaffAllowed()
@SkipThrottle()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.me.profile(user);
  }

  @RequireFeature('planning')
  @Get('planning')
  planning(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.me.planning(user, q.year, q.month);
  }

  @RequireFeature('clockin')
  @Get('worktime')
  worktime(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.me.worktime(user, q.year, q.month);
  }

  @RequireFeature('advances')
  @Get('advances')
  advances(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.me.advances(user, q.year, q.month);
  }

  @RequireFeature('bonuses')
  @Get('bonuses')
  bonuses(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.me.bonuses(user, q.year, q.month);
  }
}
