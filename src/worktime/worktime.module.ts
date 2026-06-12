import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorktimeService } from './worktime.service';
import { WorktimeController } from './worktime.controller';
import { Worktime, WorktimeSchema } from './worktime.shema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Worktime.name, schema: WorktimeSchema }])],
  controllers: [WorktimeController],
  providers: [WorktimeService],
  exports: [WorktimeService],
})
export class WorktimeModule {}