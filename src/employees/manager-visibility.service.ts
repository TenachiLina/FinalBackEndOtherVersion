import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../auth/user.schema';
import type { AuthUser } from '../auth/auth.decorators';
import { Employee, EmployeeDocument } from './employee.shema';

export interface HiddenEmployees {
  ids: Set<string>;
  empNumbers: Set<number>;
}

const NONE: HiddenEmployees = { ids: new Set(), empNumbers: new Set() };

/**
 * A manager doesn't see other managers on salary pages: their salary and
 * contact details, advances, bonuses and worked-hours report. Planning and
 * clock-in still show everyone. A manager's employee record is the one
 * linked to their user account (User.employeeId).
 */
@Injectable()
export class ManagerVisibilityService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  /** Employees this user may not see on salary pages. Empty for admins. */
  async hiddenFor(user: AuthUser): Promise<HiddenEmployees> {
    if (user.role !== 'manager' || !user.companyId) return NONE;
    const managers = await this.userModel
      .find({
        companyId: new Types.ObjectId(user.companyId),
        role: 'manager',
        employeeId: { $ne: null },
        _id: { $ne: new Types.ObjectId(user.id) },
      })
      .select('employeeId')
      .lean()
      .exec();
    if (!managers.length) return NONE;

    const employees = await this.employeeModel
      .find({ _id: { $in: managers.map((m) => m.employeeId) } })
      .select('empNumber')
      .lean()
      .exec();
    return {
      ids: new Set(employees.map((e) => String(e._id))),
      empNumbers: new Set(employees.map((e) => Number(e.empNumber))),
    };
  }

  /** True when this employee record is the one linked to the manager's own account. */
  async isOwnRecord(user: AuthUser, employeeId: string): Promise<boolean> {
    if (user.role !== 'manager') return false;
    const me = await this.userModel
      .findById(user.id)
      .select('employeeId')
      .lean()
      .exec();
    return !!me?.employeeId && String(me.employeeId) === String(employeeId);
  }

  /** Throws when this user may not see this employee's salary data. */
  async assertVisible(user: AuthUser, empNumber: unknown) {
    const hidden = await this.hiddenFor(user);
    if (hidden.empNumbers.has(Number(empNumber))) {
      throw new ForbiddenException(
        "You can't see or change another manager's information",
      );
    }
  }

  /** Drops the records of hidden employees (records keyed by employee number). */
  async filterRecords<T extends { emp_id?: unknown }>(
    user: AuthUser,
    records: T[],
  ): Promise<T[]> {
    const hidden = await this.hiddenFor(user);
    if (!hidden.empNumbers.size) return records;
    return records.filter((r) => !hidden.empNumbers.has(Number(r.emp_id)));
  }
}
