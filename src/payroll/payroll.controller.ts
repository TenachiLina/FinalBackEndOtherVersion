import { Controller, Get, Query, Req } from '@nestjs/common';
import { CurrentUser, RequireFeature, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { PayrollService } from './payroll.service';

type CompanyRequest = { company?: { settings?: any } | null };

/**
 * Pay, calculated by the server (see payroll.calc.ts). The reporting pages
 * show these numbers as they are and calculate nothing themselves.
 */
@Roles('admin', 'manager')
@RequireFeature('reporting')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /**
   * GET /payroll/period?start=YYYY-MM-DD&end=YYYY-MM-DD[&empId=12]
   * One line per employee (hours, gross, deductions, net, weekly advance
   * offer) and the totals. Used by Monthly Payroll, Weekly Advances, the
   * employee's page and the Overview.
   */
  @Get('period')
  period(
    @CurrentUser() user: AuthUser,
    @Req() req: CompanyRequest,
    @Query('start') start: unknown,
    @Query('end') end: unknown,
    @Query('empId') empId: unknown,
  ) {
    return this.payroll.forPeriod(
      user,
      req.company ?? null,
      this.payroll.period(start, end),
      empId,
    );
  }

  /** GET /payroll/payslips?month=YYYY-MM: the amounts of each fiche de paie. */
  @Get('payslips')
  payslips(@CurrentUser() user: AuthUser, @Query('month') month: unknown) {
    return this.payroll.payslips(user, this.payroll.month(month));
  }
}
