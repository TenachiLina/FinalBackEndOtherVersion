import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

export type Role = 'admin' | 'manager';
export const ROLES: Role[] = ['admin', 'manager'];

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

// Skips authentication entirely (login, health check, attendance device).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Restricts a route or controller to the given roles.
// Without it, any logged-in user (admin or manager) can access the route.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
