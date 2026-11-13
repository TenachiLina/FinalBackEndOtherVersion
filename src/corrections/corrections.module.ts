import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesModule } from '../employees/employees.module';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import { Advance, AdvanceSchema } from '../advances/advance.schema';
import { Bonus, BonusSchema } from '../bonuses/bonus.schema';
import { Correction, CorrectionSchema } from './correction.schema';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';

@Module({
  imports: [
    EmployeesModule, // ManagerVisibilityService
    MongooseModule.forFeature([
      { name: Correction.name, schema: CorrectionSchema },
      // Read only: to check a reported record is the employee's own
      { name: Worktime.name, schema: WorktimeSchema },
      { name: Advance.name, schema: AdvanceSchema },
      { name: Bonus.name, schema: BonusSchema },
    ]),
  ],
  controllers: [CorrectionsController],
  providers: [CorrectionsService],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}
