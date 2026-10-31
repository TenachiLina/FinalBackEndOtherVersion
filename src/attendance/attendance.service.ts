import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

import { AttendanceDeviceService } from '../attendance-device/attendance-device.service';

import {
  Employee,
  EmployeeDocument,
} from '../employees/employee.shema';

import {
  RawAttendanceLog,
  RawAttendanceLogDocument,
} from './raw-attendance-log.schema';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(
    AttendanceService.name,
  );

  constructor(
    @InjectModel(RawAttendanceLog.name)
    private rawLogModel: Model<RawAttendanceLogDocument>,

    @InjectModel(Employee.name)
    private employeeModel: Model<EmployeeDocument>,

    private deviceService: AttendanceDeviceService,
  ) {}

 async updateDeviceLog(id: string, timestamp: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException('Invalid attendance log ID');
  }

  const date = new Date(timestamp);

  if (!timestamp || Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid timestamp');
  }

  const updatedLog = await this.rawLogModel
    .findByIdAndUpdate(
      id,
      { $set: { timestamp: date } },
      { new: true, runValidators: true },
    )
    .exec();

  if (!updatedLog) {
    throw new NotFoundException('Attendance log not found');
  }

  return {
    status: 'success',
    message: 'Attendance time updated successfully',
    data: updatedLog,
  };
}

  // ============================================================
  // SYNC LOGS FROM THE PHYSICAL ATTENDANCE DEVICE
  // ============================================================

  async syncLogs() {
    const logs =
      await this.deviceService.getAttendanceLogs();

    let newCount = 0;
    let skippedCount = 0;

    for (const log of logs) {
      const deviceUserId = String(log.deviceUserId ?? '');
      const timestamp = new Date(log.recordTime);

      if (
        !deviceUserId ||
        Number.isNaN(timestamp.getTime())
      ) {
        this.logger.warn(
          'Skipping invalid log entry',
          log,
        );

        skippedCount++;

        continue;
      }

      // A punch is known by employee + machine time: the machine's record
      // number (userSn) starts again at 1 when its log is cleared. The time is
      // kept in the id because a manager can correct the punch's timestamp, and
      // that punch must not come back on the next sync. Punches saved before
      // this have the record number as id: those match on the timestamp.
      const deviceLogId = `${deviceUserId}-${timestamp.getTime()}`;

      const exists =
        await this.rawLogModel.findOne({
          $or: [
            { deviceLogId },
            { deviceUserId, timestamp },
          ],
        });

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
      `Sync complete — ${newCount} new logs saved out of ${logs.length} total, ${skippedCount} skipped`,
    );
  }

  // ============================================================
  // MANUAL PUNCH
  // ============================================================

 async createDeviceLog(data: {
  deviceUserId: string;
  timestamp: string;
  processed?: boolean;
}) {
  const deviceUserId = String(data.deviceUserId ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();

  const timestamp = new Date(data.timestamp);

  if (!deviceUserId) {
    throw new BadRequestException(
      "deviceUserId is required",
    );
  }

  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException(
      "Invalid timestamp",
    );
  }

  // Generate a unique ID for manually-created punches.
  // Device punches use the employee and the machine's time as deviceLogId.
  const deviceLogId = `manual-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 8)}`;

  const log = await this.rawLogModel.create({
    deviceUserId,
    timestamp,
    deviceLogId,
    processed: data.processed ?? false,
  });

  this.logger.log(
    `Manual punch created — employee ${deviceUserId} at ${timestamp.toISOString()} — ID: ${deviceLogId}`,
  );

  return log;
}
  // ============================================================
  // GET DEVICE LOGS BY SINGLE DATE
  // ============================================================

  async getDeviceLogs(date?: string) {
    const query: any = {};

    if (date) {
      const start = new Date(
        `${date}T00:00:00.000Z`,
      );

      const end = new Date(start);

      end.setUTCDate(
        end.getUTCDate() + 1,
      );

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

  // ============================================================
  // GET LOGS BY DATE RANGE
  // ============================================================

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

    const logs =
      await this.rawLogModel
        .find(filter)
        .sort({ timestamp: 1 })
        .lean()
        .exec();

    const employees =
      await this.employeeModel
        .find({})
        .select(
          'empNumber firstName lastName',
        )
        .lean()
        .exec();

    // ==========================================================
    // EMPLOYEE LOOKUP
    // ==========================================================

    const employeeMap = new Map(
      employees.map((employee) => [
        String(employee.empNumber)
          .replace(
            /[\u0000-\u001F\u007F]/g,
            '',
          )
          .trim(),

        employee,
      ]),
    );

    // ==========================================================
    // RETURN LOGS + EMPLOYEE INFORMATION
    // ==========================================================

    return logs.map((log) => {
      const cleanedDeviceUserId =
        String(log.deviceUserId)
          .replace(
            /[\u0000-\u001F\u007F]/g,
            '',
          )
          .trim();

      const employee =
        employeeMap.get(
          cleanedDeviceUserId,
        );

      return {
        ...log,

        deviceUserId:
          cleanedDeviceUserId,

        employeeNumber: employee
          ? String(employee.empNumber)
          : undefined,

        firstName:
          employee?.firstName,

        lastName:
          employee?.lastName,

        employeeFound:
          !!employee,
      };
    });
  }

  
  async deleteDeviceLog(id: string) {
    // Validate that the ID is a valid MongoDB ObjectId.
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(
        'Invalid attendance log ID',
      );
    }

    // Delete the attendance log from MongoDB.
    const deletedLog =
      await this.rawLogModel.findByIdAndDelete(id).exec();

    if (!deletedLog) {
      throw new NotFoundException(
        'Attendance log not found',
      );
    }

    this.logger.log(
      `Attendance log deleted — MongoDB ID: ${id}`,
    );

    return {
      status: 'success',
      message: 'Attendance log deleted successfully',
      id,
    };
  }

}