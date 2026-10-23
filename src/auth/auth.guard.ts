import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Types } from 'mongoose';
import {
  FEATURE_KEY,
  IS_PUBLIC_KEY,
  KIOSK_KEY,
  NO_COMPANY_KEY,
  ROLES_KEY,
} from './auth.decorators';
import type { AuthUser, Role } from './auth.decorators';
import { SessionsService } from './sessions.service';
import type { JwtPayload } from './sessions.service';
import { UsersService } from './users.service';
import { AUTH_CODES } from './security.config';
import { clientInfo } from './client-info';
import { CompaniesService } from '../companies/companies.service';
import type { Feature } from '../companies/company.schema';
import { setCurrentCompany } from '../tenancy/tenant-context';

/**
 * Registered globally. For every route that is not @Public():
 * 1. checks the login token (signature, expiry, issuer) and that its login
 *    session is still open and expects this exact token
 * 2. checks the user is still active, and takes their role from the
 *    database: nothing the browser sends can change it
 * 3. works out the company (the user's own, or the one a super admin picked
 *    with the X-Company-Id header) and makes all data access use it
 * 4. checks the company is active and has the route's feature switched on
 * 5. checks the user's role
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly companiesService: CompaniesService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T>(key, targets);
    if (meta<boolean>(IS_PUBLIC_KEY)) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Not logged in');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch (err) {
      throw new UnauthorizedException({
        message: 'Session expired, please log in again',
        code:
          err instanceof TokenExpiredError
            ? AUTH_CODES.tokenExpired
            : AUTH_CODES.tokenInvalid,
      });
    }
    // The session must still be open and expect this exact token.
    const session = await this.sessions.checkAccess(payload, clientInfo(request));

    // Load the user on every request so deactivations and role changes apply immediately.
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException({
        message: 'Account is disabled',
        code: AUTH_CODES.sessionEnded,
      });
    }

    let companyId: string | null;
    if (user.role === 'superadmin') {
      const picked = request.headers['x-company-id'];
      companyId = typeof picked === 'string' && picked ? picked : null;
      if (companyId && !Types.ObjectId.isValid(companyId)) {
        throw new BadRequestException('This link or record ID is not valid');
      }
    } else {
      companyId = user.companyId ? String(user.companyId) : null;
      if (!companyId)
        throw new ForbiddenException('Your account has no company');
    }

    const company = companyId
      ? await this.companiesService.findById(companyId)
      : null;
    if (companyId && !company)
      throw new ForbiddenException('Company not found');
    if (company && !company.active && user.role !== 'superadmin') {
      // Not 401: the token is fine, the company is suspended.
      throw new ForbiddenException('This company account is suspended');
    }

    const authUser: AuthUser = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      companyId,
      sessionId: String(session._id),
    };
    request.user = authUser;
    request.company = company;
    setCurrentCompany(companyId);

    // Kiosk accounts are limited to the routes made for them.
    if (user.role === 'employee' && !meta<boolean>(KIOSK_KEY)) {
      throw new ForbiddenException(
        'This account can only clock employees in and out',
      );
    }

    if (!companyId && !meta<boolean>(NO_COMPANY_KEY)) {
      throw new ForbiddenException('Choose a company first');
    }

    const feature = meta<Feature>(FEATURE_KEY);
    if (feature && company && !company.features.includes(feature)) {
      throw new ForbiddenException(
        `The "${feature}" feature is not enabled for this company`,
      );
    }

    // A super admin working inside a company acts as that company's admin.
    const effectiveRole: Role =
      user.role === 'superadmin' && companyId ? 'admin' : user.role;
    const roles = meta<Role[]>(ROLES_KEY);
    if (
      roles?.length &&
      !roles.includes(effectiveRole) &&
      !(user.role === 'superadmin' && roles.includes('superadmin'))
    ) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
