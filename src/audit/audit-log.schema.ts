import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * One line of the activity log: who did what, and when.
 *
 * Not tenant-scoped by the plugin: super admin actions (managing companies)
 * have no company, and failed logins are written before any company is known.
 * AuditService filters by companyId itself.
 */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Company', default: null })
  companyId!: Types.ObjectId | null;

  // Who. Name, email and role are copied so the line still reads well
  // after the user is renamed or deleted.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;
  @Prop() userName?: string;
  @Prop() userEmail?: string;
  @Prop() userRole?: string;

  // What: a stable key such as "employee.delete" (the app turns it into text),
  // plus the record it was about, e.g. "Sara Benali" or "Employee #12".
  @Prop({ required: true }) action!: string;
  @Prop() target?: string;
  @Prop() targetId?: string;
  // The data that was sent, without passwords or images.
  @Prop({ type: MongooseSchema.Types.Mixed }) details?: unknown;

  @Prop({ required: true }) method!: string;
  @Prop({ required: true }) path!: string;
  @Prop({ default: true }) success!: boolean;
  @Prop() statusCode?: number;
  @Prop() error?: string;
  @Prop() ip?: string;

  createdAt!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ companyId: 1, createdAt: -1 });
AuditLogSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
