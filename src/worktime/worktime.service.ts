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

  if (query.emp_id) {
    const n = Number(query.emp_id);
    if (!isNaN(n)) filter.emp_id = n;
  }
  if (query.shift_id) {
    const n = Number(query.shift_id);
    if (!isNaN(n)) filter.shift_id = n;  // only add if it's actually a number
  }
  if (query.work_date) {
    const start = new Date(query.work_date); start.setHours(0, 0, 0, 0);
    const end   = new Date(query.work_date); end.setHours(23, 59, 59, 999);
    filter.work_date = { $gte: start, $lte: end };
  }

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