// src/attendance/attendance.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceDeviceModule } from '../attendance-device/attendance-device.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller'; // ← add
import { RawAttendanceLog, RawAttendanceLogSchema } from './raw-attendance-log.schema';

@Module({
  imports: [
    AttendanceDeviceModule,
    MongooseModule.forFeature([
      { name: RawAttendanceLog.name, schema: RawAttendanceLogSchema },
    ]),
  ],
  controllers: [AttendanceController], 
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}