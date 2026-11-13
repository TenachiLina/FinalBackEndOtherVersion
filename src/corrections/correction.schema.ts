import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export const CORRECTION_KINDS = ['worktime', 'advance', 'bonus'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_STATUSES = [
  'pending',
  'corrected',
  'rejected',
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export type CorrectionDocument = HydratedDocument<Correction>;

/**
 * An employee's report of a mistake in their worked time, an advance or a
 * bonus, sent from the mobile app before payday. A manager or admin checks
 * it, fixes the record on the usual page, and marks the report corrected or
 * rejected with an optional reply the employee sees in the app.
 */
@Schema({ collection: 'correction_requests', timestamps: true })
export class Correction {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Employee',
    required: true,
    index: true,
  })
  employeeId!: Types.ObjectId;

  // Employee number, like worktime, advances and bonuses (manager visibility
  // rules filter on it)
  @Prop({ required: true }) emp_id!: number;

  // The name when reported, so the request still reads well if it changes
  @Prop({ required: true }) employeeName!: string;

  @Prop({ type: String, required: true, enum: CORRECTION_KINDS })
  kind!: CorrectionKind;

  // The record reported, or null for something missing (e.g. a day worked
  // with no clocking record)
  @Prop({ type: String, default: null }) recordId!: string | null;

  // "YYYY-MM-DD", the day the record is about
  @Prop({ required: true }) date!: string;

  // What the employee saw in the app when reporting
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  snapshot!: Record<string, unknown> | null;

  @Prop({ required: true }) message!: string;

  @Prop({
    type: String,
    enum: CORRECTION_STATUSES,
    default: 'pending',
    index: true,
  })
  status!: CorrectionStatus;

  @Prop({ type: String, default: null }) reply!: string | null;
  @Prop({ type: String, default: null }) handledByName!: string | null;
  @Prop({ type: String, default: null }) handledById!: string | null;
  @Prop({ type: Date, default: null }) handledAt!: Date | null;

  // The account that sent it
  @Prop({ required: true }) createdBy!: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CorrectionSchema = SchemaFactory.createForClass(Correction);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
CorrectionSchema.plugin(tenantPlugin);
CorrectionSchema.index({ companyId: 1, status: 1, createdAt: -1 });
