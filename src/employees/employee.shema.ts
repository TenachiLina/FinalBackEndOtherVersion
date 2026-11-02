import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin';

export type EmployeeDocument = Employee & Document;

@Schema({ collection: 'employees' })
export class Employee {
  @Prop() personalImage!: string;
  @Prop() address!: string;
  @Prop() phoneNumber!: string;
  @Prop({ required: true, default: 0 }) baseSalary!: number;
  @Prop({ required: true, min: 1 }) empNumber!: number;
  @Prop({ required: true }) firstName!: string;
  @Prop({ required: true }) lastName!: string;
  // Shown on the payslip (fiche de paie)
  @Prop({ trim: true }) jobTitle?: string;
  // C, M, D or V (célibataire, marié(e), divorcé(e), veuf/veuve)
  @Prop({ trim: true }) familyStatus?: string;
  // "YYYY-MM-DD"
  @Prop({ trim: true }) birthDate?: string;
  @Prop({ trim: true }) hireDate?: string;
  @Prop({ trim: true }) socialSecurityNumber?: string;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);

// Each record belongs to one company; see tenancy/tenant.plugin.ts
EmployeeSchema.plugin(tenantPlugin);
EmployeeSchema.index({ companyId: 1, empNumber: 1 }, { unique: true });
