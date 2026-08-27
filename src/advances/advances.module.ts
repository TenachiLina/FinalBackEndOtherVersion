import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdvancesService } from './advances.service';
import { AdvancesController } from './advances.controller';
import { Advance, AdvanceSchema } from './advance.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Advance.name, schema: AdvanceSchema }])],
  controllers: [AdvancesController],
  providers: [AdvancesService],
  exports: [AdvancesService],
})
export class AdvancesModule {}