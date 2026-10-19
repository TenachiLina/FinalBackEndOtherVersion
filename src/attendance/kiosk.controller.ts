import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { KioskAllowed, RequireFeature, Roles } from '../auth/auth.decorators';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import {
  RawAttendanceLog,
  RawAttendanceLogDocument,
} from './raw-attendance-log.schema';
import { AttendanceService } from './attendance.service';
import { WorktimeService } from '../worktime/worktime.service';
import { PlanningService } from '../planning/planning.service';
import { CompaniesService } from '../companies/companies.service';
import { currentCompanyId } from '../tenancy/tenant-context';

// Punches older than this don't count towards "currently clocked in", so a
// forgotten clock-out doesn't block tomorrow's clock-in. Covers long and
// overnight shifts.
const SESSION_WINDOW_MS = 16 * 60 * 60 * 1000;

type ClockAction = 'in' | 'out';

interface PlannedShift {
  _id: string;
  startTime: string;
  endTime: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const formatMin = (n: number) =>
  n <= 0 ? '00:00' : `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

/**
 * Clock-in kiosk: pick an employee, press Clock in or Clock out.
 * The time is always the server's, so it can't be changed from the device.
 * Punches are stored like machine punches, so Clock-in History and the
 * face-recognition page treat them the same way.
 */
@KioskAllowed()
@Roles('admin', 'manager', 'employee')
@RequireFeature('clockin')
@Controller('kiosk')
export class KioskController {
  private readonly logger = new Logger(KioskController.name);

  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(RawAttendanceLog.name)
    private readonly rawLogModel: Model<RawAttendanceLogDocument>,
    private readonly attendanceService: AttendanceService,
    private readonly worktimeService: WorktimeService,
    private readonly planningService: PlanningService,
    private readonly companiesService: CompaniesService,
  ) {}

  /** Employees with whether each is clocked in right now. No salaries. */
  @Get('employees')
  async employees() {
    const [employees, recent] = await Promise.all([
      this.employeeModel
        .find()
        .select('empNumber firstName lastName personalImage')
        .sort({ firstName: 1, lastName: 1 })
        .lean()
        .exec(),
      this.recentPunches(),
    ]);

    return employees.map((e) => {
      const state = this.stateOf(recent.get(String(e.empNumber)) ?? []);
      return {
        id: String(e._id),
        empNumber: e.empNumber,
        firstName: e.firstName,
        lastName: e.lastName,
        photo: e.personalImage || null,
        clockedIn: state.clockedIn,
        since: state.since,
      };
    });
  }

  @Post('clock')
  async clock(@Body() body: { empNumber?: number | string; action?: string }) {
    const action = body?.action as ClockAction;
    if (action !== 'in' && action !== 'out') {
      throw new BadRequestException('Choose Clock in or Clock out');
    }
    const empNumber = Number(body?.empNumber);
    const employee = Number.isFinite(empNumber)
      ? await this.employeeModel
          .findOne({ empNumber })
          .select('empNumber firstName lastName')
          .lean()
          .exec()
      : null;
    if (!employee) throw new NotFoundException('Employee not found');

    const name = `${employee.firstName} ${employee.lastName}`.trim();
    const recent = await this.recentPunches(String(employee.empNumber));
    const { clockedIn, since } = this.stateOf(
      recent.get(String(employee.empNumber)) ?? [],
    );
    if (action === 'in' && clockedIn) {
      throw new ConflictException(`${name} is already clocked in`);
    }
    if (action === 'out' && !clockedIn) {
      throw new ConflictException(`${name} isn't clocked in yet`);
    }

    const now = new Date();
    await this.attendanceService.createDeviceLog({
      deviceUserId: String(employee.empNumber),
      timestamp: now.toISOString(),
    });

    // Also fill the worktime table, like the manager's clock-in page does.
    // The punch above is already saved, so a failure here doesn't undo it.
    try {
      await this.saveWorktime(
        employee.empNumber,
        action,
        now,
        since ? new Date(since) : null,
      );
    } catch (err) {
      this.logger.error(
        `Couldn't save the worktime for employee ${employee.empNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return {
      action,
      time: now.toISOString(),
      employee: { empNumber: employee.empNumber, name },
    };
  }

  /**
   * One worktime record per employee and work date, like the manager's
   * clock-in page: first clock-in and last clock-out of the day, with late,
   * overtime and worked hours computed against the planned shift.
   * Times are in the company's local time (settings.utcOffset).
   */
  private async saveWorktime(
    empNumber: number,
    action: ClockAction,
    now: Date,
    since: Date | null,
  ) {
    const companyId = currentCompanyId();
    const company = companyId
      ? await this.companiesService.findById(companyId)
      : null;
    const offset = this.offsetMinutes(company?.settings?.utcOffset);
    const local = (d: Date) => {
      const l = new Date(d.getTime() + offset * 60_000);
      return {
        date: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`,
        time: `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`,
      };
    };

    const nowLocal = local(now);
    const sinceLocal = since ? local(since) : null;
    // A clock-out belongs to the day of its clock-in (overnight shifts)
    const workDate =
      action === 'out' && sinceLocal ? sinceLocal.date : nowLocal.date;

    const [existing] = await this.worktimeService.findAll({
      emp_id: empNumber,
      work_date: workDate,
    });

    const hasIn = existing?.clock_in && existing.clock_in !== '00:00';
    const clockIn = hasIn
      ? existing.clock_in!
      : action === 'in'
        ? nowLocal.time
        : (sinceLocal?.time ?? nowLocal.time);
    const clockOut =
      action === 'out'
        ? nowLocal.time
        : existing?.clock_out && existing.clock_out !== '00:00'
          ? existing.clock_out
          : null;

    const shift = await this.plannedShift(
      empNumber,
      workDate,
      clockIn,
      existing?.shift_id,
    );

    const data: Record<string, unknown> = {
      emp_id: empNumber,
      work_date: new Date(workDate),
      clock_in: clockIn,
      absent: false,
    };
    if (shift?._id) data.shift_id = String(shift._id);
    if (shift?.startTime) {
      const late = toMinutes(clockIn) - toMinutes(shift.startTime.slice(0, 5));
      data.late_minutes = String(Math.max(late, 0));
    }
    if (clockOut) {
      data.clock_out = clockOut;
      let worked = toMinutes(clockOut) - toMinutes(clockIn);
      if (worked < 0) worked += 1440;
      data.work_hours = formatMin(worked);
      if (shift?.endTime) {
        let end = toMinutes(shift.endTime.slice(0, 5));
        let out = toMinutes(clockOut);
        if (end === 0) end = 1440;
        if (end === 1440 && out < 720) out += 1440;
        data.overtime_minutes = String(Math.max(out - end, 0));
      }
    }

    if (existing) {
      await this.worktimeService.update(String(existing._id), data);
    } else {
      await this.worktimeService.create(data);
    }
  }

  /** The employee's planned shift that day: the one already on the record, else the closest to the clock-in */
  private async plannedShift(
    empNumber: number,
    date: string,
    clockIn: string,
    shiftId?: string,
  ): Promise<PlannedShift | null> {
    const planning = (await this.planningService.findAll({
      planDate: date,
    })) as unknown as {
      empId?: { empNumber?: number } | null;
      shiftId?: PlannedShift | null;
    }[];
    const shifts = planning
      .filter((p) => p.empId?.empNumber === empNumber && p.shiftId?._id)
      .map((p) => p.shiftId as PlannedShift);
    if (!shifts.length) return null;
    const same = shifts.find((s) => String(s._id) === shiftId);
    if (same) return same;
    const distance = (s: PlannedShift) => {
      const d = Math.abs(
        toMinutes(s.startTime.slice(0, 5)) - toMinutes(clockIn),
      );
      return Math.min(d, 1440 - d);
    };
    return shifts.reduce((best, s) =>
      distance(s) < distance(best) ? s : best,
    );
  }

  private offsetMinutes(utcOffset?: string) {
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset || '+01:00');
    if (!m) return 60;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  }

  /** Punches in the session window, grouped by employee number, oldest first. */
  private async recentPunches(empNumber?: string) {
    const logs = await this.rawLogModel
      .find({
        timestamp: { $gte: new Date(Date.now() - SESSION_WINDOW_MS) },
        ...(empNumber ? { deviceUserId: empNumber } : {}),
      })
      .select('deviceUserId timestamp')
      .sort({ timestamp: 1 })
      .lean()
      .exec();
    const byEmployee = new Map<string, Date[]>();
    for (const log of logs) {
      const key = String(log.deviceUserId).trim();
      byEmployee.set(key, [...(byEmployee.get(key) ?? []), log.timestamp]);
    }
    return byEmployee;
  }

  // Punches alternate in, out, in, out… so an odd count means clocked in.
  private stateOf(punches: Date[]) {
    const clockedIn = punches.length % 2 === 1;
    return {
      clockedIn,
      since: clockedIn ? punches[punches.length - 1].toISOString() : null,
    };
  }
}
