import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';

import {
  RawAttendanceLog,
  RawAttendanceLogSchema,
} from './raw-attendance-log.schema';

import {
  Employee,
  EmployeeSchema,
} from '../employees/employee.shema';

import { AttendanceDeviceModule } from '../attendance-device/attendance-device.module';

@Module({
  imports: [
    AttendanceDeviceModule,

    MongooseModule.forFeature([
      {
        name: RawAttendanceLog.name,
        schema: RawAttendanceLogSchema,
      },
      {
        name: Employee.name,
        schema: EmployeeSchema,
      },
    ]),
  ],

  controllers: [
    AttendanceController,
  ],

  providers: [
    AttendanceService,
  ],

  exports: [
    AttendanceService,
  ],
})
export class AttendanceModule {}