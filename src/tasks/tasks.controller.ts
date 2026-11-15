import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { RequireFeature } from '../auth/auth.decorators';
import { archiveStatus } from '../employees/employees.service';
import { TASK_FIELDS } from '../common/body-rules';
import { validateBody } from '../common/validate';

@RequireFeature('planning')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post() create(@Body() body: unknown) {
    return this.tasksService.create(validateBody(body, TASK_FIELDS));
  }

  /** GET /tasks[?status=active|archived|all]: every post when status is missing. */
  @Get() findAll(@Query('status') status?: string) {
    return this.tasksService.findAll(archiveStatus(status));
  }

  @Get(':id') findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Put(':id') update(@Param('id') id: string, @Body() body: unknown) {
    return this.tasksService.update(
      id,
      validateBody(body, TASK_FIELDS, 'partial'),
    );
  }

  @Patch(':id/archive') archive(@Param('id') id: string) {
    return this.tasksService.setArchived(id, true);
  }

  @Patch(':id/restore') restore(@Param('id') id: string) {
    return this.tasksService.setArchived(id, false);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
  }
}
