import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export type TaskDocument = Task & Document;

@Schema({ collection: 'tasks' })
export class Task {
  @Prop({ required: true }) taskId!: number;
  @Prop({ required: true }) taskName!: string;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
TaskSchema.plugin(tenantPlugin);
TaskSchema.index({ companyId: 1, taskId: 1 }, { unique: true });
