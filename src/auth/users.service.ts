import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './user.schema';
import { ROLES } from './auth.decorators';
import type { Role } from './auth.decorators';

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateUserInput {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  active?: boolean;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  static validatePassword(password: unknown): string {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    return password;
  }

  private validateRole(role: unknown): Role {
    if (!ROLES.includes(role as Role)) {
      throw new BadRequestException(`Role must be one of: ${ROLES.join(', ')}`);
    }
    return role as Role;
  }

  findAll(): Promise<UserDocument[]> {
    return this.userModel.find().sort({ createdAt: 1 }).exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  async create(input: CreateUserInput): Promise<UserDocument> {
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!email || !EMAIL_RE.test(email))
      throw new BadRequestException('A valid email is required');
    if (!name) throw new BadRequestException('Name is required');
    const password = UsersService.validatePassword(input.password);
    const role = this.validateRole(input.role ?? 'manager');

    if (await this.userModel.exists({ email })) {
      throw new ConflictException('A user with this email already exists');
    }
    const user = await this.userModel.create({
      email,
      name,
      role,
      passwordHash: await UsersService.hashPassword(password),
    });
    return (await this.findById(String(user._id)))!;
  }

  async update(
    id: string,
    actorId: string,
    input: UpdateUserInput,
  ): Promise<UserDocument> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');

    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new BadRequestException('Name is required');
      user.name = name;
    }
    if (input.role !== undefined) user.role = this.validateRole(input.role);
    if (input.active !== undefined) user.active = Boolean(input.active);

    // Never let an admin lock themselves out, and always keep at least one active admin.
    if (id === actorId && (user.role !== 'admin' || !user.active)) {
      throw new BadRequestException('You cannot remove your own admin access');
    }
    await this.ensureAnotherActiveAdmin(user);

    return user.save();
  }

  async setPassword(id: string, password: unknown): Promise<void> {
    const valid = UsersService.validatePassword(password);
    const res = await this.userModel
      .updateOne(
        { _id: id },
        { passwordHash: await UsersService.hashPassword(valid) },
      )
      .exec();
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
  }

  async verifyPassword(id: string, password: string): Promise<boolean> {
    const user = await this.userModel
      .findById(id)
      .select('+passwordHash')
      .exec();
    return !!user && bcrypt.compare(password, user.passwordHash);
  }

  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId)
      throw new BadRequestException('You cannot delete your own account');
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    user.active = false; // treat as no longer an active admin for the check below
    await this.ensureAnotherActiveAdmin(user);
    await this.userModel.deleteOne({ _id: id }).exec();
  }

  // Throws if saving `user` as-is would leave no active admin.
  private async ensureAnotherActiveAdmin(user: UserDocument): Promise<void> {
    if (user.role === 'admin' && user.active) return;
    const others = await this.userModel
      .countDocuments({ _id: { $ne: user._id }, role: 'admin', active: true })
      .exec();
    if (others === 0)
      throw new BadRequestException('There must be at least one active admin');
  }
}
