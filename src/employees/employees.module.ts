import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { Employee, EmployeeSchema } from './employee.shema';
import { ManagerVisibilityService } from './manager-visibility.service';
import { User, UserSchema } from '../auth/user.schema';
import { Planning, PlanningSchema } from '../planning/planning.shema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { Advance, AdvanceSchema } from '../advances/advance.schema';
import { Bonus, BonusSchema } from '../bonuses/bonus.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: User.name, schema: UserSchema },
      // To know whether an employee has history (then archived, never deleted)
      { name: Planning.name, schema: PlanningSchema },
      { name: Worktime.name, schema: WorktimeSchema },
      { name: Advance.name, schema: AdvanceSchema },
      { name: Bonus.name, schema: BonusSchema },
    ]),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService, ManagerVisibilityService],
  exports: [EmployeesService, ManagerVisibilityService],
})
export class EmployeesModule {}