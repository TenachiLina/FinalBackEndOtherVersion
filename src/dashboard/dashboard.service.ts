import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import { subscriptionState } from '../companies/subscription.util';
import { CorrectionsService } from '../corrections/corrections.service';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';
import { localNow } from '../notifications/notifications.util';
import { MonthClosingService } from '../payroll/month-closing.service';
import { PayrollService } from '../payroll/payroll.service';
import { Planning, PlanningDocument } from '../planning/planning.shema';
import { Shift, ShiftDocument } from '../shifts/shift.shema';
import { Worktime, WorktimeDocument } from '../worktime/worktime.shema';
import { countToday, todayBoard } from './dashboard.util';

// The company of the request, as the guard loaded it
type CompanyLike = {
  features: string[];
  settings?: { utcOffset?: string; currency?: string } | null;
  subscription?: any;
};

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The Home page: today at a glance. Who is in, late, absent or not arrived
 * yet, what is waiting to be dealt with and, for admins, the pay of the
 * month so far. Worked out on demand from the planning and the clocking.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(Planning.name)
    private readonly planningModel: Model<PlanningDocument>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<ShiftDocument>,
    @InjectModel(Worktime.name)
    private readonly worktimeModel: Model<WorktimeDocument>,
    private readonly visibility: ManagerVisibilityService,
    private readonly corrections: CorrectionsService,
    private readonly payroll: PayrollService,
    private readonly closing: MonthClosingService,
  ) {}

  /** Everyone concerned by today, and the counts. Null when clock-in is off. */
  private async attendance(company: CompanyLike, day: string, minutes: number) {
    if (!company.features.includes('clockin')) return null;
    // Planning and work time dates are stored as midnight UTC of the day
    const start = new Date(`${day}T00:00:00.000Z`);
    const dates = { $gte: start, $lt: new Date(start.getTime() + DAY_MS) };
    const [employees, records, planning] = await Promise.all([
      this.employeeModel
        .find({ isArchived: { $ne: true } })
        .select('empNumber firstName lastName')
        .lean()
        .exec(),
      this.worktimeModel
        .find({ work_date: dates })
        .select('emp_id clock_in clock_out late_minutes absent')
        .lean()
        .exec(),
      company.features.includes('planning')
        ? this.planningModel
            .find({ planDate: dates })
            .select('empId shiftId customStartTime customEndTime')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);
    const nameOf = (e: { firstName: string; lastName: string }) =>
      `${e.firstName} ${e.lastName}`.trim();
    const byNumber = new Map(employees.map((e) => [Number(e.empNumber), e]));
    const byId = new Map(employees.map((e) => [String(e._id), e]));
    const shiftIds = [
      ...new Set(planning.map((p) => String(p.shiftId))),
    ].filter((id) => Types.ObjectId.isValid(id));
    const shifts = shiftIds.length
      ? await this.shiftModel
          .find({ _id: { $in: shiftIds } })
          .select('startTime endTime')
          .lean()
          .exec()
      : [];
    const shiftById = new Map(shifts.map((s) => [String(s._id), s]));

    const planned = planning.flatMap((p) => {
      const employee = byId.get(String(p.empId));
      const shift = shiftById.get(String(p.shiftId));
      const begins = p.customStartTime || shift?.startTime;
      const ends = p.customEndTime || shift?.endTime;
      return employee && begins && ends
        ? [
            {
              empNumber: Number(employee.empNumber),
              name: nameOf(employee),
              start: begins,
              end: ends,
            },
          ]
        : [];
    });
    const people = todayBoard(
      planned,
      records.flatMap((r) => {
        const employee = byNumber.get(Number(r.emp_id));
        return employee
          ? [
              {
                empNumber: Number(r.emp_id),
                name: nameOf(employee),
                clockIn: r.clock_in,
                clockOut: r.clock_out,
                lateMinutes: r.late_minutes,
                absent: r.absent,
              },
            ]
          : [];
      }),
      minutes,
    );
    return {
      employees: employees.length,
      counts: countToday(people, new Set(planned.map((p) => p.empNumber)).size),
      people,
    };
  }

  /** The pay of the current month so far. Admins only: managers get no money figures. */
  private async month(user: AuthUser, company: CompanyLike, day: string) {
    const admin = user.role === 'admin' || user.role === 'superadmin';
    if (!admin || !company.features.includes('reporting')) return null;
    const month = day.slice(0, 7);
    const range = this.payroll.month(month);
    const [pay, status] = await Promise.all([
      this.payroll.forPeriod(user, company, range),
      this.closing.status(month),
    ]);
    return {
      month,
      currency: pay.settings.currency,
      hours: pay.totals.hours,
      gross: pay.totals.gross,
      advances: pay.totals.advances,
      bonuses: pay.totals.bonuses,
      net: pay.totals.net,
      employees: pay.totals.employees,
      closesAt: status.closesAt,
    };
  }

  async today(user: AuthUser, company: CompanyLike, now = new Date()) {
    const { day, minutes } = localNow(now, company.settings?.utcOffset);
    const [attendance, pending, month, hidden] = await Promise.all([
      this.attendance(company, day, minutes),
      this.corrections.pendingCount(user),
      this.month(user, company, day),
      this.visibility.hiddenFor(user),
    ]);

    // A manager is not shown the other managers on the board
    let board = attendance;
    if (board && hidden.empNumbers.size) {
      const others = board.people.filter((p) =>
        hidden.empNumbers.has(p.empNumber),
      );
      const people = board.people.filter(
        (p) => !hidden.empNumbers.has(p.empNumber),
      );
      board = {
        employees: board.employees - hidden.empNumbers.size,
        counts: countToday(
          people,
          board.counts.planned - others.filter((p) => p.shift !== null).length,
        ),
        people,
      };
    }

    const subscription = subscriptionState(company.subscription, now);
    return {
      day,
      time: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
      // null when the company has clock-in switched off
      attendance: board,
      pending: { corrections: pending.pending },
      // null for managers, and when reporting is off
      month,
      subscription: {
        status: subscription.status,
        endingSoon: subscription.endingSoon,
        readOnly: subscription.readOnly,
        daysLeft: subscription.daysLeft,
      },
    };
  }
}
