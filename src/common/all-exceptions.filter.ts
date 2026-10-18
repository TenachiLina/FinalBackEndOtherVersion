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
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    const { status, message } = this.translate(exception);
    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
      message,
    });
  }

  private translate(e: any): { status: number; message: string | string[] } {
    if (e instanceof HttpException) {
      const body = e.getResponse() as any;
      const message =
        typeof body === 'string' ? body : (body?.message ?? e.message);
      // Nest reports unreadable request bodies with the JSON parser's own text
      if (
        e.getStatus() === 400 &&
        typeof message === 'string' &&
        /JSON|Unexpected token/i.test(message)
      ) {
        return { status: 400, message: 'The data sent was not valid' };
      }
      return { status: e.getStatus(), message };
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

    this.logger.error(
      e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e),
    );
    return {
      status: 500,
      message: 'Something went wrong on our side. Please try again.',
    };
  }
}
