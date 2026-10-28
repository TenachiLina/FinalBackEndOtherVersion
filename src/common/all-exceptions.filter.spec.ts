import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { TenantContextError } from '../tenancy/tenant.plugin';
import { type ErrorReport, setErrorWriter } from '../error-logs/error-reporter';

let reports: ErrorReport[];
beforeEach(() => {
  reports = [];
  setErrorWriter(async (r) => {
    reports.push(r);
  });
});

function request(over: any = {}) {
  return {
    method: 'POST',
    originalUrl: '/employees?draft=1',
    route: { path: '/employees' },
    query: { draft: '1' },
    body: { firstName: 'Ali', password: 'secret' },
    headers: { 'user-agent': 'Chrome', 'accept-language': 'en' },
    ip: '::ffff:203.0.113.5',
    ...over,
  };
}

/** Runs the filter and returns { status, body } as the client would see them. */
function handle(exception: unknown, req: any = request(), headersSent = false) {
  let status = 0;
  let body: any;
  const res: any = {
    headersSent,
    status: (s: number) => ((status = s), res),
    json: (b: any) => ((body = b), res),
  };
  const host: any = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  };
  // Nest's logger prints unexpected errors; the output isn't under test
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

function castError(path: string, kind: string) {
  return new MongooseError.CastError(kind, 'x', path);
}

function validationError(errors: Record<string, string>) {
  const e = new MongooseError.ValidationError();
  for (const [path, kind] of Object.entries(errors)) {
    e.errors[path] = Object.assign(new MongooseError.ValidatorError({ path }), {
      kind,
    });
  }
  return e;
}

afterEach(() => jest.restoreAllMocks());

describe('HTTP exceptions', () => {
  it('keep their status and message', () => {
    expect(handle(new NotFoundException('Shift not found'))).toEqual({
      status: 404,
      body: { statusCode: 404, error: 'not found', message: 'Shift not found' },
    });
  });

  it('pass on a machine-readable code', () => {
    const e = new UnauthorizedException({
      message: 'Session expired, please log in again',
      code: 'TOKEN_EXPIRED',
    });
    expect(handle(e).body).toEqual({
      statusCode: 401,
      error: 'unauthorized',
      message: 'Session expired, please log in again',
      code: 'TOKEN_EXPIRED',
    });
  });

  it('keep a list of messages', () => {
    const e = new BadRequestException([
      'First name is required',
      'Last name is required',
    ]);
    expect(handle(e).body.message).toEqual([
      'First name is required',
      'Last name is required',
    ]);
  });

  it("hide the JSON parser's own text", () => {
    const e = new BadRequestException(
      'Unexpected token } in JSON at position 12',
    );
    expect(handle(e).body.message).toBe('The data sent was not valid');
  });
});

describe('database errors', () => {
  it('a bad record ID is a 400 with a plain message', () => {
    expect(handle(castError('_id', 'ObjectId'))).toMatchObject({
      status: 400,
      body: { message: 'This link or record ID is not valid' },
    });
  });

  it('a value of the wrong type names the field as people say it', () => {
    expect(handle(castError('baseSalary', 'Number')).body.message).toBe(
      'Base salary has an invalid value',
    );
    expect(
      handle(castError('settings.hoursPerDay', 'Number')).body.message,
    ).toBe('Hours per day has an invalid value');
    expect(handle(castError('work_date', 'date')).body.message).toBe(
      'Work date has an invalid value',
    );
  });

  it('validation errors list each field', () => {
    const e = validationError({
      firstName: 'required',
      amount: 'min',
      hoursPerDay: 'max',
      role: 'enum',
      'devices.serial': 'user defined',
    });
    expect(handle(e)).toMatchObject({
      status: 400,
      body: {
        message: [
          'First name is required',
          'Amount is too small',
          'Hours per day is too large',
          "Role has a value that isn't allowed",
          'Device serial has an invalid value',
        ],
      },
    });
  });

  it('a duplicate becomes a 409 naming the value, never the company', () => {
    const dup = { code: 11000, keyValue: { companyId: 'c1', empNumber: 12 } };
    expect(handle(dup)).toMatchObject({
      status: 409,
      body: { message: 'The employee number "12" is already used' },
    });
    expect(handle({ code: 11000, keyPattern: { email: 1 } }).body.message).toBe(
      'This email is already used',
    );
    expect(
      handle({ code: 11000, keyValue: { companyId: 'c1' } }).body.message,
    ).toBe('This value is already used');
    expect(
      handle({ code: 11000, keyValue: { tags: ['a'] } }).body.message,
    ).toBe('This tags is already used');
  });

  it('no company context is a 403', () => {
    expect(handle(new TenantContextError('Employee'))).toMatchObject({
      status: 403,
      body: { message: 'Choose a company first' },
    });
  });
});

describe('request bodies', () => {
  it('unreadable JSON is a 400', () => {
    expect(handle({ type: 'entity.parse.failed' })).toMatchObject({
      status: 400,
      body: { message: 'The data sent was not valid' },
    });
  });

  it('too large is a 413', () => {
    expect(handle({ type: 'entity.too.large' })).toMatchObject({
      status: 413,
      body: {
        error: 'payload too large',
        message: 'The data sent is too large',
      },
    });
  });
});

describe('unexpected errors', () => {
  it('answer a generic 500 with a reference, and log the real error', () => {
    const { status, body } = handle(
      new TypeError("Cannot read properties of undefined (reading 'x')"),
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      statusCode: 500,
      error: 'internal server error',
      message: 'Something went wrong on our side. Please try again.',
      reference: expect.stringMatching(/^[0-9A-F]{8}$/),
    });
    expect(reports[0]).toMatchObject({
      level: 'error',
      reference: body.reference,
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'x')",
    });
  });

  it('also handle things that are not errors', () => {
    expect(handle('boom').status).toBe(500);
    expect(handle(null).status).toBe(500);
  });
});

describe('language', () => {
  it("answers in the user's language", () => {
    const req = request({ headers: { 'accept-language': 'fr' } });
    expect(
      handle(
        new ForbiddenException('You do not have permission to do this'),
        req,
      ).body.message,
    ).toBe("Vous n'avez pas l'autorisation de faire cela");
  });

  it('translates each message of a list', () => {
    const req = request({ headers: { 'accept-language': 'ar' } });
    expect(
      handle(validationError({ firstName: 'required' }), req).body.message,
    ).toEqual(['الاسم الشخصي مطلوب']);
  });
});

describe('the error log', () => {
  it('records a refusal as a warning, with the request and the user, without secrets', () => {
    const req = request({
      user: {
        id: 'u1',
        name: 'Mia',
        email: 'mia@test.dz',
        role: 'manager',
        companyId: 'c1',
      },
    });
    handle(
      new ForbiddenException('You do not have permission to do this'),
      req,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      level: 'warning',
      source: 'request',
      statusCode: 403,
      message: 'You do not have permission to do this',
      method: 'POST',
      path: '/employees',
      route: '/employees',
      query: { draft: '1' },
      body: { firstName: 'Ali' },
      ip: '203.0.113.5',
      userAgent: 'Chrome',
      companyId: 'c1',
      userId: 'u1',
      userName: 'Mia',
      userEmail: 'mia@test.dz',
      userRole: 'manager',
    });
    expect(reports[0].body).not.toHaveProperty('password');
    expect(reports[0].reference).toBeUndefined();
  });

  it('joins a list of messages', () => {
    handle(validationError({ firstName: 'required', lastName: 'required' }));
    expect(reports[0].message).toBe(
      'First name is required. Last name is required',
    );
  });

  it('skips expired sessions and unknown URLs, which are normal', () => {
    handle(new UnauthorizedException('Not logged in'));
    handle(
      new NotFoundException('Cannot GET /nope'),
      request({ route: undefined }),
    );
    expect(reports).toHaveLength(0);
  });

  it('still records a 404 from a real route', () => {
    handle(new NotFoundException('Shift not found'));
    expect(reports).toHaveLength(1);
  });
});

it('does nothing once the answer was already sent', () => {
  expect(handle(new Error('late'), request(), true)).toEqual({
    status: 0,
    body: undefined,
  });
  expect(reports).toHaveLength(0);
});

it('works without a request', () => {
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => ({
        headersSent: false,
        status: () => ({ json: () => undefined }),
      }),
      getRequest: () => undefined,
    }),
  };
  expect(() =>
    new AllExceptionsFilter().catch(new NotFoundException(), host),
  ).not.toThrow();
  expect(reports).toHaveLength(0);
});
