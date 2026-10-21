import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { BonusesService } from './bonuses.service';
import { CurrentUser, Roles, RequireFeature } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';

@Roles('admin', 'manager')
@RequireFeature('bonuses')
@Controller('bonuses')
export class BonusesController {
  constructor(
    private readonly bonusesService: BonusesService,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { emp_id: number; amount: number; date: string; reason: string },
  ) {
    await this.visibility.assertVisible(user, body?.emp_id);
    return this.bonusesService.create(body);
  }

  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { start?: string; end?: string; empId?: string },
  ) {
    return this.visibility.filterRecords(
      user,
      await this.bonusesService.findAll(query),
    );
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const bonus = await this.bonusesService.findOne(id);
    if (bonus) await this.visibility.assertVisible(user, bonus.emp_id);
    return this.bonusesService.remove(id);
  }
}