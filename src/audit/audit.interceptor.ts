import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable, switchMap, tap } from 'rxjs';
import type { AuthUser } from '../auth/auth.decorators';
import { AuditService } from './audit.service';
import type { AuditEntry } from './audit.service';
import { actionFor, describeTarget, SKIP_AUDIT_KEY } from './audit-actions';
import { sanitize } from '../common/sanitize';
import { clientInfo } from '../auth/client-info';
import { AuditChanges } from './audit-changes';
import type { Snapshot } from './audit-changes';

const LOGGED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Registered globally. Writes one activity-log line for every change a user
 * makes (create, update, delete, clock-in, login…), whether it worked or not.
 * Reads are not logged. Runs after the auth guard, so requests refused for
 * lack of login or permission never reach it.
 *
 * For edits and deletes, the record is read before the action runs so the
 * log can show exactly what changed (see audit-changes.ts).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly changes: AuditChanges,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || !LOGGED_METHODS.has(request.method)) return next.handle();

    const route: string = request.route?.path ?? request.path;
    const action = actionFor(request.method, route, request.body);
    const isLogin = action === 'auth.login';
    const actor: AuthUser | undefined = request.user;
    // Public routes other than login have no user to log.
    if (!actor && !isLogin) return next.handle();

    const base = {
      action,
      method: request.method,
      path: request.originalUrl?.split('?')[0] ?? route,
      targetId: request.params?.id,
      details: isLogin ? undefined : sanitize(request.body),
      // From the trusted proxy setting, so it can't be faked by the client
      ip: clientInfo(request).ip,
    };
    const who = (user?: Partial<AuthUser> | null) => ({
      companyId: user?.companyId ?? null,
      userId: user?.id ?? null,
      userName: user?.name,
      userEmail: user?.email,
      userRole: user?.role,
    });

    // A failed snapshot must never block the user's action.
    const snapshot: Promise<Snapshot> = isLogin
      ? Promise.resolve(undefined)
      : this.changes.snapshot(action, request).catch(() => undefined);

    return from(snapshot).pipe(
      switchMap((before) =>
        next.handle().pipe(
          tap({
            next: (result) => {
              // Some attendance routes answer 200 with { status: 'error' }.
              const failed = result?.status === 'error';
              const entry = {
                ...base,
                ...who(isLogin ? result?.user : actor),
                target: describeTarget(request.body, result),
                success: !failed,
                error: failed ? String(result?.message ?? '') : undefined,
              };
              if (failed || isLogin) return this.write(entry);
              void this.changes
                .describe(action, request, result, before)
                .catch(() => undefined)
                .then((summary) => {
                  if (summary?.skip) return;
                  this.write({
                    ...entry,
                    action: summary?.action ?? entry.action,
                    target: summary?.target ?? entry.target,
                    changes: summary?.changes,
                  });
                });
            },
            error: (err) => {
              const entry = {
                ...base,
                target: describeTarget(request.body, null),
                success: false,
                statusCode:
                  err instanceof HttpException ? err.getStatus() : 500,
                error: err instanceof Error ? err.message : String(err),
              };
              if (isLogin) {
                void this.writeFailedLogin(entry, request.body?.email);
                return;
              }
              void this.changes
                .targetOf(action, request, before)
                .catch(() => undefined)
                .then((target) =>
                  this.write({
                    ...entry,
                    ...who(actor),
                    target: target ?? entry.target,
                  }),
                );
            },
          }),
        ),
      ),
    );
  }

  private write(entry: AuditEntry) {
    void this.audit.record(entry);
  }

  // Attach a failed login to the account it was for, so that company's
  // admins see it. Unknown emails are only visible to the super admin.
  private async writeFailedLogin(
    entry: Omit<AuditEntry, 'companyId' | 'userId'>,
    email: unknown,
  ) {
    const user =
      typeof email === 'string' && email
        ? await this.audit.findUserByEmail(email).catch(() => null)
        : null;
    this.write({
      ...entry,
      companyId: user?.companyId ? String(user.companyId) : null,
      userId: user ? String(user._id) : null,
      userName: user?.name,
      userEmail: user?.email ?? (typeof email === 'string' ? email : undefined),
      userRole: user?.role,
      target: undefined,
    });
  }
}
