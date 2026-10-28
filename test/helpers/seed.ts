import { Types } from 'mongoose';
import type { Role } from '../../src/auth/auth.decorators';
import type { Feature } from '../../src/companies/company.schema';
import { runAsSystem, runForCompany } from '../../src/tenancy/tenant-context';
import { api, type Api, type TestApp } from './app';

export const PASSWORD = 'Str0ng-pass-1';

// bcrypt with cost 12 takes ~250 ms: hash the shared password once per file
let hash: Promise<string> | undefined;
function passwordHash() {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const { UsersService } = require('../../src/auth/users.service');
  return (hash ??= UsersService.hashPassword(PASSWORD));
}

let counter = 0;
const next = () => ++counter;

export interface SeededUser {
  id: string;
  email: string;
  role: Role;
  companyId: string | null;
}

/**
 * Builds test data straight in the database (no HTTP, no audit log).
 * Data belonging to a company is written inside that company's context,
 * as the tenant plugin requires.
 */
export function seeder(t: TestApp) {
  const inCompany = <T>(companyId: string, fn: () => Promise<T>) =>
    runForCompany(companyId, fn);

  return {
    async company(
      overrides: Partial<{
        name: string;
        slug: string;
        active: boolean;
        features: Feature[];
        settings: Record<string, unknown>;
        devices: { serial: string; name?: string }[];
      }> = {},
    ) {
      const n = next();
      const doc = await runAsSystem(() =>
        t.model('Company').create({ name: `Company ${n}`, ...overrides }),
      );
      return { ...doc.toObject(), id: String(doc._id) };
    },

    async user(
      role: Role,
      companyId: string | null,
      overrides: Partial<{
        email: string;
        name: string;
        active: boolean;
        employeeId: string;
      }> = {},
    ): Promise<SeededUser> {
      const n = next();
      const doc = await t.model('User').create({
        email: `${role}${n}@test.dz`,
        name: `${role} ${n}`,
        role,
        companyId: role === 'superadmin' ? null : companyId,
        passwordHash: await passwordHash(),
        ...overrides,
      });
      return {
        id: String(doc._id),
        email: doc.email,
        role,
        companyId: doc.companyId ? String(doc.companyId) : null,
      };
    },

    employee(companyId: string, overrides: Record<string, unknown> = {}) {
      const n = next();
      return inCompany(companyId, () =>
        t.model('Employee').create({
          empNumber: n,
          firstName: `First${n}`,
          lastName: `Last${n}`,
          baseSalary: 30000,
          ...overrides,
        }),
      );
    },

    shift(companyId: string, overrides: Record<string, unknown> = {}) {
      return inCompany(companyId, () =>
        t
          .model('Shift')
          .create({ startTime: '08:00', endTime: '16:00', ...overrides }),
      );
    },

    task(companyId: string, overrides: Record<string, unknown> = {}) {
      const n = next();
      return inCompany(companyId, () =>
        t
          .model('Task')
          .create({ taskId: n, taskName: `Task ${n}`, ...overrides }),
      );
    },

    planning(
      companyId: string,
      fields: {
        empId: string;
        shiftId: string;
        planDate: Date | string;
      } & Record<string, unknown>,
    ) {
      return inCompany(companyId, () =>
        t.model('Planning').create({ taskId: 1, ...fields }),
      );
    },

    worktime(
      companyId: string,
      fields: { emp_id: number } & Record<string, unknown>,
    ) {
      return inCompany(companyId, () => t.model('Worktime').create(fields));
    },

    advance(
      companyId: string,
      fields: { emp_id: number; amount: number; date: Date | string } & Record<
        string,
        unknown
      >,
    ) {
      return inCompany(companyId, () => t.model('Advance').create(fields));
    },

    bonus(
      companyId: string,
      fields: { emp_id: number; amount: number; date: string; reason?: string },
    ) {
      return inCompany(companyId, () =>
        t.model('Bonus').create({ reason: 'Good work', ...fields }),
      );
    },

    /** Reads a company's documents, as the app would see them. */
    find(
      companyId: string,
      model: string,
      filter: Record<string, unknown> = {},
    ) {
      return inCompany(companyId, () => t.model(model).find(filter).lean());
    },
  };
}

/** Logs in through POST /auth/login and returns an API client using the token. */
export async function loginAs(
  t: TestApp,
  user: Pick<SeededUser, 'email'>,
  opts: { companyId?: string } = {},
): Promise<Api & { token: string }> {
  const res = await api(t.app)
    .post('/auth/login')
    .send({ email: user.email, password: PASSWORD });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `login ${user.email} failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const token: string = res.body.accessToken;
  return Object.assign(api(t.app, { token, companyId: opts.companyId }), {
    token,
  });
}

/** A valid-looking id that matches nothing. */
export const unknownId = () => String(new Types.ObjectId());
