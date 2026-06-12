import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Worktime, WorktimeDocument } from './worktime.shema';

@Injectable()
export class WorktimeService {
  constructor(@InjectModel(Worktime.name) private worktimeModel: Model<WorktimeDocument>) {}

  async create(data: Partial<Worktime>): Promise<WorktimeDocument> {
    return this.worktimeModel.create(data);
  }

 async findAll(query: Record<string, any> = {}): Promise<WorktimeDocument[]> {
  const filter: Record<string, any> = {};

  if (query.emp_id)    filter.emp_id   = Number(query.emp_id);
  if (query.shift_id)  filter.shift_id = Number(query.shift_id);
  if (query.work_date) filter.work_date = new Date(query.work_date);

  return this.worktimeModel.find(filter).exec();
}
  async findOne(id: string): Promise<WorktimeDocument | null > {
    return this.worktimeModel.findById(id).populate('empId').populate('shiftId').exec();
  }

  async update(id: string, data: Partial<Worktime>): Promise<WorktimeDocument | null> {
    return this.worktimeModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<WorktimeDocument | null> {
    return this.worktimeModel.findByIdAndDelete(id).exec();
  }
}