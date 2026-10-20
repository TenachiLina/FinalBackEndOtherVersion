import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ErrorLogDocument = HydratedDocument<ErrorLog>;

// Old errors are deleted automatically after this long.
const KEEP_FOR_SECONDS = 90 * 24 * 60 * 60;

/**
 * One error, with everything needed to understand it: what failed, a guess
 * at why, where in the code, and the request and user it happened for.
 * See error-reporter.ts for the meaning of each field.
 *
 * Not tenant-scoped by the plugin: many errors happen without a company.
 */
@Schema({
  collection: 'error_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class ErrorLog {
  @Prop({ index: true }) reference?: string;
  @Prop({ required: true, enum: ['error', 'warning'] }) level!: string;
  @Prop({
    required: true,
    enum: ['request', 'background', 'process', 'frontend'],
  })
  source!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) message!: string;
  @Prop() code?: string;
  @Prop() hint?: string;
  @Prop() where?: string;
  @Prop() stack?: string;
  @Prop() context?: string;
  @Prop({ required: true, index: true }) fingerprint!: string;

  @Prop() statusCode?: number;
  @Prop() method?: string;
  @Prop() path?: string;
  @Prop() route?: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) query?: unknown;
  @Prop({ type: MongooseSchema.Types.Mixed }) body?: unknown;
  @Prop() pageUrl?: string;
  @Prop() userAgent?: string;
  @Prop() ip?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Company', default: null })
  companyId!: Types.ObjectId | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;
  @Prop() userName?: string;
  @Prop() userEmail?: string;
  @Prop() userRole?: string;

  createdAt!: Date;
}

export const ErrorLogSchema = SchemaFactory.createForClass(ErrorLog);
ErrorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: KEEP_FOR_SECONDS });
ErrorLogSchema.index({ companyId: 1, createdAt: -1 });
