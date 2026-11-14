import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.decorators';
import { Employee, EmployeeDocument } from '../employees/employee.shema';
import { ManagerVisibilityService } from '../employees/manager-visibility.service';
import { Planning, PlanningDocument } from '../planning/planning.shema';
import { Worktime, WorktimeDocument } from '../worktime/worktime.shema';
import { Advance, AdvanceDocument } from '../advances/advance.schema';
import { Bonus } from '../bonuses/bonus.schema';
import {
  exactPayLine,
  payrollSettings,
  roundPayLine,
  payslipAmounts,
  payTotals,
  type PayLine,
  type PayrollSettings,
  type WorktimeLike,
} from './payroll.calc';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DAYS = 366;

export interface Period {
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD", included
}

export interface PayrollRow extends PayLine {
  employeeId: string;
  empId: number;
  firstName: string;
  lastName: string;
  baseSalary: number;
  /** Has a planning entry in the period */
  scheduled: boolean;
  /** Advances given in the period (the weekly page gives one per week) */
  advancesCount: number;
  /** The advance to remove when the weekly advance is taken back */
  advanceId: string | null;
  bonusesCount: number;
}

type CompanyLike = { settings?: Partial<PayrollSettings> | null } | null;

/**
 * Pay for a period, calculated here and nowhere else (see payroll.calc.ts).
 * The tenant plugin limits every query to the current company; a manager
 * doesn't get the other managers (ManagerVisibilityService).
 */
@Injectable()
export class PayrollService {
  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(Planning.name)
    private readonly planningModel: Model<PlanningDocument>,
    @InjectModel(Worktime.name)
    private readonly worktimeModel: Model<WorktimeDocument>,
    @InjectModel(Advance.name)
    private readonly advanceModel: Model<AdvanceDocument>,
    @InjectModel(Bonus.name) private readonly bonusModel: Model<Bonus>,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  /** Reads ?start=&end= ("YYYY-MM-DD", both included). Throws 400 when wrong. */
  period(start: unknown, end: unknown): Period {
    const valid = (v: unknown): v is string =>
      typeof v === 'string' &&
      ISO_DATE.test(v) &&
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
    if (!valid(start) || !valid(end)) {
      throw new BadRequestException('start and end must be YYYY-MM-DD dates');
    }
    const days =
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days < 1) {
      throw new BadRequestException('start must be on or before end');
    }
    if (days > MAX_DAYS) {
      throw new BadRequestException('The period can be at most 366 days');
    }
    return { start, end };
  }

  /** Reads ?month=YYYY-MM into that calendar month. Throws 400 when wrong. */
  month(month: unknown): Period & { month: string } {
    if (typeof month !== 'string' || !ISO_MONTH.test(month)) {
      throw new BadRequestException('month must be YYYY-MM (e.g. 2026-11)');
    }
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      month,
      start: `${month}-01`,
      end: `${month}-${String(last).padStart(2, '0')}`,
    };
  }

  /**
   * Every employee's pay for the period: the ones planned in it or with
   * worked time in it (hours worked without a planning entry are still paid).
   * `empId` limits the answer to one employee number, planned or not.
   */
  async forPeriod(
    user: AuthUser,
    company: CompanyLike,
    period: Period,
    empId?: unknown,
  ) {
    const settings = payrollSettings(company?.settings);
    const only =
      empId === undefined || empId === null || empId === ''
        ? null
        : Number(empId);
    if (only !== null && !Number.isFinite(only)) {
      throw new BadRequestException('empId must be an employee number');
    }
    // Planning, work time and advance dates are stored as midnight UTC of the day
    const dates = {
      $gte: new Date(`${period.start}T00:00:00.000Z`),
      $lte: new Date(`${period.end}T23:59:59.999Z`),
    };
    const byEmp = only === null ? {} : { emp_id: only };

    const [hidden, employees, worktime, advances, bonuses, planning] =
      await Promise.all([
        this.visibility.hiddenFor(user),
        this.employeeModel
          .find(only === null ? {} : { empNumber: only })
          .select('empNumber firstName lastName baseSalary')
          .sort({ empNumber: 1 })
          .lean()
          .exec(),
        this.worktimeModel
          .find({ ...byEmp, work_date: dates })
          .select(
            'emp_id work_hours late_minutes overtime_minutes penalty consomation absent',
          )
          .lean()
          .exec(),
        this.advanceModel
          .find({ ...byEmp, date: dates })
          .sort({ date: -1 })
          .lean()
          .exec(),
        // Bonus dates are stored as "YYYY-MM-DD" text
        this.bonusModel
          .find({ ...byEmp, date: { $gte: period.start, $lte: period.end } })
          .lean()
          .exec(),
        this.planningModel
          .find({ planDate: dates })
          .select('empId')
          .lean()
          .exec(),
      ]);

    const group = <T extends { emp_id?: unknown }>(records: T[]) => {
      const map = new Map<number, T[]>();
      for (const r of records) {
        const key = Number(r.emp_id);
        const list = map.get(key);
        if (list) list.push(r);
        else map.set(key, [r]);
      }
      return map;
    };
    const workByEmp = group(worktime as (WorktimeLike & { emp_id?: unknown })[]);
    const advancesByEmp = group(advances);
    const bonusesByEmp = group(bonuses as { emp_id?: unknown; amount: number }[]);
    const scheduled = new Set(planning.map((p) => String(p.empId)));

    const exact: PayrollRow[] = employees
      .filter((e) => !hidden.ids.has(String(e._id)))
      .map((e) => {
        const number = Number(e.empNumber);
        const rowsOf = workByEmp.get(number) ?? [];
        const advancesOf = advancesByEmp.get(number) ?? [];
        const bonusesOf = bonusesByEmp.get(number) ?? [];
        const isScheduled = scheduled.has(String(e._id));
        return {
          employeeId: String(e._id),
          empId: number,
          firstName: e.firstName ?? '',
          lastName: e.lastName ?? '',
          baseSalary: Number(e.baseSalary || 0),
          scheduled: isScheduled,
          ...exactPayLine(
            {
              baseSalary: e.baseSalary,
              rows: rowsOf,
              advances: advancesOf.reduce(
                (sum, a) => sum + Number(a.amount || 0),
                0,
              ),
              bonuses: bonusesOf.reduce(
                (sum, b) => sum + Number(b.amount || 0),
                0,
              ),
            },
            settings,
          ),
          advancesCount: advancesOf.length,
          advanceId: advancesOf[0] ? String(advancesOf[0]._id) : null,
          bonusesCount: bonusesOf.length,
        };
      })
      .filter((r) => only !== null || r.scheduled || r.records > 0);

    return {
      start: period.start,
      end: period.end,
      settings,
      rows: exact.map((r) => ({ ...r, ...roundPayLine(r) })),
      totals: {
        ...payTotals(exact),
        advancesCount: exact.reduce((n, r) => n + r.advancesCount, 0),
        bonusesCount: exact.reduce((n, r) => n + r.bonusesCount, 0),
      },
    };
  }

  /** Payslip amounts (fiche de paie) of every employee, for one month. */
  async payslips(user: AuthUser, month: Period & { month: string }) {
    const [hidden, employees] = await Promise.all([
      this.visibility.hiddenFor(user),
      this.employeeModel
        .find()
        .select(
          'empNumber firstName lastName jobTitle familyStatus birthDate hireDate socialSecurityNumber insured baseSalary declaredSalary',
        )
        .sort({ empNumber: 1 })
        .lean()
        .exec(),
    ]);
    return {
      month: month.month,
      payslips: employees
        .filter((e) => !hidden.ids.has(String(e._id)))
        .map((e) => ({
          employeeId: String(e._id),
          empId: Number(e.empNumber),
          firstName: e.firstName ?? '',
          lastName: e.lastName ?? '',
          insured: !!e.insured,
          ...payslipAmounts(e),
        })),
    };
  }
}
