import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CompaniesService } from '../companies/companies.service';
import { currentCompanyId } from '../tenancy/tenant-context';
import { Employee } from '../employees/employee.shema';
import { Task } from '../tasks/task.schema';
import { Shift } from '../shifts/shift.shema';
import { Planning } from '../planning/planning.shema';
import { Worktime } from '../worktime/worktime.shema';
import { Bonus } from '../bonuses/bonus.schema';
import { Advance } from '../advances/advance.schema';
import { buildLaborSummary, LaborSummaryInput, Period } from './labor-summary';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

@Injectable()
export class ReportsService {
  constructor(
    private readonly companiesService: CompaniesService,
    @InjectModel(Employee.name) private employeeModel: Model<Employee>,
    @InjectModel(Task.name) private taskModel: Model<Task>,
    @InjectModel(Shift.name) private shiftModel: Model<Shift>,
    @InjectModel(Planning.name) private planningModel: Model<Planning>,
    @InjectModel(Worktime.name) private worktimeModel: Model<Worktime>,
    @InjectModel(Bonus.name) private bonusModel: Model<Bonus>,
    @InjectModel(Advance.name) private advanceModel: Model<Advance>,
  ) {}

  /** Checks ?start=YYYY-MM-DD&end=YYYY-MM-DD */
  period(start: unknown, end: unknown): Period {
    const valid = (v: unknown) =>
      typeof v === 'string' &&
      ISO_DATE.test(v) &&
      new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
    if (!valid(start) || !valid(end)) {
      throw new BadRequestException('start and end must be YYYY-MM-DD dates');
    }
    const days =
      (Date.parse(`${end as string}T00:00:00Z`) -
        Date.parse(`${start as string}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days < 1)
      throw new BadRequestException('start must be on or before end');
    if (days > MAX_DAYS) {
      throw new BadRequestException('The period can be at most 366 days');
    }
    return { start: start as string, end: end as string };
  }

  async laborSummary(period: Period) {
    const companyId = currentCompanyId()!;
    // Planning and work time dates are stored as midnight UTC of the local day
    const dates = {
      $gte: new Date(`${period.start}T00:00:00.000Z`),
      $lte: new Date(`${period.end}T23:59:59.999Z`),
    };

    const [
      company,
      employees,
      tasks,
      shifts,
      planning,
      worktime,
      bonuses,
      advances,
    ] = await Promise.all([
      this.companiesService.findById(companyId),
      this.employeeModel.find({}, { empNumber: 1 }).lean(),
      this.taskModel.find({}, { taskId: 1, taskName: 1 }).lean(),
      this.shiftModel.find({}, { startTime: 1, endTime: 1 }).lean(),
      this.planningModel.find({ planDate: dates }).lean(),
      this.worktimeModel.find({ work_date: dates }).lean(),
      this.bonusModel
        .find({ date: { $gte: period.start, $lte: period.end } }, { amount: 1 })
        .lean(),
      this.advanceModel.find({ date: dates }, { amount: 1 }).lean(),
    ]);

    return buildLaborSummary({
      period,
      companyId,
      currency: company?.settings?.currency ?? 'DA',
      employees,
      tasks,
      shifts,
      planning,
      worktime,
      bonuses,
      advances,
    } as unknown as LaborSummaryInput);
  }
}
