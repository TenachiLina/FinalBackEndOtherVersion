// src/attendance/schemas/raw-attendance-log.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export type RawAttendanceLogDocument = RawAttendanceLog & Document;

@Schema({ timestamps: true }) // adds createdAt and updatedAt automatically
export class RawAttendanceLog {
  @Prop({ required: true }) deviceUserId!: string;
  @Prop({ required: true }) timestamp!: Date;
  @Prop({ required: true }) deviceLogId!: string; // unique per company, see index below
  @Prop({ default: false }) processed!: boolean;
}

export const RawAttendanceLogSchema = SchemaFactory.createForClass(RawAttendanceLog);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
RawAttendanceLogSchema.plugin(tenantPlugin);
RawAttendanceLogSchema.index({ companyId: 1, deviceLogId: 1 }, { unique: true });
