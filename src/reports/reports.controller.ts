import { Controller, Get, Query } from '@nestjs/common';
import { RequireFeature, Roles } from '../auth/auth.decorators';
import { ReportsService } from './reports.service';

@RequireFeature('reporting')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /reports/labor-summary?start=YYYY-MM-DD&end=YYYY-MM-DD
   * Hours per station for an outside reporting system; see labor-summary.ts.
   * Admins only: the totals cover every employee.
   */
  @Roles('admin')
  @Get('labor-summary')
  laborSummary(@Query('start') start: unknown, @Query('end') end: unknown) {
    return this.reportsService.laborSummary(
      this.reportsService.period(start, end),
    );
  }
}
