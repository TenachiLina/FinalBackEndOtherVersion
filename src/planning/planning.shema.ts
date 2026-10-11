// export const PlanningSchema = SchemaFactory.createForClass(Planning);
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PlanningDocument = Planning & Document;

@Schema({ _id: false })
export class PlanningTask {
  @Prop() id!: string;
  @Prop() label!: string;
  @Prop() startTime!: string;
  @Prop() endTime!: string;
}
export const PlanningTaskSchema = SchemaFactory.createForClass(PlanningTask);

@Schema({ collection: 'planning' })
export class Planning {

  @Prop({ type: String, ref: 'Shift', required: true })
  shiftId!: string;

  @Prop({ type: String, ref: 'Employee', required: true })
  empId!: string;

  @Prop({ type: String, ref: 'Employee', default: null })
  backupEmpId?: string | null;

  @Prop({ required: true })
  taskId!: number;

  @Prop({ required: true })
  planDate!: Date;

  @Prop({ type: [PlanningTaskSchema], default: [] })
  tasks!: PlanningTask[];

  @Prop()
  customStartTime?: string;

  @Prop()
  customEndTime?: string;
}

export const PlanningSchema = SchemaFactory.createForClass(Planning);