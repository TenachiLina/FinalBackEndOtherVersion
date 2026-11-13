import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  RequireFeature,
  Roles,
  StaffAllowed,
} from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { MeService } from './me.service';
import { CorrectionsService } from '../corrections/corrections.service';
import type { ReportInput } from '../corrections/corrections.service';

interface MonthQuery {
  year?: string;
  month?: string;
}

/**
 * The logged-in employee's own information, for the employee mobile app.
 * Only for personal employee (staff) accounts: every answer is about the
 * employee linked to the account, whatever the request says. Read only, but
 * for one thing: reporting a mistake to the managers (/me/corrections).
 * Clocking in and out is not here on purpose: it stays on the machines.
 */
@Roles('staff')
@StaffAllowed()
@SkipThrottle()
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly corrections: CorrectionsService,
  ) {}

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

  /** The employee's reports of mistakes, with the managers' answers. */
  @Get('corrections')
  async myCorrections(@CurrentUser() user: AuthUser) {
    return this.corrections.listMine(await this.me.employeeOf(user));
  }

  /** Reports a mistake in their worked time, an advance or a bonus. */
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('corrections')
  async reportCorrection(
    @CurrentUser() user: AuthUser,
    @Req() req: { company?: { features?: string[] } | null },
    @Body() body: ReportInput,
  ) {
    return this.corrections.report(
      user,
      await this.me.employeeOf(user),
      req.company?.features ?? [],
      body ?? {},
    );
  }
}
