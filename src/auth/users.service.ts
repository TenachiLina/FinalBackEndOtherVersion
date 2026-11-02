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
import { SessionsService } from './sessions.service';

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt ignores everything after 72 bytes, so longer passwords would give a
// false sense of strength.
export const MAX_PASSWORD_BYTES = 72;
// Passwords attackers try first. Compared without case.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', 'qwerty123', 'azerty123', 'abc12345', 'iloveyou1', 'admin123',
  'welcome1', 'letmein1', '11111111', '00000000', 'motdepasse', 'motdepasse1',
  'qwertyuiop', 'azertyuiop', 'changeme1', 'admin1234', 'test1234',
]);
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
    private readonly sessions: SessionsService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  /** Password rules, checked on the server whatever the app sends. */
  static validatePassword(password: unknown, email?: string): string {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      throw new BadRequestException('Password is too long (72 characters max)');
    }
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one letter and one number',
      );
    }
    const lower = password.toLowerCase();
    const emailName = email?.split('@')[0]?.toLowerCase();
    if (
      COMMON_PASSWORDS.has(lower) ||
      (emailName && emailName.length >= 4 && lower.includes(emailName))
    ) {
      throw new BadRequestException(
        'This password is too easy to guess. Choose another one.',
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
      .select('+passwordHash +lockedUntil')
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
    const password = UsersService.validatePassword(input.password, email);

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
      passwordChangedAt: new Date(),
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
    const roleBefore = user.role;
    const activeBefore = user.active;
    const employeeIdBefore = user.employeeId;

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

    const saved = await user.save();

    // Two requests can pass the check above at the same moment. Count again
    // after saving, and undo this change if it left the company with no admin.
    const removedAnAdmin =
      roleBefore === 'admin' &&
      activeBefore &&
      (saved.role !== 'admin' || !saved.active);
    if (removedAnAdmin && !(await this.hasActiveAdmin(companyId))) {
      await this.userModel
        .updateOne(
          { _id: saved._id },
          { role: roleBefore, active: activeBefore, employeeId: employeeIdBefore },
        )
        .exec();
      throw new BadRequestException(
        'The company must keep at least one active admin',
      );
    }

    // A changed role or a disabled account signs the person out everywhere,
    // so no token keeps working with the old rights.
    if (!saved.active && activeBefore) {
      await this.sessions.revokeAllForUser(id, 'account_disabled', { by: actorId });
    } else if (saved.role !== roleBefore) {
      await this.sessions.revokeAllForUser(id, 'role_changed', { by: actorId });
    }
    return saved;
  }

  /**
   * Sets a new password. Doesn't end sessions: callers decide (an admin reset
   * ends them all, changing your own keeps the current one).
   */
  async setPassword(id: string, password: unknown, companyId?: string) {
    const filter = companyId
      ? { _id: id, ...this.inCompany(companyId) }
      : { _id: id };
    const user = Types.ObjectId.isValid(id)
      ? await this.userModel.findOne(filter).exec()
      : null;
    if (!user) throw new NotFoundException('User not found');
    const valid = UsersService.validatePassword(password, user.email);
    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          passwordHash: await UsersService.hashPassword(valid),
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      )
      .exec();
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
    const wasActiveAdmin = user.role === 'admin' && user.active;
    user.active = false; // treat as no longer an active admin for the check below
    await this.ensureAnotherActiveAdmin(user, companyId);

    if (wasActiveAdmin) {
      // Deactivate first, count again, and only then delete. A concurrent
      // request can't leave the company without an admin.
      await this.userModel.updateOne({ _id: id }, { active: false }).exec();
      if (!(await this.hasActiveAdmin(companyId))) {
        await this.userModel.updateOne({ _id: id }, { active: true }).exec();
        throw new BadRequestException(
          'The company must keep at least one active admin',
        );
      }
    }
    await this.userModel.deleteOne({ _id: id }).exec();
    await this.sessions.revokeAllForUser(id, 'account_deleted', { by: actorId });
  }

  // ── Brute-force protection (used by AuthService.login) ──────────────────

  /** Counts a wrong password; locks the account after `max` in a row. */
  async recordFailedLogin(id: Types.ObjectId, max: number, lockMs: number) {
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: id },
        { $inc: { failedLoginAttempts: 1 } },
        { new: true },
      )
      .select('+failedLoginAttempts')
      .exec();
    if (user && user.failedLoginAttempts >= max) {
      await this.userModel
        .updateOne(
          { _id: id },
          { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + lockMs) },
        )
        .exec();
    }
  }

  async clearFailedLogins(id: Types.ObjectId) {
    await this.userModel
      .updateOne({ _id: id }, { failedLoginAttempts: 0, lockedUntil: null })
      .exec();
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
  private async hasActiveAdmin(companyId: string): Promise<boolean> {
    return !!(await this.userModel.exists({
      ...this.inCompany(companyId),
      role: 'admin',
      active: true,
    }));
  }
}
