import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bonus } from './bonus.schema';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class BonusesService {
  constructor(@InjectModel(Bonus.name) private readonly bonusModel: Model<Bonus>) {}

  async create(body: { emp_id: number; amount: number; date: string; reason: string }) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be greater than 0');
    if (!ISO_DATE.test(String(body.date))) throw new BadRequestException('date must be YYYY-MM-DD');
    if (!body.reason || !String(body.reason).trim()) throw new BadRequestException('reason is required');
    if (body.emp_id === undefined || body.emp_id === null) throw new BadRequestException('emp_id is required');

    return this.bonusModel.create({
      emp_id: Number(body.emp_id),
      amount,
      date: body.date,
      reason: String(body.reason).trim(),
    });
  }

  findAll(query: { start?: string; end?: string; empId?: string }) {
    const filter: Record<string, any> = {};
    if (query.start || query.end) {
      filter.date = {};
      if (query.start) filter.date.$gte = query.start;
      if (query.end) filter.date.$lte = query.end;
    }
    if (query.empId) filter.emp_id = Number(query.empId);
    return this.bonusModel.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  }

  findOne(id: string) {
    return Types.ObjectId.isValid(id)
      ? this.bonusModel.findById(id).lean()
      : Promise.resolve(null);
  }

  async remove(id: string) {
    const removed = await this.bonusModel.findByIdAndDelete(id);
    if (!removed) throw new NotFoundException('Bonus not found');
    return { deleted: true };
  }
}