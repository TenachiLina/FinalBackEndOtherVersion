import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesModule } from '../employees/employees.module';
import { WorktimeService } from './worktime.service';
import { WorktimeController } from './worktime.controller';
import { Worktime, WorktimeSchema } from './worktime.shema';

import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [EmployeesModule, PayrollModule, MongooseModule.forFeature([{ name: Worktime.name, schema: WorktimeSchema }])],
  controllers: [WorktimeController],
  providers: [WorktimeService],
  exports: [WorktimeService],
})
export class WorktimeModule {}