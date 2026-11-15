import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export type NotificationReadDocument = HydratedDocument<NotificationRead>;

// "This user has read this alert". Alerts themselves are not stored (see
// notifications.util.ts); these marks are deleted by MongoDB after 60 days.
@Schema({ collection: 'notification_reads' })
export class NotificationRead {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true }) key!: string;

  @Prop({ type: Date, default: () => new Date() }) readAt!: Date;
}

export const NotificationReadSchema =
  SchemaFactory.createForClass(NotificationRead);
// Each mark belongs to one company; see tenancy/tenant.plugin.ts
NotificationReadSchema.plugin(tenantPlugin);
NotificationReadSchema.index(
  { companyId: 1, userId: 1, key: 1 },
  { unique: true },
);
NotificationReadSchema.index(
  { readAt: 1 },
  { expireAfterSeconds: 60 * 86_400 },
);
