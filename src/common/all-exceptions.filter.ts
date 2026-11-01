import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { TenantContextError } from '../tenancy/tenant.plugin';
import { pickLang, translateMessage } from './messages.i18n';
import { sanitize } from './sanitize';
import { clientInfo } from '../auth/client-info';
import { newReference, reportError } from '../error-logs/error-reporter';

// Field names as people say them, for messages like "first name is required".
const FIELD_LABELS: Record<string, string> = {
  empNumber: 'employee number',
  emp_id: 'employee',
  empId: 'employee',
  taskId: 'task number',
  taskName: 'task name',
  firstName: 'first name',
  lastName: 'last name',
  baseSalary: 'base salary',
  phoneNumber: 'phone number',
  startTime: 'start time',
  endTime: 'end time',
  shiftId: 'shift',
  planDate: 'date',
  deviceLogId: 'device record',
  deviceUserId: 'device user',
  slug: 'sign-in link name',
  'devices.serial': 'device serial',
  email: 'email',
};

function label(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const last = field.split('.').pop() ?? field;
  return (
    FIELD_LABELS[last] ??
    last
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Turns every error into a JSON answer the app can show as is:
 * { statusCode, error, message }.
 * - Nest HTTP exceptions keep their status and message
 * - database errors (bad ID, missing field, duplicate) become 400/409 with a
 *   plain explanation instead of "Internal server error"
 * - anything unexpected is logged in full and answered with a generic 500
 *   plus a reference code
 * - errors are saved to the system error log (see error-logs/)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;
    const request = http.getRequest();
    const { status, message, code, usageCount } =
      AllExceptionsFilter.translate(exception);
    // A code the user can pass on, to find this exact error in the log
    const reference = status >= 500 ? newReference() : undefined;
    this.record(exception, request, status, message, reference);

    // Answer in the user's language (the app sends Accept-Language)
    const lang = pickLang(request?.headers?.['accept-language']);
    const localized = Array.isArray(message)
      ? message.map((m) => translateMessage(m, lang))
      : translateMessage(message, lang);
    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
      message: localized,
      ...(code && { code }),
      ...(usageCount !== undefined && { usageCount }),
      ...(reference && { reference }),
    });
  }

  /**
   * Saves the error to the system error log with the request it came from.
   * 5xx are errors (something broke); 4xx are warnings (the app refused
   * something on purpose). Expired sessions and unknown URLs are skipped:
   * they are normal and would drown the rest.
   */
  private record(
    exception: unknown,
    request: any,
    status: number,
    message: string | string[],
    reference?: string,
  ) {
    if (status >= 500 && !(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error
          ? (exception.stack ?? exception.message)
          : JSON.stringify(exception),
      );
    }
    if (!request) return;
    if (status === 401 || (status === 404 && !request.route)) return;
    const user = request.user;
    reportError(exception, {
      level: status >= 500 ? 'error' : 'warning',
      source: 'request',
      reference,
      statusCode: status,
      // For refusals, the message the user saw; for crashes, the real one
      message:
        status < 500
          ? Array.isArray(message)
            ? message.join('. ')
            : message
          : undefined,
      method: request.method,
      path: request.originalUrl?.split('?')[0],
      route: request.route?.path,
      query: sanitize(request.query),
      body: sanitize(request.body),
      userAgent: request.headers?.['user-agent'],
      ip: clientInfo(request).ip,
      ...(user && {
        companyId: user.companyId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
      }),
    });
  }

  /** What the user is told about an error. The activity log says the same. */
  static translate(e: any): {
    status: number;
    message: string | string[];
    code?: string;
    usageCount?: number;
  } {
    if (e instanceof HttpException) {
      const body = e.getResponse() as any;
      // A machine-readable reason, e.g. TOKEN_EXPIRED (see auth/security.config.ts)
      const code = typeof body?.code === 'string' ? body.code : undefined;
      const message = typeof body === 'string' ? body : (body?.message ?? e.message);
      const usageCount = typeof body?.usageCount === 'number' ? body.usageCount : undefined;
      // Nest reports unreadable request bodies with the JSON parser's own text
      if (
        e.getStatus() === 400 &&
        typeof message === 'string' &&
        /JSON|Unexpected token/i.test(message)
      ) {
        return { status: 400, message: 'The data sent was not valid' };
      }
      return { status: e.getStatus(), message, code, usageCount };
    }

    if (e instanceof TenantContextError) {
      return { status: 403, message: 'Choose a company first' };
    }

    // Mongoose: a value that can't be read as the expected type (e.g. a bad ID)
    if (e?.name === 'CastError') {
      return e.kind === 'ObjectId'
        ? { status: 400, message: 'This link or record ID is not valid' }
        : {
            status: 400,
            message: `${capitalize(label(e.path))} has an invalid value`,
          };
    }

    // Mongoose: required fields, min/max, enums…
    if (e?.name === 'ValidationError' && e.errors) {
      const messages = Object.values<any>(e.errors).map((err) => {
        const field = capitalize(label(err.path));
        switch (err.kind) {
          case 'required':
            return `${field} is required`;
          case 'min':
            return `${field} is too small`;
          case 'max':
            return `${field} is too large`;
          case 'enum':
            return `${field} has a value that isn't allowed`;
          default:
            return `${field} has an invalid value`;
        }
      });
      return { status: 400, message: messages };
    }

    // MongoDB: unique index violated
    if (e?.code === 11000) {
      const fields = Object.keys(e.keyValue ?? e.keyPattern ?? {}).filter(
        (f) => f !== 'companyId',
      );
      const what = fields.length ? label(fields[0]) : 'value';
      const value = fields.length ? e.keyValue?.[fields[0]] : undefined;
      return {
        status: 409,
        message:
          value !== undefined && typeof value !== 'object'
            ? `The ${what} "${value}" is already used`
            : `This ${what} is already used`,
      };
    }

    // Request body that isn't valid JSON
    if (e?.type === 'entity.parse.failed') {
      return { status: 400, message: 'The data sent was not valid' };
    }
    if (e?.type === 'entity.too.large') {
      return { status: 413, message: 'The data sent is too large' };
    }

    return {
      status: 500,
      message: 'Something went wrong on our side. Please try again.',
    };
  }
}
