import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Feature } from '../companies/company.schema';

// superadmin: the product owner; manages companies and has no company of its own.
// admin / manager: users inside one company.
// employee: a shared clock-in kiosk account; can only clock employees in and out.
export type Role = 'superadmin' | 'admin' | 'manager' | 'employee';
export const COMPANY_ROLES: Role[] = ['admin', 'manager', 'employee'];

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const FEATURE_KEY = 'feature';
export const NO_COMPANY_KEY = 'noCompany';
export const KIOSK_KEY = 'kioskAllowed';

// Skips authentication entirely (login, health check, attendance device).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Restricts a route or controller to the given roles.
// Without it, any logged-in admin or manager can access the route
// (employee kiosk accounts additionally need @KioskAllowed()).
// A super admin working inside a company counts as that company's admin.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// The route only works when the company has this feature switched on.
export const RequireFeature = (feature: Feature) =>
  SetMetadata(FEATURE_KEY, feature);

// The route works without a company (e.g. a super admin's own account pages).
export const AllowNoCompany = () => SetMetadata(NO_COMPANY_KEY, true);

// Employee (kiosk) accounts may use this route. They are refused everywhere else.
export const KioskAllowed = () => SetMetadata(KIOSK_KEY, true);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  // The company this request works for: the user's own company, or the one
  // a super admin chose with the X-Company-Id header. Null otherwise.
  companyId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
