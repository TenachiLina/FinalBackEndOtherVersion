import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { WorktimeService } from './worktime.service';
import { CurrentUser, RequireFeature, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';

@RequireFeature('clockin')
@Controller('worktime')
export class WorktimeController {
  constructor(
    private readonly worktimeService: WorktimeService,
    private readonly visibility: ManagerVisibilityService,
  ) { }

  @Post() create(@Body() body: any) { return this.worktimeService.create(body); }

  @Get()
  findAll(@Query() query: any) {
    return this.worktimeService.findAll(query);
  }

  @Roles('admin', 'manager')
  @RequireFeature('reporting')
  @Get('report')
  async findForReport(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.visibility.filterRecords(
      user,
      await this.worktimeService.findForReport(query),
    );
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.worktimeService.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.worktimeService.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.worktimeService.remove(id); }
}