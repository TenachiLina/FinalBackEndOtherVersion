import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from './task.schema';

@Injectable()
export class TasksService {
  constructor(@InjectModel(Task.name) private taskModel: Model<TaskDocument>) {}

  async create(data: Partial<Task>): Promise<TaskDocument> {
    return this.taskModel.create(data);
  }

  async findAll(): Promise<TaskDocument[]> {
    return this.taskModel.find().sort({ taskId: 1 }).exec();
  }

  async findOne(id: string): Promise<TaskDocument | null> {
    return this.taskModel.findById(id).exec();
  }

  async update(id: string, data: Partial<Task>): Promise<TaskDocument | null> {
    return this.taskModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<TaskDocument | null> {
    return this.taskModel.findByIdAndDelete(id).exec();
  }
}
