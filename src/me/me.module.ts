import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { User, UserSchema } from '../auth/user.schema';
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { Planning, PlanningSchema } from '../planning/planning.shema';
import { Shift, ShiftSchema } from '../shifts/shift.shema';
import { Task, TaskSchema } from '../tasks/task.schema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { Advance, AdvanceSchema } from '../advances/advance.schema';
import { Bonus, BonusSchema } from '../bonuses/bonus.schema';

// Read only: nothing here writes to these collections.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Planning.name, schema: PlanningSchema },
      { name: Shift.name, schema: ShiftSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Worktime.name, schema: WorktimeSchema },
      { name: Advance.name, schema: AdvanceSchema },
      { name: Bonus.name, schema: BonusSchema },
    ]),
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
