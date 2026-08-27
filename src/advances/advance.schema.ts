import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AdvanceDocument = HydratedDocument<Advance>;

@Schema({ collection: 'advances' })
export class Advance {
  @Prop({ required: true })
  emp_id!: number;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  date!: Date;

  @Prop()
  reason?: string;
}

export const AdvanceSchema = SchemaFactory.createForClass(Advance);