import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { CompaniesService } from '../companies/companies.service';
import type { CompanyDocument } from '../companies/company.schema';
import type { UserDocument } from './user.schema';
import type { AuthUser } from './auth.decorators';
import { SessionsService } from './sessions.service';
import type { ClientInfo } from './sessions.service';
import { AUTH_CODES } from './security.config';

export type { JwtPayload } from './sessions.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const LOCKED_MESSAGE = 'Too many failed attempts. Try again in a few minutes.';

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
  // Unknown emails get the same lockout as real accounts (kept in memory),
  // so a "too many attempts" answer does not reveal which emails exist.
  // Real accounts are locked in the database (survives restarts).
  private unknownFailures = new Map<
    string,
    { count: number; lockedUntil: number }
  >();

  constructor(
    private readonly usersService: UsersService,
    private readonly companiesService: CompaniesService,
    private readonly sessions: SessionsService,
  ) {}

  async login(email: unknown, password: unknown, client: ClientInfo) {
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email ||
      !password
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const key = email.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(key);

    const unknown = this.unknownFailures.get(key);
    const locked = user
      ? !!user.lockedUntil && user.lockedUntil.getTime() > Date.now()
      : !!unknown && unknown.lockedUntil > Date.now();
    if (locked) {
      throw new HttpException(LOCKED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      if (user) {
        await this.usersService.recordFailedLogin(
          user._id as any,
          MAX_FAILED_ATTEMPTS,
          LOCK_MS,
        );
      } else {
        this.recordUnknownFailure(key);
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.usersService.clearFailedLogins(user._id as any);
    const company = await this.activeCompanyOf(user);
    const tokens = await this.sessions.create(user, client);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: toAuthUser(user),
      company: toCompanyInfo(company),
    };
  }

  /** New tokens for a refresh token (both are replaced: rotation). */
  async refresh(refreshToken: unknown, client: ClientInfo) {
    const tokens = await this.sessions.refresh(
      refreshToken,
      client,
      async (userId) => {
        const user = await this.usersService.findById(userId);
        if (!user || !user.active) {
          throw new UnauthorizedException({
            message: 'Account is disabled',
            code: AUTH_CODES.sessionEnded,
          });
        }
        await this.activeCompanyOf(user);
      },
    );
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  private async activeCompanyOf(user: UserDocument) {
    const company = user.companyId
      ? await this.companiesService.findById(String(user.companyId), {
          fresh: true,
        })
      : null;
    if (user.role !== 'superadmin' && (!company || !company.active)) {
      throw new ForbiddenException('This company account is suspended');
    }
    return company;
  }

  private recordUnknownFailure(key: string) {
    const entry = this.unknownFailures.get(key) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      entry.count = 0;
      entry.lockedUntil = Date.now() + LOCK_MS;
    }
    this.unknownFailures.set(key, entry);
    // Keep the map from growing without limit
    if (this.unknownFailures.size > 10000) {
      const now = Date.now();
      for (const [k, v] of this.unknownFailures) {
        if (v.lockedUntil < now) this.unknownFailures.delete(k);
      }
    }
  }

  /** Changes your own password and signs out your other devices. */
  async changePassword(
    userId: string,
    sessionId: string | undefined,
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
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'The new password must be different from the current one',
      );
    }
    await this.usersService.setPassword(userId, newPassword);
    await this.sessions.revokeAllForUser(userId, 'password_changed', {
      by: userId,
      keepSessionId: sessionId,
    });
  }
}
