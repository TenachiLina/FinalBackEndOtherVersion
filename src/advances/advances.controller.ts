import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { CurrentUser, Roles, RequireFeature } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';

@Roles('admin', 'manager')
@RequireFeature('advances')
@Controller('advances')
export class AdvancesController {
  constructor(
    private readonly advancesService: AdvancesService,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { emp_id: number; amount: number; date: string; reason?: string },
  ) {
    await this.visibility.assertVisible(user, body?.emp_id);
    return this.advancesService.create(body);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.visibility.filterRecords(
      user,
      await this.advancesService.findAll(query),
    );
  }

  // NOTE: this route must come BEFORE any "@Get(':id')"-style route, or
  // NestJS will try to match "employee" itself as an :id parameter.
  @Get('employee/:empId')
  async findByEmployee(
    @CurrentUser() user: AuthUser,
    @Param('empId') empId: string,
    @Query() query: any,
  ) {
    await this.visibility.assertVisible(user, empId);
    return this.advancesService.findByEmployee(Number(empId), query);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const advance = await this.advancesService.findOne(id);
    if (advance) await this.visibility.assertVisible(user, advance.emp_id);
    return this.advancesService.remove(id);
  }
}