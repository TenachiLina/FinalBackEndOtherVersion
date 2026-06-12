import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ShiftDocument = Shift & Document;

@Schema({ collection: 'shifts' })
export class Shift {
  @Prop({ required: true }) startTime!: string;
  @Prop({ required: true }) endTime!: string;
}

export const ShiftSchema = SchemaFactory.createForClass(Shift);