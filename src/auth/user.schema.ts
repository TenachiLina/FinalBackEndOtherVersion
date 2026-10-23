import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import type { Role } from './auth.decorators';

export type UserDocument = User & Document;

// Not tenant-scoped by the plugin: login must find a user before the company is
// known. UsersService filters by companyId itself.
@Schema({ collection: 'users', timestamps: true })
export class User {
  // Emails are unique across all companies so login needs no company name.
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;
  @Prop({ required: true, trim: true }) name!: string;
  // bcrypt hash, never returned by the API
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({
    type: String,
    required: true,
    enum: ['superadmin', 'admin', 'manager', 'employee'],
    default: 'manager',
  })
  role!: Role;
  // Null only for super admins.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  })
  companyId!: Types.ObjectId | null;
  @Prop({ default: true }) active!: boolean;
  // For a manager: the employee record that is this person. Other managers
  // don't see that employee on salary pages (see ManagerVisibilityService).
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Employee',
    default: null,
  })
  employeeId!: Types.ObjectId | null;

  // Brute-force protection: wrong passwords in a row, and until when the
  // account refuses sign-in after too many. Never returned by the API.
  @Prop({ default: 0, select: false }) failedLoginAttempts!: number;
  @Prop({ type: Date, default: null, select: false })
  lockedUntil!: Date | null;
  @Prop({ type: Date, default: null }) passwordChangedAt!: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
