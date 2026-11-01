import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Shift, ShiftDocument } from '../shifts/shift.shema';
import { Planning, PlanningDocument } from '../planning/planning.shema';

@Injectable()
export class ShiftsService {
  constructor(
  @InjectModel(Shift.name) private shiftModel: Model<ShiftDocument>,
  @InjectModel(Planning.name) private planningModel: Model<PlanningDocument>,
  ) {}

  async create(data: Partial<Shift>): Promise<ShiftDocument> {
    return this.shiftModel.create(data);
  }

  async findAll(status: 'active' | 'archived' | 'all' = 'active'): Promise<ShiftDocument[]> {
    const filter = status === 'all' ? {} : { isArchived: status === 'archived' };
    return this.shiftModel.find(filter).exec();
  }

  async findOne(id: string): Promise<ShiftDocument> {
    const shift = await this.shiftModel.findById(id).exec();
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async update(id: string, data: Partial<Shift>): Promise<ShiftDocument> {
    const shift = await this.shiftModel
      .findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .exec();
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async setArchived(id: string, isArchived: boolean): Promise<ShiftDocument> {
    const shift = await this.shiftModel.findByIdAndUpdate(id, { isArchived }, { new: true }).exec();
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async remove(id: string, force = false): Promise<ShiftDocument> {
    const shift = await this.shiftModel.findById(id).exec();
    if (!shift) throw new NotFoundException('Shift not found');

    const usageCount = await this.planningModel.countDocuments({ shiftId: id });
    if (usageCount > 0 && !force) {
      throw new ConflictException({
        message: `This shift is used ${usageCount} times in the planning`,
        usageCount,
      });
    }

    await this.shiftModel.findByIdAndDelete(id).exec();
    return shift;
  }
}