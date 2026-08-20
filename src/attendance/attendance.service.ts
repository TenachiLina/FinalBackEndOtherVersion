import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AttendanceDeviceService } from '../attendance-device/attendance-device.service';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import {
  RawAttendanceLog,
  RawAttendanceLogDocument,
} from './raw-attendance-log.schema';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
  @InjectModel(RawAttendanceLog.name)
  private rawLogModel: Model<RawAttendanceLogDocument>,

  @InjectModel(Employee.name)
  private employeeModel: Model<EmployeeDocument>,

  private deviceService: AttendanceDeviceService,
) {}

  async syncLogs() {
    const logs = await this.deviceService.getAttendanceLogs();
    let newCount = 0;

    for (const log of logs) {
      const deviceLogId = String(log.userSn);
      const deviceUserId = String(log.deviceUserId);
      const timestamp = new Date(log.recordTime);

      if (
        !deviceLogId ||
        !deviceUserId ||
        Number.isNaN(timestamp.getTime())
      ) {
        this.logger.warn('Skipping invalid log entry', log);
        continue;
      }

      const exists = await this.rawLogModel.findOne({ deviceLogId });

      if (!exists) {
        await this.rawLogModel.create({
          deviceUserId,
          timestamp,
          deviceLogId,
          processed: false,
        });

        newCount++;
      }
    }

    this.logger.log(
      `Sync complete — ${newCount} new logs saved out of ${logs.length} total`,
    );
  }


  async getDeviceLogs(date?: string) {
    const query: any = {};

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start);

      end.setUTCDate(end.getUTCDate() + 1);

      query.timestamp = {
        $gte: start,
        $lt: end,
      };
    }

    return this.rawLogModel
      .find(query)
      .sort({ timestamp: 1 })
      .lean()
      .exec();
  }

async getLogsByDateRange(
  from?: string,
  to?: string,
) {
  const filter: any = {};

  if (from || to) {
    filter.timestamp = {};

    if (from) {
      filter.timestamp.$gte = new Date(
        `${from}T00:00:00.000Z`,
      );
    }

    if (to) {
      filter.timestamp.$lte = new Date(
        `${to}T23:59:59.999Z`,
      );
    }
  }

  const logs = await this.rawLogModel
    .find(filter)
    .sort({ timestamp: 1 })
    .lean()
    .exec();

  const employees = await this.employeeModel
    .find({})
    .select('empNumber firstName lastName')
    .lean()
    .exec();

  // Create a quick lookup:
  // "104" -> employee 104
  const employeeMap = new Map(
    employees.map((employee) => [
      String(employee.empNumber),
      employee,
    ]),
  );

  return logs.map((log) => {
    // Remove control characters such as \u000e
    const cleanedDeviceUserId = String(log.deviceUserId)
      

    const employee = employeeMap.get(cleanedDeviceUserId);

    return {
      ...log,

      employeeNumber: employee
        ? String(employee.empNumber)
        : undefined,

      firstName: employee?.firstName,
      lastName: employee?.lastName,

      employeeFound: !!employee,
    };
  });
}
}