// src/attendance-device/attendance-device.module.ts
import { Module } from '@nestjs/common';
import { AttendanceDeviceService } from './attendance-device.service';
import { AttendanceDeviceController } from './attendance-device.controller';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [CompaniesModule],
  controllers: [AttendanceDeviceController],
  providers: [AttendanceDeviceService],
  exports: [AttendanceDeviceService],
})
export class AttendanceDeviceModule {}