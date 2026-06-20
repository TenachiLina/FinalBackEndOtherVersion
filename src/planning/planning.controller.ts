import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { PlanningService } from './planning.service';

@Controller('planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Post()
  create(@Body() body: any) {
    return this.planningService.create(body);
  }

  /** Save all planning entries for a date (replaces existing ones for that day) */
  // @Post('bulk')
  // async bulkSave(@Body() body: { entries: any[]; planDate: string }) {
  //   return this.planningService.bulkSave(body.entries, body.planDate);
  // }
  @Post('bulk')
  async bulkSave(
    @Body()
    body: {
      entries: any[];
      planDate: string;
      replaceExisting?: boolean;
    },
  ) {
    return this.planningService.bulkSave(
      body.entries,
      body.planDate,
      body.replaceExisting ?? false,
    );
  }

  @Get()
  async findAll(@Query() query: any) {
    try {
      return await this.planningService.findAll(query);
    } catch (err) {
      console.error('💀💀💀 findAll error:', err);
      throw err;
    }
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