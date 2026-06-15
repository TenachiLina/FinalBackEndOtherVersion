import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TaskDocument = Task & Document;

@Schema({ collection: 'tasks' })
export class Task {
  @Prop({ required: true, unique: true }) taskId!: number;
  @Prop({ required: true }) taskName!: string;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
