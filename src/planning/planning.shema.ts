import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PlanningDocument = Planning & Document;

@Schema({ collection: 'planning' })
export class Planning {
  @Prop({ type: Types.ObjectId, ref: 'Shift', required: true }) shiftId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true }) empId!: Types.ObjectId;
  @Prop({ required: true }) taskId!: number;
  @Prop({ required: true }) planDate!: Date;
  @Prop() customStartTime!: string;
  @Prop() customEndTime!: string;
}

export const PlanningSchema = SchemaFactory.createForClass(Planning);