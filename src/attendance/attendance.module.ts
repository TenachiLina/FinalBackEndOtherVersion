import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { KioskController } from './kiosk.controller';

import {
  RawAttendanceLog,
  RawAttendanceLogSchema,
} from './raw-attendance-log.schema';

import {
  Employee,
  EmployeeSchema,
} from '../employees/employee.shema';

import { AttendanceDeviceModule } from '../attendance-device/attendance-device.module';
import { WorktimeModule } from '../worktime/worktime.module';
import { PlanningModule } from '../planning/planning.module';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [
    AttendanceDeviceModule,
    WorktimeModule,
    PlanningModule,
    CompaniesModule,

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
    KioskController,
  ],

  providers: [
    AttendanceService,
  ],

  exports: [
    AttendanceService,
  ],
})
export class AttendanceModule {}