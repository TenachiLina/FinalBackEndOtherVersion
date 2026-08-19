import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AttendanceDeviceService } from '../attendance-device/attendance-device.service';
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
}