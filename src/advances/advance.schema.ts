import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

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

// Each record belongs to one company; see tenancy/tenant.plugin.ts
AdvanceSchema.plugin(tenantPlugin);
