import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export type ShiftDocument = Shift & Document;

@Schema({ collection: 'shifts' })
export class Shift {
  @Prop({ required: true }) startTime!: string;
  @Prop({ required: true }) endTime!: string;
  @Prop({ default: false }) isArchived!: boolean;
}

export const ShiftSchema = SchemaFactory.createForClass(Shift);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
ShiftSchema.plugin(tenantPlugin);
