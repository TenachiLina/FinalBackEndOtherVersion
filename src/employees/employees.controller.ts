import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';

// Managers need the employee list for planning and clock-in, but not salaries.
function hideSalary(user: AuthUser, employee: any) {
  if (!employee || user.role !== 'manager') return employee;
  const { baseSalary, ...rest } = employee.toObject
    ? employee.toObject()
    : employee;
  return rest;
}

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Roles('admin') @Post() create(@Body() body: any) {
    return this.employeesService.create(body);
  }
  @Get() async findAll(@CurrentUser() user: AuthUser) {
    return (await this.employeesService.findAll()).map((e) =>
      hideSalary(user, e),
    );
  }
  @Get(':id') async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return hideSalary(user, await this.employeesService.findOne(id));
  }
  @Roles('admin') @Put(':id') update(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.employeesService.update(id, body);
  }
  @Roles('admin') @Delete(':id') remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }
}
