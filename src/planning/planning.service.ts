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
      const start = new Date(query.planDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(query.planDate); end.setHours(23, 59, 59, 999);
      filter.planDate = { $gte: start, $lte: end };
    }

    return this.planningModel.find(filter).populate('shiftId').populate('empId').exec();
  }

  // /** Keep existing planning entries in the database.
  //     Add only new entries.
  //     Avoid deleting all planning for the day.
  //  */
  // async bulkSave(entries: any[], planDate: string): Promise<PlanningDocument[]> {
  //   const inserted: PlanningDocument[] = [];

  //   for (const entry of entries) {
  //     const exists = await this.planningModel.findOne({
  //       planDate: new Date(entry.planDate),
  //       shiftId: entry.shiftId,
  //       empId: entry.empId,
  //       taskId: entry.taskId,
  //     });

  //     if (!exists) {
  //       const doc = await this.planningModel.create({
  //         shiftId: entry.shiftId,
  //         empId: entry.empId,
  //         taskId: entry.taskId,
  //         planDate: new Date(entry.planDate),
  //       });

  //       inserted.push(doc);
  //     }
  //   }

  //   return inserted;
  // }

  //Delete old entries and insert new ones for the day. This is simpler and avoids duplicates.
  async bulkSave(entries: any[], planDate: string): Promise<PlanningDocument[]> 
  { 
    const start = new Date(planDate); 
    start.setHours(0, 0, 0, 0); 
    const end = new Date(planDate); 
    end.setHours(23, 59, 59, 999); 
    await this.planningModel.deleteMany({ planDate: { $gte: start, $lte: end } }); 
    if (!entries.length) return []; 
    const docs = entries.map((e) => (
      { shiftId: e.shiftId, empId: e.empId, taskId: e.taskId, planDate: new Date(e.planDate), })); 
      return this.planningModel.insertMany(docs) as any; 
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