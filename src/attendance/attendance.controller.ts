import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
  ) {}

  @Post('sync')
  async sync() {
    try {
      await this.attendanceService.syncLogs();

      return {
        status: 'success',
        message: 'Sync completed',
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      return {
        status: 'error',
        message,
      };
    }
  }

  /**
   * Manually create an attendance punch.
   *
   * POST /attendance/device-logs
   */
  @Post('device-logs')
  async createDeviceLog(
    @Body()
    body: {
      deviceUserId: string;
      timestamp: string;
      processed?: boolean;
    },
  ) {
    try {
      const log =
        await this.attendanceService.createDeviceLog(body);

      return {
        status: 'success',
        message: 'Punch created successfully',
        data: log,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      return {
        status: 'error',
        message,
      };
    }
  }

  /**
   * Get attendance logs.
   *
   * GET /attendance/device-logs?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  @Get('device-logs')
  async getDeviceLogs(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    try {
      const logs =
        await this.attendanceService.getLogsByDateRange(
          from,
          to,
        );

      return {
        status: 'success',
        count: logs.length,
        data: logs,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      return {
        status: 'error',
        message,
      };
    }
  }
}