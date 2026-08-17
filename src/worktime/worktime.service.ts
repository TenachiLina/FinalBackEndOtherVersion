import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Worktime, WorktimeDocument } from './worktime.shema';
import { Injectable, NotFoundException } from '@nestjs/common';

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

      if (!isNaN(n)) {
        filter.emp_id = n;
      }
    }

    if (query.shift_id) {
      filter.shift_id = query.shift_id;
    }

    if (query.work_date) {
      const start = new Date(query.work_date);
      start.setHours(0, 0, 0, 0);

      const end = new Date(query.work_date);
      end.setHours(23, 59, 59, 999);

      filter.work_date = {
        $gte: start,
        $lte: end,
      };
    }

    return this.worktimeModel.find(filter).exec();
  }  

  async findOne(id: string): Promise<WorktimeDocument | null > {
    return this.worktimeModel.findById(id).populate('empId').populate('shiftId').exec();
  }

  async update(
      id: string,
      data: Partial<Worktime>
  ): Promise<WorktimeDocument> {

      const updated = await this.worktimeModel
        .findByIdAndUpdate(
          id,
          data,
          {
            returnDocument: 'after',
          }
        )
        .exec();

      if (!updated) {
        throw new NotFoundException(
          `Worktime with id ${id} not found`
        );
      }

      return updated;
  }
  async remove(id: string): Promise<WorktimeDocument | null> {
    return this.worktimeModel.findByIdAndDelete(id).exec();
  }
}