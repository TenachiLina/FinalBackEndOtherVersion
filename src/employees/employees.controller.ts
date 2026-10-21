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
import { Roles } from '../auth/auth.decorators';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Roles('admin', 'manager') @Post() create(@Body() body: any) {
    return this.employeesService.create(body);
  }
  @Get() findAll() {
    return this.employeesService.findAll();
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.employeesService.findOne(id);
  }
  @Roles('admin', 'manager') @Put(':id') update(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.employeesService.update(id, body);
  }
  @Roles('admin', 'manager') @Delete(':id') remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }
}
