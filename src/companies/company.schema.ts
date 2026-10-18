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

// How the company's sign-in page and sidebar look. Set by the super admin.
@Schema({ _id: false })
export class CompanyBranding {
  // Small image as a data URL (data:image/png;base64,...), max ~300 KB
  @Prop() logo?: string;
  // Text on the sign-in page's side panel
  @Prop({ trim: true }) title?: string;
  @Prop({ trim: true }) subtitle?: string;
  // Side panel background colour, #RRGGBB
  @Prop({ trim: true }) color?: string;
}
export const CompanyBrandingSchema =
  SchemaFactory.createForClass(CompanyBranding);

export type CompanyDocument = Company & Document;

// Not tenant-scoped: companies are managed by the super admin.
@Schema({ collection: 'companies', timestamps: true })
export class Company {
  @Prop({ required: true, trim: true }) name!: string;
  // Used in the company's sign-in link: /signin?company=<slug>
  @Prop({ trim: true, lowercase: true }) slug?: string;
  @Prop({ type: CompanyBrandingSchema, default: () => ({}) })
  branding!: CompanyBranding;
  @Prop({ default: true }) active!: boolean;
  @Prop({ type: [String], enum: FEATURES, default: () => [...FEATURES] })
  features!: Feature[];
  @Prop({ type: CompanySettingsSchema, default: () => ({}) })
  settings!: CompanySettings;
  @Prop({ type: [CompanyDeviceSchema], default: [] })
  devices!: CompanyDevice[];
}

export const CompanySchema = SchemaFactory.createForClass(Company);
CompanySchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
);
// A machine can only belong to one company.
CompanySchema.index(
  { 'devices.serial': 1 },
  {
    unique: true,
    partialFilterExpression: { 'devices.serial': { $exists: true } },
  },
);
