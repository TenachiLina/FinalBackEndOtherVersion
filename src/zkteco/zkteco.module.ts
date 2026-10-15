import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ZktecoController } from './zkteco.controller';
import { ZktecoService } from './zkteco.service';
import {
  ZktecoAttendanceEvent,
  ZktecoAttendanceEventSchema,
} from './schemas/zkteco-attendance-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ZktecoAttendanceEvent.name,
        schema: ZktecoAttendanceEventSchema,
      },
    ]),
  ],
  controllers: [ZktecoController],
  providers: [ZktecoService],
  exports: [ZktecoService],
})
export class ZktecoModule {}
