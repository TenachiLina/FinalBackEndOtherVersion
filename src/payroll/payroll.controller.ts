import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CurrentUser, RequireFeature, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { MonthClosingService } from './month-closing.service';
import { PayrollService } from './payroll.service';

type CompanyRequest = { company?: { settings?: any } | null };

/**
 * Pay, calculated by the server (see payroll.calc.ts). The reporting pages
 * show these numbers as they are and calculate nothing themselves.
 * A closed month answers the payroll frozen when it closed.
 */
@Roles('admin', 'manager')
@RequireFeature('reporting')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly closing: MonthClosingService,
  ) {}

  /**
   * GET /payroll/period?start=YYYY-MM-DD&end=YYYY-MM-DD[&empId=12]
   * One line per employee (hours, gross, deductions, net, weekly advance
   * offer) and the totals. Used by Monthly Payroll, Weekly Advances, the
   * employee's page and the Overview.
   */
  @Get('period')
  async period(
    @CurrentUser() user: AuthUser,
    @Req() req: CompanyRequest,
    @Query('start') start: unknown,
    @Query('end') end: unknown,
    @Query('empId') empId: unknown,
  ) {
    const period = this.payroll.period(start, end);
    const frozen = await this.closing.frozenPeriod(user, period, empId);
    if (frozen) return frozen;
    return {
      ...(await this.payroll.forPeriod(user, req.company ?? null, period, empId)),
      closed: false,
    };
  }

  /** GET /payroll/payslips?month=YYYY-MM: the amounts of each fiche de paie. */
  @Get('payslips')
  async payslips(@CurrentUser() user: AuthUser, @Query('month') month: unknown) {
    const range = this.payroll.month(month);
    const frozen = await this.closing.frozenPayslips(user, range.month);
    if (frozen) return frozen;
    return { ...(await this.payroll.payslips(user, range)), closed: false };
  }

  /** GET /payroll/closings?year=2026: which months of the year are closed. */
  @Get('closings')
  closings(@Query('year') year: unknown) {
    return this.closing.year(year);
  }

  /** GET /payroll/closings/2026-10: whether that month is closed, by whom, or when it will. */
  @Get('closings/:month')
  closingOf(@Param('month') month: string) {
    return this.closing.status(month);
  }

  /** Closes a month that is over: its hours and pay can no longer change. */
  @Roles('admin')
  @Post('closings/:month/close')
  close(@CurrentUser() user: AuthUser, @Param('month') month: string) {
    return this.closing.close(user, month);
  }

  /** Reopens a closed month so a mistake can be corrected. */
  @Roles('admin')
  @Post('closings/:month/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('month') month: string) {
    return this.closing.reopen(user, month);
  }
}
