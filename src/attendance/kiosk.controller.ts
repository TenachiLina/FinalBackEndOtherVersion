import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
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

// Punches older than this don't count towards "currently clocked in", so a
// forgotten clock-out doesn't block tomorrow's clock-in. Covers long and
// overnight shifts.
const SESSION_WINDOW_MS = 16 * 60 * 60 * 1000;

type ClockAction = 'in' | 'out';

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
  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(RawAttendanceLog.name)
    private readonly rawLogModel: Model<RawAttendanceLogDocument>,
    private readonly attendanceService: AttendanceService,
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
    const { clockedIn } = this.stateOf(
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

    return {
      action,
      time: now.toISOString(),
      employee: { empNumber: employee.empNumber, name },
    };
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
