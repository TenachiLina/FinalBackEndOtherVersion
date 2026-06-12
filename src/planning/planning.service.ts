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

  async findAll(): Promise<PlanningDocument[]> {
    return this.planningModel.find().populate('shiftId').populate('empId').exec();
  }

  async findOne(id: string): Promise<PlanningDocument | null> {
    return this.planningModel.findById(id).populate('shiftId').populate('empId').exec();
  }

  async update(id: string, data: Partial<Planning>): Promise<PlanningDocument|null> {
    return this.planningModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<PlanningDocument | null > {
    return this.planningModel.findByIdAndDelete(id).exec();
  }
}