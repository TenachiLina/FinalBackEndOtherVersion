import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { Employee, EmployeeSchema } from './employee.shema';
import { ManagerVisibilityService } from './manager-visibility.service';
import { User, UserSchema } from '../auth/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService, ManagerVisibilityService],
  exports: [EmployeesService, ManagerVisibilityService],
})
export class EmployeesModule {}