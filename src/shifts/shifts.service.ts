import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Shift, ShiftDocument } from './shift.shema';

@Injectable()
export class ShiftsService {
  constructor(@InjectModel(Shift.name) private shiftModel: Model<ShiftDocument>) {}

  async create(data: Partial<Shift>): Promise<ShiftDocument> {
    return this.shiftModel.create(data);
  }

  async findAll(): Promise<ShiftDocument[]> {
    return this.shiftModel.find().exec();
  }

  async findOne(id: string): Promise<ShiftDocument| null> {
    return this.shiftModel.findById(id).exec();
  }

  async update(id: string, data: Partial<Shift>): Promise<ShiftDocument| null> {
    return this.shiftModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<ShiftDocument| null> {
    return this.shiftModel.findByIdAndDelete(id).exec();
  }
}