import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Optional parts of the product that can be switched on or off per company.
 * Employees, users and company settings are always available.
 */
export const FEATURES = [
  'planning', // planning, shifts, tasks
  'clockin', // clock-in pages, device logs, worktime
  'faceRecognition', // clock-in with the face-recognition machine
  'reporting', // overview, attendance and payroll reports
  'advances',
  'bonuses',
] as const;
export type Feature = (typeof FEATURES)[number];

@Schema({ _id: false })
export class CompanySettings {
  @Prop({ default: 'DA' }) currency!: string;
  // UTC offset of the company's clocking machines, e.g. "+01:00"
  @Prop({ default: '+01:00' }) utcOffset!: string;
  // Payroll rules (see the frontend's payrollConfig)
  @Prop({ default: 8 }) hoursPerDay!: number;
  @Prop({ default: 26 }) workingDaysPerMonth!: number;
  // Share of earned pay offered as a weekly advance (0.5 = half)
  @Prop({ default: 0.5 }) weeklyAdvanceRatio!: number;
}
export const CompanySettingsSchema =
  SchemaFactory.createForClass(CompanySettings);

@Schema({ _id: false })
export class CompanyDevice {
  // Serial number the ZKTeco machine sends as ?SN=...
  @Prop({ required: true, trim: true }) serial!: string;
  @Prop({ trim: true }) name?: string;
}
export const CompanyDeviceSchema = SchemaFactory.createForClass(CompanyDevice);

export type CompanyDocument = Company & Document;

// Not tenant-scoped: companies are managed by the super admin.
@Schema({ collection: 'companies', timestamps: true })
export class Company {
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ default: true }) active!: boolean;
  @Prop({ type: [String], enum: FEATURES, default: () => [...FEATURES] })
  features!: Feature[];
  @Prop({ type: CompanySettingsSchema, default: () => ({}) })
  settings!: CompanySettings;
  @Prop({ type: [CompanyDeviceSchema], default: [] })
  devices!: CompanyDevice[];
}

export const CompanySchema = SchemaFactory.createForClass(Company);
// A machine can only belong to one company.
CompanySchema.index(
  { 'devices.serial': 1 },
  {
    unique: true,
    partialFilterExpression: { 'devices.serial': { $exists: true } },
  },
);
