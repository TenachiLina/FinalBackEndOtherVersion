import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import { subscriptionState } from '../companies/subscription.util';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';
import { Planning, PlanningDocument } from '../planning/planning.shema';
import { Shift, ShiftDocument } from '../shifts/shift.shema';
import { Worktime, WorktimeDocument } from '../worktime/worktime.shema';
import { MonthClosingService } from '../payroll/month-closing.service';
import {
  NotificationRead,
  NotificationReadDocument,
} from './notification-read.schema';
import {
  attendanceToday,
  CLOSING_NOTICE_DAYS,
  fingerprint,
  localNow,
  silentDevices,
  type NotificationItem,
} from './notifications.util';

// The company of the request, as the guard loaded it (the schema fills the lists)
type CompanyLike = {
  features: string[];
  disabledPages: string[];
  settings?: { utcOffset?: string } | null;
  devices: { serial: string; name?: string; lastSeenAt?: Date }[];
  subscription?: any;
};

const DAY_MS = 86_400_000;
const MAX_KEYS = 200;

/** Works out the alerts of the moment, and remembers which ones a user has read. */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(NotificationRead.name)
    private readonly readModel: Model<NotificationReadDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(Planning.name)
    private readonly planningModel: Model<PlanningDocument>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<ShiftDocument>,
    @InjectModel(Worktime.name)
    private readonly worktimeModel: Model<WorktimeDocument>,
    private readonly closing: MonthClosingService,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  /** Who was late, absent or hasn't clocked in today. */
  private async attendance(
    company: CompanyLike,
    now: Date,
  ): Promise<NotificationItem[]> {
    const features = company.features;
    if (!features.includes('clockin')) return [];
    const { day, minutes } = localNow(now, company.settings?.utcOffset);
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
        .select('emp_id clock_in late_minutes absent')
        .lean()
        .exec(),
      features.includes('planning')
        ? this.planningModel
            .find({ planDate: dates })
            .select('empId shiftId customStartTime')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);
    const nameOf = (e: { firstName: string; lastName: string }) =>
      `${e.firstName} ${e.lastName}`.trim();
    const byNumber = new Map(employees.map((e) => [Number(e.empNumber), e]));
    const byId = new Map(employees.map((e) => [String(e._id), e]));

    const shiftIds = [...new Set(planning.map((p) => String(p.shiftId)))].filter(
      (id) => Types.ObjectId.isValid(id),
    );
    const shifts = shiftIds.length
      ? await this.shiftModel
          .find({ _id: { $in: shiftIds } })
          .select('startTime')
          .lean()
          .exec()
      : [];
    const shiftStart = new Map(shifts.map((s) => [String(s._id), s.startTime]));

    const { late, absent, missing } = attendanceToday(
      planning.flatMap((p) => {
        const employee = byId.get(String(p.empId));
        const begins = p.customStartTime || shiftStart.get(String(p.shiftId));
        return employee && begins
          ? [
              {
                empNumber: Number(employee.empNumber),
                name: nameOf(employee),
                start: begins,
              },
            ]
          : [];
      }),
      records.flatMap((r) => {
        const employee = byNumber.get(Number(r.emp_id));
        return employee
          ? [
              {
                empNumber: Number(r.emp_id),
                name: nameOf(employee),
                clockIn: r.clock_in,
                lateMinutes: r.late_minutes,
                absent: r.absent,
              },
            ]
          : [];
      }),
      minutes,
    );

    const href = company.disabledPages.includes('clockinHistory')
      ? '/clockinpage'
      : '/clockinpagehistory';
    const items: NotificationItem[] = [];
    if (missing.length) {
      items.push({
        key: `missing:${day}:${fingerprint(missing)}`,
        type: 'missing',
        level: 'danger',
        params: { count: missing.length, names: missing, day },
        href,
      });
    }
    if (late.length) {
      items.push({
        key: `late:${day}:${fingerprint(late)}`,
        type: 'late',
        level: 'warning',
        params: { count: late.length, names: late, day },
        href,
      });
    }
    if (absent.length) {
      items.push({
        key: `absent:${day}:${fingerprint(absent)}`,
        type: 'absent',
        level: 'warning',
        params: { count: absent.length, names: absent, day },
        href,
      });
    }
    return items;
  }

  /** A finished month that will close by itself within a few days. */
  private async monthClosing(
    company: CompanyLike,
    now: Date,
  ): Promise<NotificationItem[]> {
    if (!company.features.includes('reporting')) return [];
    const { day } = localNow(now, company.settings?.utcOffset);
    const [y, m] = day.split('-').map(Number);
    const previous = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const status = await this.closing.status(previous, now);
    if (status.closed || !status.closesAt) return [];
    const left = status.closesAt.getTime() - now.getTime();
    if (left > CLOSING_NOTICE_DAYS * DAY_MS) return [];
    return [
      {
        key: `closing:${previous}`,
        type: 'monthClosing',
        level: 'info',
        params: {
          month: previous,
          closesAt: status.closesAt.toISOString(),
          daysLeft: Math.max(0, Math.floor(left / DAY_MS)),
        },
        href: '/reporting/monthly-payroll',
      },
    ];
  }

  private subscription(company: CompanyLike, now: Date) {
    const state = subscriptionState(company.subscription, now);
    if (!state.endsAt || (!state.endingSoon && !state.readOnly)) return [];
    const ends = state.endsAt.toISOString();
    const item: NotificationItem = {
      key: `subscription:${state.readOnly ? 'ended' : 'ending'}:${ends.slice(0, 10)}`,
      type: state.readOnly ? 'subscriptionEnded' : 'subscriptionEnding',
      level: state.readOnly ? 'danger' : 'warning',
      params: {
        endsAt: ends,
        daysLeft: state.daysLeft!,
        kind: state.kind!,
      },
      href: '/company-settings',
    };
    return [item];
  }

  private devices(company: CompanyLike, now: Date) {
    if (!company.features.includes('clockin')) return [];
    return silentDevices(company.devices, now).map(
      (d): NotificationItem => ({
        // One alert per silence: it comes back if the machine stops again
        key: `device:${d.serial}:${d.lastSeenAt}`,
        type: 'deviceSilent',
        level: 'danger',
        params: { name: d.name, lastSeenAt: d.lastSeenAt },
        href: '/clockinpagehistory',
      }),
    );
  }

  /**
   * The alerts of the moment for this user, newest concerns first, each with
   * whether they have read it. Managers get today's attendance; admins also
   * get the month about to close, the subscription and the machines.
   */
  async list(user: AuthUser, company: CompanyLike, now = new Date()) {
    const admin = user.role === 'admin' || user.role === 'superadmin';
    const groups = await Promise.all([
      this.attendance(company, now),
      admin ? this.devices(company, now) : [],
      admin ? this.monthClosing(company, now) : [],
      admin ? this.subscription(company, now) : [],
    ]);
    let items = groups.flat();

    // A manager is not told about the other managers
    const hidden = await this.visibility.hiddenFor(user);
    if (hidden.ids.size) {
      const others = await this.employeeModel
        .find({ _id: { $in: [...hidden.ids] } })
        .select('firstName lastName')
        .lean()
        .exec();
      const hiddenNames = new Set(
        others.map((e) => `${e.firstName} ${e.lastName}`.trim()),
      );
      items = items.flatMap((item) => {
        const names = item.params.names;
        if (!Array.isArray(names)) return [item];
        const kept = names.filter((n) => !hiddenNames.has(n));
        if (!kept.length) return [];
        if (kept.length === names.length) return [item];
        const [type, day] = item.key.split(':');
        return [
          {
            ...item,
            key: `${type}:${day}:${fingerprint(kept)}`,
            params: { ...item.params, names: kept, count: kept.length },
          },
        ];
      });
    }

    const read = items.length
      ? await this.readModel
          .find({
            userId: new Types.ObjectId(user.id),
            key: { $in: items.map((i) => i.key) },
          })
          .select('key')
          .lean()
          .exec()
      : [];
    const readKeys = new Set(read.map((r) => r.key));
    const withRead = items.map((i) => ({ ...i, read: readKeys.has(i.key) }));
    return {
      items: withRead,
      unread: withRead.filter((i) => !i.read).length,
    };
  }

  /** Marks alerts as read by this user. */
  async markRead(user: AuthUser, keys: unknown) {
    if (
      !Array.isArray(keys) ||
      keys.length > MAX_KEYS ||
      keys.some((k) => typeof k !== 'string' || !k || k.length > 200)
    ) {
      throw new BadRequestException('keys must be a list of notification keys');
    }
    const userId = new Types.ObjectId(user.id);
    await Promise.all(
      [...new Set(keys as string[])].map((key) =>
        this.readModel
          .updateOne(
            { userId, key },
            { $setOnInsert: { userId, key, readAt: new Date() } },
            { upsert: true },
          )
          .exec()
          // Two tabs marking the same alert at once: it is read either way
          .catch((err: any) => {
            if (err?.code !== 11000) throw err;
          }),
      ),
    );
  }
}
