import { Controller, Get, Post, Query } from '@nestjs/common';
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
      const message = err instanceof Error ? err.message : String(err);

      return {
        status: 'error',
        message,
      };
    }
  }

  @Get('device-logs')
  async getDeviceLogs(@Query('date') date?: string) {
    return this.attendanceService.getDeviceLogs(date);
  }
}