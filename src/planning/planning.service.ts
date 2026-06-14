// planning.service.ts — replace your existing findAll with this version

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Planning, PlanningDocument } from './planning.shema';

@Injectable()
export class PlanningService {
  constructor(@InjectModel(Planning.name) private planningModel: Model<PlanningDocument>) {}

  async create(data: Partial<Planning>): Promise<PlanningDocument> {
    return this.planningModel.create(data);
  }

  async findAll(query: Record<string, any> = {}): Promise<PlanningDocument[]> {
    const filter: Record<string, any> = {};

    if (query.planDate) {
      // Match the whole day regardless of time component
      const start = new Date(query.planDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(query.planDate);
      end.setHours(23, 59, 59, 999);
      filter.planDate = { $gte: start, $lte: end };
    }

    return this.planningModel
      .find(filter)
      .populate('shiftId')
      .populate('empId')
      .exec();
  }

  async findOne(id: string): Promise<PlanningDocument | null> {
    return this.planningModel.findById(id).populate('shiftId').populate('empId').exec();
  }

  async update(id: string, data: Partial<Planning>): Promise<PlanningDocument | null> {
    return this.planningModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<PlanningDocument | null> {
    return this.planningModel.findByIdAndDelete(id).exec();
  }
}