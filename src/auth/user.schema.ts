import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ROLES } from './auth.decorators';
import type { Role } from './auth.decorators';

export type UserDocument = User & Document;

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;
  @Prop({ required: true, trim: true }) name!: string;
  // bcrypt hash, never returned by the API
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ required: true, enum: ROLES, default: 'manager' }) role!: Role;
  @Prop({ default: true }) active!: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
