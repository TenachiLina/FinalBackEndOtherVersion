import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ManagerVisibilityService } from './manager-visibility.service';
import type { AuthUser } from '../auth/auth.decorators';

// The service only needs the schema names; models are faked below.
jest.mock('../auth/user.schema', () => ({ User: { name: 'User' } }));
jest.mock('./employee.shema', () => ({ Employee: { name: 'Employee' } }));

const companyId = new Types.ObjectId().toString();
const me = new Types.ObjectId();
const other = new Types.ObjectId();
const myEmployee = { _id: new Types.ObjectId(), empNumber: 1 };
const otherEmployee = { _id: new Types.ObjectId(), empNumber: 2 };

// Just enough of a Mongoose model: find(filter).select().lean().exec()
function fakeModel<T>(rows: T[], match: (row: T, filter: any) => boolean) {
  return {
    find: (filter: any) => {
      const result = rows.filter((r) => match(r, filter));
      const query = {
        select: () => query,
        lean: () => query,
        exec: async () => result,
      };
      return query;
    },
  };
}

const users = [
  { _id: me, role: 'manager', employeeId: myEmployee._id },
  { _id: other, role: 'manager', employeeId: otherEmployee._id },
];
const userModel = fakeModel(
  users,
  (u, f) => u.role === f.role && String(u._id) !== String(f._id.$ne),
);
const employeeModel = fakeModel([myEmployee, otherEmployee], (e, f) =>
  f._id.$in.some((id: Types.ObjectId) => String(id) === String(e._id)),
);

const service = new ManagerVisibilityService(
  userModel as any,
  employeeModel as any,
);
const user = (role: AuthUser['role'], id = me): AuthUser => ({
  id: String(id),
  email: 'x@example.com',
  name: 'X',
  role,
  companyId,
});

describe('ManagerVisibilityService', () => {
  it('hides other managers from a manager, but not themselves', async () => {
    const hidden = await service.hiddenFor(user('manager'));
    expect([...hidden.empNumbers]).toEqual([2]);
    expect([...hidden.ids]).toEqual([String(otherEmployee._id)]);
  });

  it('hides nothing from an admin', async () => {
    const hidden = await service.hiddenFor(user('admin'));
    expect(hidden.empNumbers.size).toBe(0);
  });

  it('drops other managers from salary records', async () => {
    const rows = [{ emp_id: 1 }, { emp_id: 2 }, { emp_id: 3 }];
    expect(await service.filterRecords(user('manager'), rows)).toEqual([
      { emp_id: 1 },
      { emp_id: 3 },
    ]);
  });

  it("refuses changes to another manager's records", async () => {
    await expect(service.assertVisible(user('manager'), 2)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.assertVisible(user('manager'), '1')).resolves.toBe(
      undefined,
    );
  });
});
