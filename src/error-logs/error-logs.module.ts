import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ErrorLog, ErrorLogSchema } from './error-log.schema';
import { ErrorLogService } from './error-log.service';
import { ErrorLogsController } from './error-logs.controller';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [
    CompaniesModule,
    MongooseModule.forFeature([{ name: ErrorLog.name, schema: ErrorLogSchema }]),
  ],
  controllers: [ErrorLogsController],
  providers: [ErrorLogService],
})
export class ErrorLogsModule {}
