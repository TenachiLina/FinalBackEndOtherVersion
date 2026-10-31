import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

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

  // Main employee id
  @Prop()
  backup_for_emp_id?: number;

  // Selected backup employee's employee number
  @Prop({ type: Number, default: null })
  backup_emp_id?: number | null;
}

export const WorktimeSchema =
  SchemaFactory.createForClass(Worktime);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
WorktimeSchema.plugin(tenantPlugin);
// One record per employee, shift and day, or payroll pays the day twice.
// Existing duplicates must go first: see scripts/dedupe-worktime.js
WorktimeSchema.index(
  { companyId: 1, emp_id: 1, shift_id: 1, work_date: 1 },
  { unique: true, partialFilterExpression: { work_date: { $type: 'date' } } },
);
