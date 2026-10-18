import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { BonusesService } from './bonuses.service';
import { Roles, RequireFeature } from '../auth/auth.decorators';

@Roles('admin')
@RequireFeature('bonuses')
@Controller('bonuses')
export class BonusesController {
  constructor(private readonly bonusesService: BonusesService) {}

  @Post()
  create(@Body() body: { emp_id: number; amount: number; date: string; reason: string }) {
    return this.bonusesService.create(body);
  }

  @Get()
  findAll(@Query() query: { start?: string; end?: string; empId?: string }) {
    return this.bonusesService.findAll(query);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bonusesService.remove(id);
  }
}