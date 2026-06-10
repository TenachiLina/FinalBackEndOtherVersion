import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmployeeDocument = Employee & Document;

@Schema({ collection: 'employees' })
export class Employee {
  @Prop() personalImage!: string;
  @Prop() address!: string;
  @Prop() phoneNumber!: string;
  @Prop({ required: true, default: 0 }) baseSalary!: number;
  @Prop({ unique: true }) empNumber!: number;
  @Prop({ required: true }) firstName!: string;
  @Prop({ required: true }) lastName!: string;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);