import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Bonus extends Document {
  @Prop({ required: true })
  emp_id: number; // employee number (empNumber), same convention as advances

  @Prop({ required: true, min: 0 })
  amount: number;

  // Stored as "YYYY-MM-DD" so range filtering is a simple string comparison
  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  reason: string;
}

export const BonusSchema = SchemaFactory.createForClass(Bonus);