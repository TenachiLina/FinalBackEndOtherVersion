// import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
// import { Document, Types } from 'mongoose';

// export type PlanningDocument = Planning & Document;

// @Schema({ collection: 'planning' })
// export class Planning {
//   // @Prop({ type: Types.ObjectId, ref: 'Shift', required: true }) shiftId!: Types.ObjectId;
//   // @Prop({ type: Types.ObjectId, ref: 'Employee', required: true }) empId!: Types.ObjectId;
//   @Prop({ type: String, ref: 'Shift', required: true }) shiftId!: string;
//   @Prop({ type: String, ref: 'Employee', required: true }) empId!: string;
//   @Prop({ required: true }) taskId!: number;
//   @Prop({ required: true }) planDate!: Date;
//   @Prop() customStartTime!: string;
//   @Prop() customEndTime!: string;
// }

// export const PlanningSchema = SchemaFactory.createForClass(Planning);
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PlanningDocument = Planning & Document;

@Schema({ _id: false })
export class PlanningTask {
  @Prop({ required: true }) id!: string;
  @Prop({ required: true }) label!: string;
  @Prop({ required: true }) startTime!: string;
  @Prop({ required: true }) endTime!: string;
}
export const PlanningTaskSchema = SchemaFactory.createForClass(PlanningTask);

@Schema({ collection: 'planning' })
export class Planning {
  @Prop({ type: String, ref: 'Shift', required: true }) shiftId!: string;
  @Prop({ type: String, ref: 'Employee', required: true }) empId!: string;
  @Prop({ required: true }) taskId!: number;
  @Prop({ required: true }) planDate!: Date;
  @Prop({ type: [PlanningTaskSchema], default: [] }) tasks!: PlanningTask[];
  @Prop() customStartTime?: string;
  @Prop() customEndTime?: string;
}

export const PlanningSchema = SchemaFactory.createForClass(Planning);