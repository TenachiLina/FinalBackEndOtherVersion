import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesModule } from '../employees/employees.module';
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { Planning, PlanningSchema } from '../planning/planning.shema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { Advance, AdvanceSchema } from '../advances/advance.schema';
import { Bonus, BonusSchema } from '../bonuses/bonus.schema';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    EmployeesModule,
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: Planning.name, schema: PlanningSchema },
      { name: Worktime.name, schema: WorktimeSchema },
      { name: Advance.name, schema: AdvanceSchema },
      { name: Bonus.name, schema: BonusSchema },
    ]),
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
