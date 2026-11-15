import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument } from './task.schema';
import { Planning, PlanningDocument } from '../planning/planning.shema';
import {
  archiveFilter,
  type ArchiveStatus,
} from '../employees/employees.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Planning.name) private planningModel: Model<PlanningDocument>,
  ) {}

  async create(data: Partial<Task>): Promise<TaskDocument> {
    return this.taskModel.create(data);
  }

  /** Every post by default (old planning needs the ones no longer used); ?status= narrows it. */
  async findAll(status: ArchiveStatus = 'all'): Promise<TaskDocument[]> {
    return this.taskModel
      .find(archiveFilter(status))
      .sort({ taskId: 1 })
      .exec();
  }

  async findOne(id: string): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id).exec();
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, data: Partial<Task>): Promise<TaskDocument> {
    // Archiving has its own routes
    const { isArchived: _a, ...fields } = (data ?? {}) as any;
    const task = await this.taskModel
      .findByIdAndUpdate(id, fields, { new: true, runValidators: true })
      .exec();
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /** Archives a post no longer used (it leaves the planning pickers), or brings it back. */
  async setArchived(id: string, isArchived: boolean): Promise<TaskDocument> {
    const task = Types.ObjectId.isValid(id)
      ? await this.taskModel
          .findByIdAndUpdate(id, { isArchived }, { new: true })
          .exec()
      : null;
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /**
   * Deletes a post added by mistake. One used in the planning is refused:
   * the planning would show an empty post. Archive it instead.
   */
  async remove(id: string): Promise<TaskDocument> {
    const task = Types.ObjectId.isValid(id)
      ? await this.taskModel.findById(id).exec()
      : null;
    if (!task) throw new NotFoundException('Task not found');
    if ((await this.planningModel.countDocuments({ taskId: task.taskId })) > 0) {
      throw new ConflictException(
        'This post is used in the planning: archive it instead of deleting it',
      );
    }
    await task.deleteOne();
    return task;
  }
}
