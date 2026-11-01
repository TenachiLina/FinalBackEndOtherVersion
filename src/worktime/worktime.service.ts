import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Worktime,
  WorktimeDocument,
} from './worktime.shema';
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

// A client may send "" for "no time": it is stored as null, like a cleared time
function emptyTimesToNull(data: Partial<Worktime>): Partial<Worktime> {
  const clean = { ...data };
  if (clean.clock_in === '') clean.clock_in = null;
  if (clean.clock_out === '') clean.clock_out = null;
  return clean;
}

@Injectable()
export class WorktimeService {

  constructor(
    @InjectModel(Worktime.name)
    private worktimeModel: Model<WorktimeDocument>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE
  // ───────────────────────────────────────────────────────────────────────────

  // One record per employee, shift and day: a second save (two tabs, the kiosk
  // and a manager, a double click) updates the first, so a day is never paid twice.
  async create(
    body: Partial<Worktime>,
  ): Promise<WorktimeDocument> {

    const data = emptyTimesToNull(body);

    // Without them there is no day to look for: Mongoose would drop an
    // undefined key from the filter and overwrite someone else's record.
    if (data.emp_id == null || !data.work_date) {
      return this.worktimeModel.create(data);
    }

    const save = () =>
      this.worktimeModel
        .findOneAndUpdate(
          {
            emp_id: data.emp_id,
            shift_id: data.shift_id ?? null,
            work_date: data.work_date,
          },
          {
            $set: data,
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
          },
        )
        .exec() as Promise<WorktimeDocument>;

    try {
      return await save();
    } catch (err: any) {
      // Two saves raced to insert: the other one won, so update its record
      if (err?.code !== 11000) throw err;
      return save();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FIND ALL
  // ───────────────────────────────────────────────────────────────────────────

  async findAll(
    query: Record<string, any> = {},
  ): Promise<WorktimeDocument[]> {

    const filter: Record<string, any> = {};

    // Employee
    if (query.emp_id !== undefined) {
      const empId = Number(query.emp_id);

      if (!Number.isNaN(empId)) {
        filter.emp_id = empId;
      }
    }

    // Shift
    // IMPORTANT: shift_id is a STRING.
    if (query.shift_id) {
      filter.shift_id = String(query.shift_id);
    }

    // Work date
    // Search the whole day instead of requiring an exact
    // Date object match.
    if (query.work_date) {

      const start = new Date(
        `${query.work_date}T00:00:00.000`,
      );

      const end = new Date(
        `${query.work_date}T23:59:59.999`,
      );

      filter.work_date = {
        $gte: start,
        $lte: end,
      };
    }

    return this.worktimeModel
      .find(filter)
      .sort({ work_date: 1 })
      .exec();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // REPORT
  // ───────────────────────────────────────────────────────────────────────────

  async findForReport(
    query: Record<string, any> = {},
  ): Promise<WorktimeDocument[]> {

    const filter: Record<string, any> = {};

    if (
      query.emp_id !== undefined ||
      query.empId !== undefined
    ) {

      const empId = Number(
        query.emp_id ?? query.empId,
      );

      if (!Number.isNaN(empId)) {
        filter.emp_id = empId;
      }
    }

    if (query.start && query.end) {

      const start = new Date(
        `${query.start}T00:00:00.000`,
      );

      const end = new Date(
        `${query.end}T23:59:59.999`,
      );

      filter.work_date = {
        $gte: start,
        $lte: end,
      };
    }

    return this.worktimeModel
      .find(filter)
      .sort({ work_date: 1 })
      .exec();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FIND ONE
  // ───────────────────────────────────────────────────────────────────────────

  async findOne(
    id: string,
  ): Promise<WorktimeDocument | null> {

    return this.worktimeModel
      .findById(id)
      .exec();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ───────────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    data: Partial<Worktime>,
  ): Promise<WorktimeDocument> {

    const updated =
      await this.worktimeModel
        .findByIdAndUpdate(
          id,
          {
            $set: emptyTimesToNull(data),
          },
          {
            new: true,
            runValidators: true,
          },
        )
        .exec();

    if (!updated) {
      throw new NotFoundException(
        `Worktime with id ${id} not found`,
      );
    }

    return updated;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE
  // ───────────────────────────────────────────────────────────────────────────

  async remove(
    id: string,
  ): Promise<WorktimeDocument | null> {

    return this.worktimeModel
      .findByIdAndDelete(id)
      .exec();
  }
}