// src/attendance-device/attendance-device.controller.ts
import { Controller, Get } from '@nestjs/common';
import { AttendanceDeviceService } from './attendance-device.service';

@Controller('device')
export class AttendanceDeviceController {
  constructor(private readonly deviceService: AttendanceDeviceService) {}

  @Get('ping')
  async ping() {
    try {
      await this.deviceService.connect();
      await this.deviceService.disconnect();
      return { status: 'success', message: 'Device connected successfully' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  @Get('users')
  async getUsers() {
    try {
      const users = await this.deviceService.getDeviceUsers();
      return { status: 'success', count: users.length, data: users };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { status: 'error', message };
    }
  }

  @Get('status')
async getStatus() {
  return this.deviceService.getDeviceStatus();
}
  @Get('logs')
  async getLogs() {
    try {
      const logs = await this.deviceService.getAttendanceLogs();
      return { status: 'success', count: logs.length, data: logs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }
}