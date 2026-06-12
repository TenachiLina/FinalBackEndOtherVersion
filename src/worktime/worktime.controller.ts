import { Controller, Get, Post, Put, Delete, Param, Body , Query} from '@nestjs/common';
import { WorktimeService } from './worktime.service';

@Controller('worktime')
export class WorktimeController {
  constructor(private readonly worktimeService: WorktimeService) {}

  @Post() create(@Body() body: any) { return this.worktimeService.create(body); }
@Get()
findAll(@Query() query: any) {
  return this.worktimeService.findAll(query); // pass filters to service
}  @Get(':id') findOne(@Param('id') id: string) { return this.worktimeService.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.worktimeService.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.worktimeService.remove(id); }
}