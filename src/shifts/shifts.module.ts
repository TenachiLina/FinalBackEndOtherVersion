import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { Shift, ShiftSchema } from './shift.shema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Shift.name, schema: ShiftSchema }])],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}