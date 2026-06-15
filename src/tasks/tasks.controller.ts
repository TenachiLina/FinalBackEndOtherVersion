import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()   create(@Body() body: any)                        { return this.tasksService.create(body); }
  @Get()    findAll()                                        { return this.tasksService.findAll(); }
  @Get(':id') findOne(@Param('id') id: string)              { return this.tasksService.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.tasksService.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string)            { return this.tasksService.remove(id); }
}
