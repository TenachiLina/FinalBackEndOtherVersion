import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { AdvancesService } from './advances.service';

@Controller('advances')
export class AdvancesController {
  constructor(private readonly advancesService: AdvancesService) {}

  @Post()
  create(@Body() body: { emp_id: number; amount: number; date: string; reason?: string }) {
    return this.advancesService.create(body);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.advancesService.findAll(query);
  }

  // NOTE: this route must come BEFORE any "@Get(':id')"-style route, or
  // NestJS will try to match "employee" itself as an :id parameter.
  @Get('employee/:empId')
  findByEmployee(@Param('empId') empId: string, @Query() query: any) {
    return this.advancesService.findByEmployee(Number(empId), query);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.advancesService.remove(id);
  }
}