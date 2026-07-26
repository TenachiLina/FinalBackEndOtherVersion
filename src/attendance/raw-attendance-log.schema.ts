// src/attendance/schemas/raw-attendance-log.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RawAttendanceLogDocument = RawAttendanceLog & Document;

@Schema({ timestamps: true }) // adds createdAt and updatedAt automatically
export class RawAttendanceLog {
  @Prop({ required: true }) deviceUserId!: string;
  @Prop({ required: true }) timestamp!: Date;
  @Prop({ required: true, unique: true }) deviceLogId!: string; // unique enforces dedup at DB level too
  @Prop({ default: false }) processed!: boolean;
}

export const RawAttendanceLogSchema = SchemaFactory.createForClass(RawAttendanceLog);