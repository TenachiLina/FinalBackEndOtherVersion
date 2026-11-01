import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

// When the activity log itself fails, the user's action must still go through
// and the entry is still written with what is known.

const user = {
  id: 'u1',
  name: 'Boss',
  email: 'b@x.dz',
  role: 'admin',
  companyId: 'c1',
};

function setup(
  changes: Record<string, jest.Mock>,
  findUserByEmail = jest.fn(),
) {
  const written: any[] = [];
  const audit = {
    record: jest.fn(async (e: any) => void written.push(e)),
    findUserByEmail,
  };
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const interceptor = new AuditInterceptor(
    reflector,
    audit as any,
    changes as any,
  );
  const run = (request: any, handle: () => any) =>
    lastValueFrom(
      interceptor.intercept(
        {
          switchToHttp: () => ({ getRequest: () => request }),
          getHandler: () => undefined,
          getClass: () => undefined,
        } as any,
        { handle },
      ),
    );
  return { written, run };
}

const settle = () => new Promise((r) => setTimeout(r, 10));
const failing = () => jest.fn(() => Promise.reject(new Error('db down')));

it('still runs the action and logs it when reading the record before fails', async () => {
  const { written, run } = setup({
    snapshot: failing(),
    describe: jest.fn(async () => undefined),
  });
  const req = {
    method: 'PUT',
    route: { path: '/employees/:id' },
    params: { id: 'e1' },
    body: { firstName: 'Ali' },
    user,
  };
  await expect(
    run(req, () => of({ _id: 'e1', firstName: 'Ali' })),
  ).resolves.toEqual({ _id: 'e1', firstName: 'Ali' });
  await settle();
  expect(written).toEqual([
    expect.objectContaining({
      action: 'employee.update',
      success: true,
      target: 'Ali',
      userId: 'u1',
    }),
  ]);
});

it('still logs the action when working out what changed fails', async () => {
  const { written, run } = setup({
    snapshot: jest.fn(async () => undefined),
    describe: failing(),
  });
  const req = {
    method: 'POST',
    route: { path: '/tasks' },
    body: { taskName: 'Till' },
    user,
  };
  await run(req, () => of({ taskName: 'Till' }));
  await settle();
  expect(written).toEqual([
    expect.objectContaining({
      action: 'task.create',
      target: 'Till',
      changes: undefined,
    }),
  ]);
});

it('still logs a failed action when naming its record fails', async () => {
  const { written, run } = setup({
    snapshot: jest.fn(async () => undefined),
    targetOf: failing(),
  });
  const req = {
    method: 'DELETE',
    route: { path: '/shifts/:id' },
    params: { id: 's1' },
    body: {},
    user,
  };
  await expect(
    run(req, () => throwError(() => new NotFoundException('Shift not found'))),
  ).rejects.toThrow('Shift not found');
  await settle();
  expect(written).toEqual([
    expect.objectContaining({
      action: 'shift.delete',
      success: false,
      statusCode: 404,
    }),
  ]);
});

it('logs a route that answers 200 with { status: "error" } as failed', async () => {
  const { written, run } = setup({ snapshot: jest.fn(async () => undefined) });
  const req = {
    method: 'POST',
    route: { path: '/attendance/sync' },
    body: {},
    user,
  };
  await run(req, () => of({ status: 'error', message: 'Device unreachable' }));
  await settle();
  expect(written).toEqual([
    expect.objectContaining({
      action: 'attendance.sync',
      success: false,
      error: 'Device unreachable',
    }),
  ]);
});

it('logs a failed sign-in for an unknown email, and copes when the lookup fails', async () => {
  const { written, run } = setup(
    {},
    jest.fn(() => Promise.reject(new Error('db down'))),
  );
  const req = {
    method: 'POST',
    route: { path: '/auth/login' },
    body: { email: 'x@y.dz', password: 'p' },
  };
  const err = Object.assign(new Error('Invalid email or password'), {});
  await expect(run(req, () => throwError(() => err))).rejects.toThrow();
  await settle();
  expect(written).toEqual([
    expect.objectContaining({
      action: 'auth.login',
      success: false,
      statusCode: 500,
      userEmail: 'x@y.dz',
      userId: null,
    }),
  ]);
});

it('skips reads, and public routes other than sign-in', async () => {
  const { written, run } = setup({});
  await run({ method: 'GET', route: { path: '/employees' }, user }, () =>
    of([]),
  );
  await run(
    { method: 'POST', route: { path: '/auth/refresh' }, body: {} },
    () => of({}),
  );
  await settle();
  expect(written).toEqual([]);
});
