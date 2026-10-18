import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import {
  ZktecoAttendanceEvent,
  ZktecoAttendanceEventDocument,
} from './schemas/zkteco-attendance-event.schema';

export interface ZktecoSaveResult {
  inserted: number;
  duplicates: number;
  rejected: number;
}

@Injectable()
export class ZktecoService {
  private readonly logger = new Logger(ZktecoService.name);

  constructor(
    @InjectModel(ZktecoAttendanceEvent.name)
    private readonly eventModel: Model<ZktecoAttendanceEventDocument>,
  ) {}

  /**
   * Save ATTLOG rows from an ADMS upload. We only persist ATTLOG data here;
   * other ADMS tables must not be mistaken for attendance events.
   */
  async saveAttlog(
    serial: string,
    rawBody: string,
    utcOffset = '+01:00',
  ): Promise<ZktecoSaveResult> {
    const lines = rawBody
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    const result: ZktecoSaveResult = {
      inserted: 0,
      duplicates: 0,
      rejected: 0,
    };

    for (const line of lines) {
      const columns = line.split('\t');

      // Common ZKTeco ATTLOG format:
      // PIN<TAB>YYYY-MM-DD HH:mm:ss<TAB>Status<TAB>Verify<TAB>WorkCode[...]
      if (columns.length < 4) {
        result.rejected++;
        this.logger.warn(`Rejected malformed ATTLOG row from ${serial}`);
        continue;
      }

      const employeePin = columns[0].trim();
      const deviceTimestamp = columns[1].trim();
      const status = Number(columns[2].trim());
      const verifyMode = Number(columns[3].trim());
      const workCode = columns[4]?.trim();
      const eventTime = this.parseDeviceTimestamp(deviceTimestamp, utcOffset);

      if (
        !employeePin ||
        !eventTime ||
        !Number.isInteger(status) ||
        !Number.isInteger(verifyMode)
      ) {
        result.rejected++;
        this.logger.warn(`Rejected invalid ATTLOG row from ${serial}`);
        continue;
      }

      // This de-duplicates exact retransmissions. If the device exposes a stable
      // record/sequence ID, prefer that ID after confirming its payload format.
      const eventKey = createHash('sha256')
        .update(`${serial}\n${line}`)
        .digest('hex');

      try {
        const writeResult = await this.eventModel.updateOne(
          { eventKey },
          {
            $setOnInsert: {
              deviceSerial: serial,
              employeePin,
              eventTime,
              deviceTimestamp,
              status,
              verifyMode,
              ...(workCode !== undefined ? { workCode } : {}),
              rawLine: line,
              eventKey,
              processingStatus: 'pending',
            },
          },
          { upsert: true },
        );

        if (writeResult.upsertedCount > 0) {
          result.inserted++;
        } else {
          result.duplicates++;
        }
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: number }).code === 11000
        ) {
          result.duplicates++;
          continue;
        }
        throw error;
      }
    }

    this.logger.log(
      `ADMS ${serial}: inserted=${result.inserted}, duplicates=${result.duplicates}, rejected=${result.rejected}`,
    );
    return result;
  }

  private parseDeviceTimestamp(value: string, utcOffset: string): Date | null {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2}):(\d{2})$/,
    );
    if (!match) return null;

    const [, y, mo, d, h, mi, s] = match;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    const second = Number(s);

    // The offset comes from the company's settings (default +01:00, Algeria).
    const offset = utcOffset;
    if (!/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/.test(offset)) {
      this.logger.error('Invalid company UTC offset; expected e.g. +01:00');
      return null;
    }

    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
    if (Number.isNaN(date.getTime())) return null;

    // Reject out-of-range calendar values instead of accepting JS normalization.
    const localParts = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second),
    );
    if (
      localParts.getUTCFullYear() !== year ||
      localParts.getUTCMonth() !== month - 1 ||
      localParts.getUTCDate() !== day ||
      localParts.getUTCHours() !== hour ||
      localParts.getUTCMinutes() !== minute ||
      localParts.getUTCSeconds() !== second
    ) {
      return null;
    }

    return date;
  }
}
