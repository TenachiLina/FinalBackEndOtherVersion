import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Advance, AdvanceDocument } from './advance.schema';

@Injectable()
export class AdvancesService {
  constructor(@InjectModel(Advance.name) private advanceModel: Model<AdvanceDocument>) {}

  /**
   * Create a new advance. Rejects (409 Conflict) if an advance already
   * exists for this employee on this exact date — the frontend always
   * sends the period's start date, so "same date" effectively means
   * "same week/period", preventing accidental duplicate advances.
   */
  async create(data: { emp_id: number; amount: number; date: string; reason?: string }): Promise<AdvanceDocument> {
    const targetDate = new Date(data.date);

    const existing = await this.advanceModel
      .findOne({ emp_id: data.emp_id, date: targetDate })
      .exec();

    if (existing) {
      throw new ConflictException(
        `An advance for employee ${data.emp_id} on ${data.date} already exists.`
      );
    }

    return this.advanceModel.create({
      emp_id: data.emp_id,
      amount: data.amount,
      date: targetDate,
      reason: data.reason,
    });
  }

  /** All advances, optionally filtered by date range. */
  async findAll(query: Record<string, any> = {}): Promise<AdvanceDocument[]> {
    const filter: Record<string, any> = {};

    if (query.start && query.end) {
      filter.date = { $gte: new Date(query.start), $lte: new Date(query.end) };
    }

    return this.advanceModel.find(filter).sort({ date: -1 }).exec();
  }

  /** One employee's advances, optionally filtered by date range. */
  async findByEmployee(empId: number, query: Record<string, any> = {}): Promise<AdvanceDocument[]> {
    const filter: Record<string, any> = { emp_id: empId };

    if (query.start && query.end) {
      filter.date = { $gte: new Date(query.start), $lte: new Date(query.end) };
    }

    return this.advanceModel.find(filter).sort({ date: -1 }).exec();
  }

  /** Delete a specific advance by its own Mongo _id. */
  async remove(id: string): Promise<AdvanceDocument> {
    const deleted = await this.advanceModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Advance ${id} not found.`);
    }
    return deleted;
  }
}