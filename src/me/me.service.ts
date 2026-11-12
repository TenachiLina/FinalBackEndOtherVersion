import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import { User, UserDocument } from '../auth/user.schema';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import { Planning, PlanningDocument } from '../planning/planning.shema';
import { getBackupIds } from '../planning/backups.util';
import { Shift, ShiftDocument } from '../shifts/shift.shema';
import { Task, TaskDocument } from '../tasks/task.schema';
import { Worktime, WorktimeDocument } from '../worktime/worktime.shema';
import { Advance, AdvanceDocument } from '../advances/advance.schema';
import { Bonus } from '../bonuses/bonus.schema';
import { dayOf, parseMonth } from './month.util';

type Person = { id: string; firstName: string; lastName: string };

/**
 * What an employee may read about themselves. Every query is limited to the
 * employee linked to the account (User.employeeId), and the tenant plugin adds
 * the company to every query on company data. Only fields meant for the
 * employee are returned: no salary settings, and nothing about colleagues but
 * the name of someone sharing a shift (main employee or backup).
 */
@Injectable()
export class MeService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(Planning.name)
    private readonly planningModel: Model<PlanningDocument>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<ShiftDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Worktime.name)
    private readonly worktimeModel: Model<WorktimeDocument>,
    @InjectModel(Advance.name)
    private readonly advanceModel: Model<AdvanceDocument>,
    @InjectModel(Bonus.name) private readonly bonusModel: Model<Bonus>,
  ) {}

  /** The employee record linked to this account, in the account's company. */
  private async employeeOf(user: AuthUser) {
    // Users are not tenant-scoped: filter by company explicitly.
    const account = await this.userModel
      .findOne({
        _id: new Types.ObjectId(user.id),
        companyId: new Types.ObjectId(user.companyId!),
      })
      .select('employeeId')
      .lean()
      .exec();
    if (!account?.employeeId) {
      throw new ForbiddenException('Your account is not linked to an employee');
    }
    const employee = await this.employeeModel
      .findById(account.employeeId)
      .lean()
      .exec();
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async profile(user: AuthUser) {
    const e = await this.employeeOf(user);
    return {
      id: String(e._id),
      email: user.email,
      empNumber: e.empNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      jobTitle: e.jobTitle ?? null,
      phoneNumber: e.phoneNumber ?? null,
      address: e.address ?? null,
      personalImage: e.personalImage ?? null,
      birthDate: e.birthDate ?? null,
      hireDate: e.hireDate ?? null,
      familyStatus: e.familyStatus ?? null,
    };
  }

  /** The month's shifts where this employee is the main employee or a backup. */
  async planning(user: AuthUser, year: unknown, month: unknown) {
    const range = parseMonth(year, month);
    const me = await this.employeeOf(user);
    const myId = String(me._id);

    const records = await this.planningModel
      .find({
        planDate: { $gte: range.start, $lt: range.end },
        $or: [{ empId: myId }, { backupEmpIds: myId }, { backupEmpId: myId }],
      })
      .sort({ planDate: 1 })
      .lean()
      .exec();

    // The legacy backupEmpId only counts when backupEmpIds is empty
    // (getBackupIds), so a match on it alone may not be a real backup.
    type Mine = {
      r: (typeof records)[number];
      backupIds: string[];
      role: 'main' | 'backup';
    };
    const mine = records.flatMap((r): Mine[] => {
      const backupIds = getBackupIds(r);
      if (String(r.empId) === myId) return [{ r, backupIds, role: 'main' }];
      if (backupIds.includes(myId)) return [{ r, backupIds, role: 'backup' }];
      return [];
    });

    const valid = (id: string) => Types.ObjectId.isValid(id);
    const shiftIds = [...new Set(mine.map((x) => String(x.r.shiftId)))].filter(
      valid,
    );
    const personIds = [
      ...new Set(mine.flatMap((x) => [String(x.r.empId), ...x.backupIds])),
    ].filter(valid);
    const taskIds = [...new Set(mine.map((x) => x.r.taskId))];

    const [shifts, people, posts] = await Promise.all([
      this.shiftModel
        .find({ _id: { $in: shiftIds } })
        .lean()
        .exec(),
      this.employeeModel
        .find({ _id: { $in: personIds } })
        .select('firstName lastName')
        .lean()
        .exec(),
      this.taskModel
        .find({ taskId: { $in: taskIds } })
        .lean()
        .exec(),
    ]);
    const shiftById = new Map(shifts.map((s) => [String(s._id), s]));
    const personById = new Map<string, Person>(
      people.map((p) => [
        String(p._id),
        { id: String(p._id), firstName: p.firstName, lastName: p.lastName },
      ]),
    );
    const postById = new Map(posts.map((t) => [t.taskId, t.taskName]));

    const entries = mine.flatMap(({ r, backupIds, role }) => {
      const shift = shiftById.get(String(r.shiftId));
      // A shift deleted since: leave the entry out, as the planning pages do.
      if (!shift) return [];
      return [
        {
          id: String(r._id),
          date: dayOf(r.planDate),
          role,
          startTime: r.customStartTime || shift.startTime,
          endTime: r.customEndTime || shift.endTime,
          shift: {
            id: String(shift._id),
            startTime: shift.startTime,
            endTime: shift.endTime,
          },
          post: { id: r.taskId, name: postById.get(r.taskId) ?? null },
          tasks: (r.tasks ?? []).map((t) => ({
            label: t.label,
            startTime: t.startTime ?? null,
            endTime: t.endTime ?? null,
          })),
          mainEmployee:
            role === 'backup'
              ? (personById.get(String(r.empId)) ?? null)
              : null,
          backups: backupIds
            .filter((id) => id !== myId)
            .flatMap((id) => personById.get(id) ?? []),
        },
      ];
    });
    return { year: range.year, month: range.month, entries };
  }

  /** The month's clocking records (read only: clocking stays on the machines). */
  async worktime(user: AuthUser, year: unknown, month: unknown) {
    const range = parseMonth(year, month);
    const me = await this.employeeOf(user);
    const records = await this.worktimeModel
      .find({
        emp_id: me.empNumber,
        work_date: { $gte: range.start, $lt: range.end },
      })
      .sort({ work_date: 1 })
      .lean()
      .exec();
    return {
      year: range.year,
      month: range.month,
      records: records.map((w) => ({
        id: String(w._id),
        date: dayOf(w.work_date),
        clockIn: w.clock_in || null,
        clockOut: w.clock_out || null,
        workHours: w.work_hours ?? null,
        lateMinutes: Number(w.late_minutes) || 0,
        overtimeMinutes: Number(w.overtime_minutes) || 0,
        absent: !!w.absent,
        absentComment: w.absent_comment ?? null,
      })),
    };
  }

  async advances(user: AuthUser, year: unknown, month: unknown) {
    const range = parseMonth(year, month);
    const me = await this.employeeOf(user);
    const records = await this.advanceModel
      .find({
        emp_id: me.empNumber,
        date: { $gte: range.start, $lt: range.end },
      })
      .sort({ date: 1 })
      .lean()
      .exec();
    return {
      year: range.year,
      month: range.month,
      total: records.reduce((sum, a) => sum + a.amount, 0),
      records: records.map((a) => ({
        id: String(a._id),
        date: dayOf(a.date),
        amount: a.amount,
        reason: a.reason ?? null,
      })),
    };
  }

  async bonuses(user: AuthUser, year: unknown, month: unknown) {
    const range = parseMonth(year, month);
    const me = await this.employeeOf(user);
    const records = await this.bonusModel
      .find({
        emp_id: me.empNumber,
        date: { $gte: range.firstDay, $lte: range.lastDay },
      })
      .sort({ date: 1 })
      .lean()
      .exec();
    return {
      year: range.year,
      month: range.month,
      total: records.reduce((sum, b) => sum + b.amount, 0),
      records: records.map((b) => ({
        id: String(b._id),
        date: b.date,
        amount: b.amount,
        reason: b.reason ?? null,
      })),
    };
  }
}
