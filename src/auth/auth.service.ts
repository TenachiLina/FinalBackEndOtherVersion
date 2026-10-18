import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { CompaniesService } from '../companies/companies.service';
import type { CompanyDocument } from '../companies/company.schema';
import type { UserDocument } from './user.schema';
import type { AuthUser, Role } from './auth.decorators';

export interface JwtPayload {
  sub: string;
  role: Role;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

// A real hash to compare against when the email is unknown, so the response
// time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export function toAuthUser(user: UserDocument): AuthUser {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId ? String(user.companyId) : null,
  };
}

/** What the frontend needs to know about the company it is working in. */
export function toCompanyInfo(company: CompanyDocument | null) {
  if (!company) return null;
  return {
    id: String(company._id),
    name: company.name,
    slug: company.slug ?? null,
    branding: company.branding ?? {},
    active: company.active,
    features: company.features,
    settings: company.settings,
  };
}

@Injectable()
export class AuthService {
  // In-memory brute-force protection, keyed by email. Resets on server restart.
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly companiesService: CompaniesService,
  ) {}

  async login(email: unknown, password: unknown) {
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email ||
      !password
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const key = email.trim().toLowerCase();
    const entry = this.failures.get(key);
    if (entry && entry.lockedUntil > Date.now()) {
      throw new HttpException(
        'Too many failed attempts. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findByEmailWithPassword(key);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      this.recordFailure(key);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.failures.delete(key);
    const company = user.companyId
      ? await this.companiesService.findById(String(user.companyId), {
          fresh: true,
        })
      : null;
    if (user.role !== 'superadmin' && (!company || !company.active)) {
      throw new ForbiddenException('This company account is suspended');
    }
    const payload: JwtPayload = { sub: String(user._id), role: user.role };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: toAuthUser(user),
      company: toCompanyInfo(company),
    };
  }

  private recordFailure(key: string) {
    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      entry.count = 0;
      entry.lockedUntil = Date.now() + LOCK_MS;
    }
    this.failures.set(key, entry);
  }

  async changePassword(
    userId: string,
    currentPassword: unknown,
    newPassword: unknown,
  ) {
    if (
      typeof currentPassword !== 'string' ||
      !(await this.usersService.verifyPassword(userId, currentPassword))
    ) {
      // 400, not 401: a 401 makes the frontend treat the session as expired.
      throw new BadRequestException('Current password is incorrect');
    }
    await this.usersService.setPassword(userId, newPassword);
  }
}
