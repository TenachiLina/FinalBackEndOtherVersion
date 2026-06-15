import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { PlanningService } from './planning.service';

@Controller('planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Post('bulk')
  async bulkSave(@Body() body: { entries: any[]; planDate: string }) {
    return this.planningService.bulkSave(body.entries, body.planDate);
  }

  @Post()
  create(@Body() body: any) {
    return this.planningService.create(body);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.planningService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.planningService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.planningService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.planningService.remove(id);
  }
}