import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bonus, BonusSchema } from './bonus.schema';
import { BonusesController } from './bonuses.controller';
import { BonusesService } from './bonuses.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Bonus.name, schema: BonusSchema }])],
  controllers: [BonusesController],
  providers: [BonusesService],
})
export class BonusesModule {}
// Then add BonusesModule to the `imports` array of your AppModule.