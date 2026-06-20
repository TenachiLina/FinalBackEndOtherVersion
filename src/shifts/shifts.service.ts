// import { Injectable } from '@nestjs/common';
// import { InjectModel } from '@nestjs/mongoose';
// import { Model } from 'mongoose';
// import { Shift, ShiftDocument } from './shift.shema';

// @Injectable()
// export class ShiftsService {
//   constructor(@InjectModel(Shift.name) private shiftModel: Model<ShiftDocument>) {}

//   async create(data: Partial<Shift>): Promise<ShiftDocument> {
//     return this.shiftModel.create(data);
//   }

//   async findAll(): Promise<ShiftDocument[]> {
//     return this.shiftModel.find().exec();
//   }

//   async findOne(id: string): Promise<ShiftDocument| null> {
//     return this.shiftModel.findById(id).exec();
//   }

//   async update(id: string, data: Partial<Shift>): Promise<ShiftDocument| null> {
//     return this.shiftModel.findByIdAndUpdate(id, data, { new: true }).exec();
//   }

//   async remove(id: string): Promise<ShiftDocument| null> {
//     return this.shiftModel.findByIdAndDelete(id).exec();
//   }
// }

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Shift, ShiftDocument } from '../shifts/shift.shema';

@Injectable()
export class ShiftsService {
  constructor(@InjectModel(Shift.name) private shiftModel: Model<ShiftDocument>) {}

  async create(data: Partial<Shift>): Promise<ShiftDocument> {
    return this.shiftModel.create(data);
  }

  async findAll(status: 'active' | 'archived' | 'all' = 'active'): Promise<ShiftDocument[]> {
    const filter = status === 'all' ? {} : { isArchived: status === 'archived' };
    return this.shiftModel.find(filter).exec();
  }

  async findOne(id: string): Promise<ShiftDocument | null> {
    return this.shiftModel.findById(id).exec();
  }

  async update(id: string, data: Partial<Shift>): Promise<ShiftDocument | null> {
    return this.shiftModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async setArchived(id: string, isArchived: boolean): Promise<ShiftDocument> {
    const shift = await this.shiftModel.findByIdAndUpdate(id, { isArchived }, { new: true }).exec();
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async remove(id: string, force = false): Promise<ShiftDocument> {
    // If you want the "still used in planning" guard from earlier, inject your
    // Planning model here and check usage count before deleting, throwing a
    // ConflictException with { usageCount } when force is false. Skipping it
    // for now since I don't know your Planning module's structure.
    const shift = await this.shiftModel.findByIdAndDelete(id).exec();
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }
}