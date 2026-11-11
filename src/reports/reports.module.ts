import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CompaniesModule } from '../companies/companies.module';
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { Task, TaskSchema } from '../tasks/task.schema';
import { Shift, ShiftSchema } from '../shifts/shift.shema';
import { Planning, PlanningSchema } from '../planning/planning.shema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { Bonus, BonusSchema } from '../bonuses/bonus.schema';
import { Advance, AdvanceSchema } from '../advances/advance.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    CompaniesModule,
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Shift.name, schema: ShiftSchema },
      { name: Planning.name, schema: PlanningSchema },
      { name: Worktime.name, schema: WorktimeSchema },
      { name: Bonus.name, schema: BonusSchema },
      { name: Advance.name, schema: AdvanceSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
