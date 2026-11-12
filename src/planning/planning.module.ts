import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlanningService } from './planning.service';
import { PlanningController } from './planning.controller';
import { Planning, PlanningSchema } from './planning.shema';
import { Worktime, WorktimeSchema } from '../worktime/worktime.shema';
import {
  RawAttendanceLog,
  RawAttendanceLogSchema,
} from '../attendance/raw-attendance-log.schema';
import {
  ZktecoAttendanceEvent,
  ZktecoAttendanceEventSchema,
} from '../zkteco/schemas/zkteco-attendance-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Planning.name, schema: PlanningSchema },
      // Read only: deleting a month checks it has no clock-ins or clock-outs
      { name: Worktime.name, schema: WorktimeSchema },
      { name: RawAttendanceLog.name, schema: RawAttendanceLogSchema },
      { name: ZktecoAttendanceEvent.name, schema: ZktecoAttendanceEventSchema },
    ]),
  ],
  controllers: [PlanningController],
  providers: [PlanningService],
  exports: [PlanningService],
})
export class PlanningModule {}
