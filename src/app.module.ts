import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmployeesModule } from './employees/employees.module';
import { ShiftsModule } from './shifts/shifts.module';
import { PlanningModule } from './planning/planning.module';
import { WorktimeModule } from './worktime/worktime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    EmployeesModule,
    ShiftsModule,
    PlanningModule,
    WorktimeModule,
  ],
})
export class AppModule {}