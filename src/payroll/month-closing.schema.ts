import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export type MonthClosingDocument = HydratedDocument<MonthClosing>;

@Schema({ _id: false })
export class ClosingActor {
  @Prop() id?: string;
  @Prop() name?: string;
}
const ClosingActorSchema = SchemaFactory.createForClass(ClosingActor);

/**
 * One record per company and month, written the first time the month is
 * closed. While `status` is "closed" the month's work time, advances and
 * bonuses can't be changed, and its payroll is the frozen `snapshot`.
 * A reopened month keeps its record (status "reopened") so it doesn't close
 * by itself again: an admin closes it when the corrections are done.
 */
@Schema({ collection: 'month_closings', timestamps: true })
export class MonthClosing {
  // "YYYY-MM"
  @Prop({ required: true }) month!: string;

  @Prop({ type: String, required: true, enum: ['closed', 'reopened'] })
  status!: 'closed' | 'reopened';

  // True when the month closed by itself after the company's delay
  @Prop({ default: false }) auto!: boolean;

  @Prop({ type: Date }) closedAt?: Date;
  // Empty for an automatic closing
  @Prop({ type: ClosingActorSchema }) closedBy?: ClosingActor;

  @Prop({ type: Date }) reopenedAt?: Date;
  @Prop({ type: ClosingActorSchema }) reopenedBy?: ClosingActor;

  // The month's payroll as it was when it closed: { settings, rows, totals, payslips }
  @Prop({ type: MongooseSchema.Types.Mixed }) snapshot?: any;
}

export const MonthClosingSchema = SchemaFactory.createForClass(MonthClosing);
// Each record belongs to one company; see tenancy/tenant.plugin.ts
MonthClosingSchema.plugin(tenantPlugin);
MonthClosingSchema.index({ companyId: 1, month: 1 }, { unique: true });
