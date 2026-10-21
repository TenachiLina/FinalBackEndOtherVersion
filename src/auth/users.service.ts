import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './user.schema';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import { COMPANY_ROLES } from './auth.decorators';
import type { Role } from './auth.decorators';

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateUserInput {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
  employeeId?: string | null;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  active?: boolean;
  employeeId?: string | null;
}

/**
 * Company users. Every method takes the company it works in, so an admin of
 * one company can never read or change another company's users.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
  ) {}

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
    if (!COMPANY_ROLES.includes(role as Role)) {
      throw new BadRequestException(
        `Role must be one of: ${COMPANY_ROLES.join(', ')}`,
      );
    }
    return role as Role;
  }

  // Only managers are linked to an employee; one account per employee.
  private async validateEmployeeLink(
    employeeId: unknown,
    role: Role,
    companyId: string,
    userId?: string,
  ): Promise<Types.ObjectId | null> {
    if (role !== 'manager' || employeeId == null || employeeId === '') {
      return null;
    }
    const id = String(employeeId);
    // The employees collection is company-scoped, so this only finds this
    // company's employees.
    if (
      !Types.ObjectId.isValid(id) ||
      !(await this.employeeModel.exists({ _id: id }))
    ) {
      throw new BadRequestException('Employee not found');
    }
    const taken = await this.userModel.exists({
      ...this.inCompany(companyId),
      employeeId: new Types.ObjectId(id),
      ...(userId ? { _id: { $ne: new Types.ObjectId(userId) } } : {}),
    });
    if (taken) {
      throw new ConflictException(
        'This employee is already linked to another user',
      );
    }
    return new Types.ObjectId(id);
  }

  private inCompany(companyId: string) {
    return { companyId: new Types.ObjectId(companyId) };
  }

  findAll(companyId: string): Promise<UserDocument[]> {
    return this.userModel
      .find(this.inCompany(companyId))
      .sort({ createdAt: 1 })
      .exec();
  }

  // Unscoped: used by the auth guard, which then checks the user's company.
  findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.userModel.findById(id).exec();
  }

  private async findInCompany(id: string, companyId: string) {
    const user = Types.ObjectId.isValid(id)
      ? await this.userModel
          .findOne({ _id: id, ...this.inCompany(companyId) })
          .exec()
      : null;
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  async emailTaken(email: string): Promise<boolean> {
    return !!(await this.userModel.exists({
      email: email.trim().toLowerCase(),
    }));
  }

  /** Creates a company user (admin or manager). */
  create(companyId: string, input: CreateUserInput) {
    return this.createUser(
      input,
      this.validateRole(input.role ?? 'manager'),
      companyId,
    );
  }

  private async createUser(
    input: CreateUserInput,
    role: Role,
    companyId: string,
  ): Promise<UserDocument> {
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!email || !EMAIL_RE.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
    if (!name) throw new BadRequestException('Name is required');
    const password = UsersService.validatePassword(input.password);

    if (await this.emailTaken(email)) {
      throw new ConflictException('A user with this email already exists');
    }
    const employeeId = await this.validateEmployeeLink(
      input.employeeId,
      role,
      companyId,
    );
    const user = await this.userModel.create({
      email,
      name,
      role,
      employeeId,
      companyId: new Types.ObjectId(companyId),
      passwordHash: await UsersService.hashPassword(password),
    });
    return (await this.findById(String(user._id)))!;
  }

  async update(
    id: string,
    companyId: string,
    actorId: string,
    input: UpdateUserInput,
  ): Promise<UserDocument> {
    const user = await this.findInCompany(id, companyId);

    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new BadRequestException('Name is required');
      user.name = name;
    }
    if (input.role !== undefined) user.role = this.validateRole(input.role);
    if (input.active !== undefined) user.active = Boolean(input.active);
    if (input.employeeId !== undefined || input.role !== undefined) {
      user.employeeId = await this.validateEmployeeLink(
        input.employeeId !== undefined ? input.employeeId : user.employeeId,
        user.role,
        companyId,
        id,
      );
    }

    // Never let an admin lock themselves out, and always keep one active admin.
    if (id === actorId && (user.role !== 'admin' || !user.active)) {
      throw new BadRequestException('You cannot remove your own admin access');
    }
    await this.ensureAnotherActiveAdmin(user, companyId);

    return user.save();
  }

  async setPassword(id: string, password: unknown, companyId?: string) {
    const valid = UsersService.validatePassword(password);
    const filter = companyId
      ? { _id: id, ...this.inCompany(companyId) }
      : { _id: id };
    const res = Types.ObjectId.isValid(id)
      ? await this.userModel
          .updateOne(filter, {
            passwordHash: await UsersService.hashPassword(valid),
          })
          .exec()
      : { matchedCount: 0 };
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
  }

  async verifyPassword(id: string, password: string): Promise<boolean> {
    const user = await this.userModel
      .findById(id)
      .select('+passwordHash')
      .exec();
    return !!user && bcrypt.compare(password, user.passwordHash);
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.findInCompany(id, companyId);
    user.active = false; // treat as no longer an active admin for the check below
    await this.ensureAnotherActiveAdmin(user, companyId);
    await this.userModel.deleteOne({ _id: id }).exec();
  }

  // Throws if saving `user` as-is would leave its company with no active admin.
  private async ensureAnotherActiveAdmin(
    user: UserDocument,
    companyId: string,
  ) {
    if (user.role === 'admin' && user.active) return;
    const others = await this.userModel
      .countDocuments({
        _id: { $ne: user._id },
        ...this.inCompany(companyId),
        role: 'admin',
        active: true,
      })
      .exec();
    if (others === 0) {
      throw new BadRequestException(
        'The company must keep at least one active admin',
      );
    }
  }
}
