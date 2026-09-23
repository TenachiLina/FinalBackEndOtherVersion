import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorktimeDocument = HydratedDocument<Worktime>;

@Schema({
  collection: 'worktime',
})
export class Worktime {

  // Employee number
  @Prop({ required: true })
  emp_id!: number;

  // Shift ID from the planning/shift collection
  @Prop()
  shift_id?: string;

  // Operational attendance date
  @Prop()
  work_date?: Date;

  // First clock-in of the day
  @Prop({ default: '00:00' })
  clock_in?: string;

  // Final clock-out of the day
  @Prop({ default: '00:00' })
  clock_out?: string;

  // Total delay relative to the shift
  @Prop({ default: '0' })
  late_minutes?: string;

  // Overtime relative to the shift
  @Prop({ default: '0' })
  overtime_minutes?: string;

  // Total worked time across ALL periods
  @Prop({ default: '00:00' })
  work_hours?: string;

  // Consumption
  @Prop({ default: 0 })
  consomation?: number;

  // Penalty
  @Prop({ default: 0 })
  penalty?: number;

  // Bonus
  @Prop({ default: 0 })
  bonus?: number;

  // Absence
  @Prop({ default: false })
  absent?: boolean;

  // Absence reason
  @Prop()
  absent_comment?: string;
}

export const WorktimeSchema =
  SchemaFactory.createForClass(Worktime);