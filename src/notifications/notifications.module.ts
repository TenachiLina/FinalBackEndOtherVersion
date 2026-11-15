import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { EmployeesModule } from '../employees/employees.module';
import { Planning, PlanningSchema } from '../planning/planning.shema';
import { Shift, ShiftSchema } from '../shifts/shift.shema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { PayrollModule } from '../payroll/payroll.module';
import {
  NotificationRead,
  NotificationReadSchema,
} from './notification-read.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    EmployeesModule,
    PayrollModule,
    MongooseModule.forFeature([
      { name: NotificationRead.name, schema: NotificationReadSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Planning.name, schema: PlanningSchema },
      { name: Shift.name, schema: ShiftSchema },
      { name: Worktime.name, schema: WorktimeSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
