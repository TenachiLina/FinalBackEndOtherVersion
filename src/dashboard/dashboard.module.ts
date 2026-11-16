import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CorrectionsModule } from '../corrections/corrections.module';
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { EmployeesModule } from '../employees/employees.module';
import { PayrollModule } from '../payroll/payroll.module';
import { Planning, PlanningSchema } from '../planning/planning.shema';
import { Shift, ShiftSchema } from '../shifts/shift.shema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    EmployeesModule,
    PayrollModule,
    CorrectionsModule,
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: Planning.name, schema: PlanningSchema },
      { name: Shift.name, schema: ShiftSchema },
      { name: Worktime.name, schema: WorktimeSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
