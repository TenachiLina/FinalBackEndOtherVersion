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
  // Language for people who haven't picked one themselves: en, fr or ar
  @Prop({ default: 'en' }) language!: string;
  @Prop({ default: 'DA' }) currency!: string;
  // UTC offset of the company's clocking machines, e.g. "+01:00"
  @Prop({ default: '+01:00' }) utcOffset!: string;
  // Payroll rules (see the frontend's payrollConfig)
  @Prop({ default: 8 }) hoursPerDay!: number;
  @Prop({ default: 26 }) workingDaysPerMonth!: number;
  // Share of earned pay offered as a weekly advance (0.5 = half)
  @Prop({ default: 0.5 }) weeklyAdvanceRatio!: number;
  // Days after the end of a month at which it closes by itself (its hours
  // and pay can then no longer change). Empty: months are closed by hand only.
  @Prop({ type: Number, default: null }) monthCloseDelayDays?: number | null;
  // Payslip header (the company name comes from Company.name)
  @Prop({ trim: true }) payslipActivity?: string;
  @Prop({ trim: true }) payslipAddress?: string;
  @Prop({ trim: true }) payslipContributorNumber?: string;
}
export const CompanySettingsSchema =
  SchemaFactory.createForClass(CompanySettings);

@Schema({ _id: false })
export class CompanyDevice {
  // Serial number the ZKTeco machine sends as ?SN=...
  @Prop({ required: true, trim: true }) serial!: string;
  @Prop({ trim: true }) name?: string;
  // Address the server reaches the machine at, for Sync and /device/*
  @Prop({ trim: true }) ip?: string;
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

export interface SubscriptionPayment {
  _id: unknown;
  date: string; // "YYYY-MM-DD"
  amount: number;
  method?: string;
  reference?: string;
  note?: string;
  // Months this payment added to the subscription
  months: number;
  recordedBy: string;
  recordedAt: Date;
}

export interface CompanySubscription {
  packId: unknown;
  packName: string;
  // A trial or a paid period; "expired" is worked out from endsAt
  status: 'trial' | 'active';
  startsAt: Date;
  // The subscription runs through this moment
  endsAt: Date;
  // null: no limit
  maxEmployees: number | null;
  price: number | null;
  currency: string | null;
  periodMonths: number | null;
  note?: string;
  payments: SubscriptionPayment[];
}

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

  // Pages switched off one by one inside the features above (see pages.ts)
  @Prop({ type: [String], default: [] }) disabledPages!: string[];

  // The pack the company has, until when, and the payments recorded for it
  // (see SubscriptionsService). Null: no end date and no limit.
  @Prop({ type: Object, default: null })
  subscription!: CompanySubscription | null;
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
