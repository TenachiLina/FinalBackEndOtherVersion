import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesModule } from '../employees/employees.module';
import { Bonus, BonusSchema } from './bonus.schema';
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { BonusesController } from './bonuses.controller';
import { BonusesService } from './bonuses.service';

import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [
    EmployeesModule,
    PayrollModule,
    MongooseModule.forFeature([
      { name: Bonus.name, schema: BonusSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [BonusesController],
  providers: [BonusesService],
})
export class BonusesModule {}
// Then add BonusesModule to the `imports` array of your AppModule.