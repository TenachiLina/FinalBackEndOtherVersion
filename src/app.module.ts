// import { Module } from '@nestjs/common';
// import { MongooseModule } from '@nestjs/mongoose';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import { EmployeesModule } from './employees/employees.module';
// import { ShiftsModule } from './shifts/shifts.module';
// import { PlanningModule } from './planning/planning.module';
// import { WorktimeModule } from './worktime/worktime.module';
// import { TasksModule } from './tasks/tasks.module';

// @Module({
//   imports: [
//     ConfigModule.forRoot({ isGlobal: true }),
//     MongooseModule.forRootAsync({
//       inject: [ConfigService],
//       useFactory: (config: ConfigService) => ({
//         uri: config.get<string>('MONGODB_URI'),
//       }),
//     }),
//     EmployeesModule,
//     ShiftsModule,
//     PlanningModule,
//     WorktimeModule,
//     TasksModule,   
//   ],
// })
// export class AppModule {}


import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmployeesModule } from './employees/employees.module';
import { ShiftsModule } from './shifts/shifts.module';
import { PlanningModule } from './planning/planning.module';
import { WorktimeModule } from './worktime/worktime.module';
import { TasksModule } from './tasks/tasks.module';
import { AdvancesModule } from './advances/advances.module';
import { AttendanceDeviceModule } from './attendance-device/attendance-device.module'; // ← add
import { AttendanceModule } from './attendance/attendance.module';                     // ← add
import { BonusesModule } from './bonuses/bonus.module';
import { ZktecoModule } from './zkteco/zkteco.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { ErrorLogsModule } from './error-logs/error-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limit per IP address, for every route (login and refresh have
    // stricter limits of their own, the clocking machine is exempt).
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 600,
        },
      ],
      errorMessage: 'Too many requests. Please wait a moment and try again.',
    }),
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
    TasksModule,
    AdvancesModule,   
    AttendanceDeviceModule, // ← add
    AttendanceModule,       // ← add
    BonusesModule,
    ZktecoModule,
    AuthModule,
    AuditModule,
    ErrorLogsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}