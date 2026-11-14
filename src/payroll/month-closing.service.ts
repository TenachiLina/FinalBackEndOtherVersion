import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import { CompaniesService } from '../companies/companies.service';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';
import { currentCompanyId } from '../tenancy/tenant-context';
import { MonthClosing, MonthClosingDocument } from './month-closing.schema';
import {
  autoCloseAt,
  closeDelayDays,
  isAutoCloseDue,
  isMonth,
  isOver,
  monthOf,
  monthsOfYear,
} from './month-closing.util';
import { PayrollService, type Period } from './payroll.service';

export const MONTH_CLOSED_MESSAGE =
  'This month is closed: its hours and pay can no longer be changed';

export interface MonthStatus {
  month: string;
  closed: boolean;
  /** Closed by itself after the company's delay */
  auto: boolean;
  closedAt: Date | null;
  closedBy: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  /** When the month will close by itself; null when it won't */
  closesAt: Date | null;
  /** The month is over, so an admin may close it now */
  canClose: boolean;
}

/**
 * Closes months. A closed month's work time, advances and bonuses can't be
 * changed (WorktimeService, AdvancesService and BonusesService ask
 * assertOpen before every change), and its payroll is frozen as it was.
 *
 * A month closes by itself N days after it ends (company setting
 * `monthCloseDelayDays`), or when an admin closes it. Only an admin reopens.
 */
@Injectable()
export class MonthClosingService {
  constructor(
    @InjectModel(MonthClosing.name)
    private readonly closingModel: Model<MonthClosingDocument>,
    private readonly payroll: PayrollService,
    private readonly companies: CompaniesService,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  /** The company's closing delay and time zone. */
  private async rules() {
    const id = currentCompanyId();
    const company = id ? await this.companies.findById(id) : null;
    const settings: any = company?.settings ?? {};
    return {
      company,
      delayDays: closeDelayDays(settings.monthCloseDelayDays),
      utcOffset: String(settings.utcOffset ?? '+00:00'),
    };
  }

  /** The month's payroll as it stands now, for everyone (not a manager's view). */
  private async snapshot(month: string, company: any) {
    const everyone = { role: 'admin' } as AuthUser;
    const range = this.payroll.month(month);
    const [period, payslips] = await Promise.all([
      this.payroll.forPeriod(everyone, company, range),
      this.payroll.payslips(everyone, range),
    ]);
    return {
      settings: period.settings,
      rows: period.rows,
      totals: period.totals,
      payslips: payslips.payslips,
    };
  }

  /**
   * The month's closing record. When the company's delay has passed and the
   * month was never closed or reopened, it is closed here, on first look.
   */
  private async record(
    month: string,
    now = new Date(),
  ): Promise<MonthClosingDocument | null> {
    const existing = await this.closingModel.findOne({ month }).exec();
    if (existing) return existing;
    const { company, delayDays, utcOffset } = await this.rules();
    if (!isAutoCloseDue(month, delayDays, utcOffset, now)) return null;
    try {
      return await this.closingModel.create({
        month,
        status: 'closed',
        auto: true,
        closedAt: autoCloseAt(month, delayDays, utcOffset) ?? now,
        snapshot: await this.snapshot(month, company),
      });
    } catch (err: any) {
      // Two requests closed it at the same moment: read the one that won
      if (err?.code !== 11000) throw err;
      return this.closingModel.findOne({ month }).exec();
    }
  }

  private static requireMonth(month: unknown): string {
    if (!isMonth(month)) {
      throw new BadRequestException('month must be YYYY-MM (e.g. 2026-11)');
    }
    return month;
  }

  private async toStatus(
    month: string,
    record: MonthClosingDocument | null,
    now: Date,
  ): Promise<MonthStatus> {
    const { delayDays, utcOffset } = await this.rules();
    const closed = record?.status === 'closed';
    return {
      month,
      closed,
      auto: closed && !!record?.auto,
      closedAt: closed ? (record?.closedAt ?? null) : null,
      closedBy: closed ? (record?.closedBy?.name ?? null) : null,
      reopenedAt: record?.status === 'reopened' ? (record.reopenedAt ?? null) : null,
      reopenedBy:
        record?.status === 'reopened' ? (record.reopenedBy?.name ?? null) : null,
      // A reopened month stays open until an admin closes it again
      closesAt: record ? null : autoCloseAt(month, delayDays, utcOffset),
      canClose: !closed && isOver(month, utcOffset, now),
    };
  }

  async status(month: unknown, now = new Date()): Promise<MonthStatus> {
    const m = MonthClosingService.requireMonth(month);
    return this.toStatus(m, await this.record(m, now), now);
  }

  /** The 12 months of a year. */
  async year(year: unknown, now = new Date()): Promise<MonthStatus[]> {
    const y = Number(year);
    if (!/^\d{4}$/.test(String(year ?? '')) || y < 2000 || y > 2100) {
      throw new BadRequestException('year must be a year (e.g. 2026)');
    }
    const statuses: MonthStatus[] = [];
    for (const month of monthsOfYear(y)) {
      statuses.push(await this.status(month, now));
    }
    return statuses;
  }

  async isClosed(month: string, now = new Date()): Promise<boolean> {
    return (await this.record(month, now))?.status === 'closed';
  }

  /**
   * Refuses a change to a record dated in a closed month. Pass every date
   * the change touches (the record's old date and its new one).
   */
  async assertOpen(...dates: unknown[]): Promise<void> {
    const months = new Set(
      dates.map((d) => monthOf(d)).filter((m): m is string => m !== null),
    );
    for (const month of months) {
      if (await this.isClosed(month)) {
        throw new ConflictException(MONTH_CLOSED_MESSAGE);
      }
    }
  }

  /** Closes a month that is over. Its payroll is frozen as it is now. */
  async close(user: AuthUser, month: unknown, now = new Date()) {
    const m = MonthClosingService.requireMonth(month);
    const { company, utcOffset } = await this.rules();
    if (!isOver(m, utcOffset, now)) {
      throw new BadRequestException('This month is not over yet');
    }
    const record = await this.record(m, now);
    if (record?.status === 'closed') {
      throw new ConflictException('This month is already closed');
    }
    const fields = {
      status: 'closed' as const,
      auto: false,
      closedAt: now,
      closedBy: { id: user.id, name: user.name },
      snapshot: await this.snapshot(m, company),
    };
    const saved = record
      ? await this.closingModel
          .findOneAndUpdate(
            { month: m },
            { $set: fields, $unset: { reopenedAt: 1, reopenedBy: 1 } },
            { returnDocument: 'after' },
          )
          .exec()
      : await this.closingModel.create({ month: m, ...fields });
    return { name: m, ...(await this.toStatus(m, saved, now)) };
  }

  /** Reopens a closed month so its records can be corrected. */
  async reopen(user: AuthUser, month: unknown, now = new Date()) {
    const m = MonthClosingService.requireMonth(month);
    const record = await this.record(m, now);
    if (record?.status !== 'closed') {
      throw new ConflictException('This month is not closed');
    }
    const saved = await this.closingModel
      .findOneAndUpdate(
        { month: m },
        {
          $set: {
            status: 'reopened',
            reopenedAt: now,
            reopenedBy: { id: user.id, name: user.name },
          },
          $unset: { snapshot: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();
    return { name: m, ...(await this.toStatus(m, saved, now)) };
  }

  /** The closed month a period covers exactly ("2026-10-01" → "2026-10-31"), if any. */
  private async closedMonthOf(period: Period) {
    const month = period.start.slice(0, 7);
    if (!isMonth(month)) return null;
    const whole = this.payroll.month(month);
    if (whole.start !== period.start || whole.end !== period.end) return null;
    const record = await this.record(month);
    return record?.status === 'closed' && record.snapshot ? record : null;
  }

  /**
   * The frozen payroll of a closed month, when the period is exactly that
   * month; null otherwise (the caller then calculates it live).
   */
  async frozenPeriod(user: AuthUser, period: Period, empId?: unknown) {
    const record = await this.closedMonthOf(period);
    if (!record) return null;
    const hidden = await this.visibility.hiddenFor(user);
    const only =
      empId === undefined || empId === null || empId === ''
        ? null
        : Number(empId);
    const all: any[] = record.snapshot.rows ?? [];
    const rows = all.filter(
      (r) =>
        !hidden.ids.has(String(r.employeeId)) &&
        (only === null || Number(r.empId) === only),
    );
    const whole = rows.length === all.length;
    return {
      start: period.start,
      end: period.end,
      closed: true,
      closedAt: record.closedAt ?? null,
      settings: record.snapshot.settings,
      rows,
      // Everyone's totals are the ones frozen; a part of them is added up again
      totals: whole ? record.snapshot.totals : sumRows(rows),
    };
  }

  /** The frozen payslip amounts of a closed month; null when it is open. */
  async frozenPayslips(user: AuthUser, month: string) {
    const record = await this.record(month);
    if (record?.status !== 'closed' || !record.snapshot?.payslips) return null;
    const hidden = await this.visibility.hiddenFor(user);
    return {
      month,
      closed: true,
      payslips: (record.snapshot.payslips as any[]).filter(
        (p) => !hidden.ids.has(String(p.employeeId)),
      ),
    };
  }
}

const round2 = (n: number) => Number(n.toFixed(2));

/** Totals of some of a frozen month's lines (they are already rounded). */
function sumRows(rows: any[]) {
  const sum = (key: string) =>
    round2(rows.reduce((total, r) => total + (Number(r[key]) || 0), 0));
  return {
    hours: sum('hours'),
    gross: sum('gross'),
    penalties: sum('penalties'),
    consommation: sum('consommation'),
    advances: sum('advances'),
    bonuses: sum('bonuses'),
    net: sum('net'),
    absences: sum('absences'),
    lateMinutes: sum('lateMinutes'),
    lateDays: sum('lateDays'),
    overtimeMinutes: sum('overtimeMinutes'),
    records: sum('records'),
    activeEmployees: rows.filter((r) => Number(r.hours) > 0).length,
    employees: rows.length,
    advancesCount: sum('advancesCount'),
    bonusesCount: sum('bonusesCount'),
  };
}
