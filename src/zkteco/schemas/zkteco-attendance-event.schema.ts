import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantPlugin } from '../../tenancy/tenant.plugin';

export type ZktecoAttendanceEventDocument =
  HydratedDocument<ZktecoAttendanceEvent>;

@Schema({
  timestamps: true,
  collection: 'zkteco_attendance_events',
})
export class ZktecoAttendanceEvent {
  @Prop({ required: true, index: true })
  deviceSerial!: string;

  // Keep this as a string so PINs such as "0007" retain leading zeros.
  @Prop({ required: true, index: true })
  employeePin!: string;

  // Parsed instant used for queries. The timezone interpretation is configurable.
  @Prop({ required: true, index: true })
  eventTime!: Date;

  // Exact timestamp text received from the device, for audit/re-parsing.
  @Prop({ required: true })
  deviceTimestamp!: string;

  // Device-provided codes; interpretation depends on the terminal configuration.
  @Prop({ required: true })
  status!: number;

  @Prop({ required: true })
  verifyMode!: number;

  @Prop()
  workCode?: string;

  @Prop({ required: true })
  rawLine!: string;

  @Prop({ required: true })
  eventKey!: string;

  @Prop({
    required: true,
    enum: ['pending', 'processed', 'failed'],
    default: 'pending',
    index: true,
  })
  processingStatus!: 'pending' | 'processed' | 'failed';
}

export const ZktecoAttendanceEventSchema =
  SchemaFactory.createForClass(ZktecoAttendanceEvent);

// The database enforces idempotency, including concurrent device retries.
ZktecoAttendanceEventSchema.index(
  { eventKey: 1 },
  { unique: true, name: 'uniq_zkteco_event_key' },
);

ZktecoAttendanceEventSchema.index(
  { deviceSerial: 1, eventTime: -1 },
  { name: 'zkteco_device_time' },
);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
ZktecoAttendanceEventSchema.plugin(tenantPlugin);
