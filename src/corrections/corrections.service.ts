import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import type { Feature } from '../companies/company.schema';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';
import { Worktime, WorktimeDocument } from '../worktime/worktime.shema';
import { Advance, AdvanceDocument } from '../advances/advance.schema';
import { Bonus } from '../bonuses/bonus.schema';
import { dayOf } from '../me/month.util';
import {
  Correction,
  CorrectionDocument,
  type CorrectionKind,
} from './correction.schema';
import {
  FEATURE_OF,
  MAX_PENDING,
  parseDay,
  parseDecision,
  parseKind,
  parseMessage,
  parseReply,
  parseStatusFilter,
} from './correction.util';

/** The employee a report is about (from the account's link). */
export interface ReportingEmployee {
  _id: unknown;
  empNumber: number;
  firstName: string;
  lastName: string;
}

export interface ReportInput {
  kind?: unknown;
  recordId?: unknown;
  date?: unknown;
  message?: unknown;
}

type Snapshot = { date: string; values: Record<string, unknown> };

@Injectable()
export class CorrectionsService {
  constructor(
    @InjectModel(Correction.name)
    private readonly correctionModel: Model<CorrectionDocument>,
    @InjectModel(Worktime.name)
    private readonly worktimeModel: Model<WorktimeDocument>,
    @InjectModel(Advance.name)
    private readonly advanceModel: Model<AdvanceDocument>,
    @InjectModel(Bonus.name) private readonly bonusModel: Model<Bonus>,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  // ── Employee side (/me/corrections) ─────────────────────────────────────

  /** An employee reports a mistake in one of their own records, or a missing one. */
  async report(
    user: AuthUser,
    employee: ReportingEmployee,
    features: readonly string[],
    input: ReportInput,
  ) {
    const employeeId = new Types.ObjectId(String(employee._id));
    const kind = parseKind(input?.kind);
    const feature: Feature = FEATURE_OF[kind];
    if (!features.includes(feature)) {
      throw new ForbiddenException(
        `The "${feature}" feature is not enabled for this company`,
      );
    }
    const message = parseMessage(input?.message);

    let recordId: string | null = null;
    let date: string;
    let snapshot: Record<string, unknown> | null = null;
    if (input?.recordId != null && input.recordId !== '') {
      recordId = String(input.recordId);
      const record = await this.ownRecord(kind, recordId, employee.empNumber);
      date = record.date;
      snapshot = record.values;
      if (
        await this.correctionModel.exists({
          employeeId,
          recordId,
          status: 'pending',
        })
      ) {
        throw new ConflictException(
          'You already reported this. Wait for the answer.',
        );
      }
    } else {
      // Something missing: the employee says which day
      date = parseDay(input?.date);
    }

    const waiting = await this.correctionModel.countDocuments({
      employeeId,
      status: 'pending',
    });
    if (waiting >= MAX_PENDING) {
      throw new BadRequestException(
        'You have too many reports waiting. Wait for the answers first.',
      );
    }

    const doc = await this.correctionModel.create({
      employeeId,
      emp_id: employee.empNumber,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      kind,
      recordId,
      date,
      snapshot,
      message,
      createdBy: user.id,
    });
    // With the employee's name: the activity log shows whose report it is
    return toView(doc.toObject(), true);
  }

  /** The employee's own reports, newest first. */
  async listMine(employee: ReportingEmployee) {
    const rows = await this.correctionModel
      .find({ employeeId: new Types.ObjectId(String(employee._id)) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    return rows.map((r) => toView(r));
  }

  /**
   * The record reported, only if it is this employee's. Another employee's
   * record (or another company's: the tenant plugin) is "not found".
   */
  private async ownRecord(
    kind: CorrectionKind,
    recordId: string,
    empNumber: number,
  ): Promise<Snapshot> {
    const notFound = () => new NotFoundException('This record was not found');
    if (!Types.ObjectId.isValid(recordId)) throw notFound();
    const mine = { _id: recordId, emp_id: empNumber };

    if (kind === 'worktime') {
      const w = await this.worktimeModel.findOne(mine).lean().exec();
      if (!w) throw notFound();
      return {
        date: dayOf(w.work_date) ?? '',
        values: {
          clockIn: w.clock_in || null,
          clockOut: w.clock_out || null,
          workHours: w.work_hours ?? null,
          lateMinutes: Number(w.late_minutes) || 0,
          overtimeMinutes: Number(w.overtime_minutes) || 0,
          absent: !!w.absent,
        },
      };
    }
    if (kind === 'advance') {
      const a = await this.advanceModel.findOne(mine).lean().exec();
      if (!a) throw notFound();
      return {
        date: dayOf(a.date) ?? '',
        values: { amount: a.amount, reason: a.reason ?? null },
      };
    }
    const b = await this.bonusModel.findOne(mine).lean().exec();
    if (!b) throw notFound();
    return {
      date: b.date,
      values: { amount: b.amount, reason: b.reason ?? null },
    };
  }

  // ── Manager side (/corrections) ─────────────────────────────────────────

  /** Reports for managers and admins, newest first. */
  async list(user: AuthUser, status: unknown) {
    const filter: Record<string, unknown> = {};
    const wanted = parseStatusFilter(status);
    if (wanted) filter.status = wanted;
    const rows = await this.correctionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec();
    // A manager doesn't see other managers' reports (salary pages rule)
    return (await this.visibility.filterRecords(user, rows)).map((r) =>
      toView(r, true),
    );
  }

  /** How many reports are waiting (the badge in the website's menu). */
  async pendingCount(user: AuthUser) {
    const rows = await this.correctionModel
      .find({ status: 'pending' })
      .select('emp_id')
      .lean()
      .exec();
    return {
      pending: (await this.visibility.filterRecords(user, rows)).length,
    };
  }

  /** A manager marks a report corrected or rejected, with an optional reply. */
  async handle(
    user: AuthUser,
    id: string,
    input: { status?: unknown; reply?: unknown },
  ) {
    const status = parseDecision(input?.status);
    const reply = parseReply(input?.reply);
    const existing = Types.ObjectId.isValid(id)
      ? await this.correctionModel.findById(id).lean().exec()
      : null;
    if (!existing) throw new NotFoundException('Correction request not found');
    await this.visibility.assertVisible(user, existing.emp_id);

    // Only a waiting report changes, even if two managers answer at once
    const updated = await this.correctionModel
      .findOneAndUpdate(
        { _id: existing._id, status: 'pending' },
        {
          status,
          reply,
          handledById: user.id,
          handledByName: user.name,
          handledAt: new Date(),
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!updated) {
      throw new ConflictException('This request was already handled');
    }
    return toView(updated, true);
  }
}

type CorrectionRow = Correction & { _id: unknown };

/** What the app and the website get. */
function toView(c: CorrectionRow, withEmployee = false) {
  return {
    id: String(c._id),
    kind: c.kind,
    recordId: c.recordId ?? null,
    date: c.date,
    snapshot: c.snapshot ?? null,
    message: c.message,
    status: c.status,
    reply: c.reply ?? null,
    handledBy: c.handledByName ?? null,
    handledAt: c.handledAt ?? null,
    createdAt: c.createdAt ?? null,
    ...(withEmployee && {
      employee: {
        id: String(c.employeeId),
        empNumber: c.emp_id,
        name: c.employeeName,
      },
    }),
  };
}
