import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Employee, EmployeeDocument } from './employee.shema';
import { User, UserDocument } from '../auth/user.schema';
import { Planning, PlanningDocument } from '../planning/planning.shema';
import { Worktime, WorktimeDocument } from '../worktime/worktime.shema';
import { Advance, AdvanceDocument } from '../advances/advance.schema';
import { Bonus } from '../bonuses/bonus.schema';

export type ArchiveStatus = 'active' | 'archived' | 'all';

/** Reads ?status=. Everything is listed when it is missing, each record with its isArchived flag. */
export function archiveStatus(value: unknown): ArchiveStatus {
  if (value === undefined || value === null || value === '') return 'all';
  if (value === 'active' || value === 'archived' || value === 'all') {
    return value;
  }
  throw new BadRequestException('status must be active, archived or all');
}

/** The filter for a status: records saved before archiving existed have no flag and are active. */
export function archiveFilter(status: ArchiveStatus) {
  if (status === 'archived') return { isArchived: true };
  if (status === 'active') return { isArchived: { $ne: true } };
  return {};
}

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Planning.name) private planningModel: Model<PlanningDocument>,
    @InjectModel(Worktime.name) private worktimeModel: Model<WorktimeDocument>,
    @InjectModel(Advance.name) private advanceModel: Model<AdvanceDocument>,
    @InjectModel(Bonus.name) private bonusModel: Model<Bonus>,
  ) {}

  async create(data: Partial<Employee>): Promise<EmployeeDocument> {
    return this.employeeModel.create(data);
  }

  /**
   * Refuses a new (or restored) employee once the company's pack is full.
   * Archived employees don't count. `max` null: no limit.
   */
  async assertRoomFor(max: number | null | undefined) {
    if (!max || max <= 0) return;
    const active = await this.employeeModel.countDocuments(
      archiveFilter('active'),
    );
    if (active >= max) {
      throw new ForbiddenException(
        'Your pack is full: it has no room for another employee. Contact us to upgrade',
      );
    }
  }

  /** Everyone by default (history and reports need the people who left); see archiveStatus. */
  async findAll(status: ArchiveStatus = 'all'): Promise<EmployeeDocument[]> {
    return this.employeeModel.find(archiveFilter(status)).exec();
  }

  async findOne(id: string): Promise<EmployeeDocument> {
    const employee = await this.employeeModel.findById(id).exec();
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async update(id: string, data: Partial<Employee>): Promise<EmployeeDocument> {
    // Archiving has its own routes (it also closes the employee's app account)
    const { isArchived: _a, archivedAt: _b, ...fields } = (data ?? {}) as any;
    const employee = await this.employeeModel
      .findByIdAndUpdate(id, fields, { new: true, runValidators: true })
      .exec();
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /**
   * Archives an employee who left, or brings one back. An archived employee
   * disappears from the daily screens (planning, clock-in, kiosk) and keeps
   * their history, pay and reports. Their personal app account is closed.
   */
  async setArchived(id: string, isArchived: boolean): Promise<EmployeeDocument> {
    const employee = Types.ObjectId.isValid(id)
      ? await this.employeeModel
          .findByIdAndUpdate(
            id,
            { isArchived, archivedAt: isArchived ? new Date() : null },
            { new: true },
          )
          .exec()
      : null;
    if (!employee) throw new NotFoundException('Employee not found');
    if (isArchived) {
      // Users are not tenant-scoped: the employee id is unique to this company
      await this.userModel
        .updateMany(
          { employeeId: employee._id, role: 'staff', active: true },
          { active: false },
        )
        .exec();
    }
    return employee;
  }

  /** How much history an employee has: an employee with any is archived, never deleted. */
  private async historyOf(employee: EmployeeDocument) {
    const id = String(employee._id);
    const emp_id = employee.empNumber;
    const [planning, worktime, advances, bonuses] = await Promise.all([
      this.planningModel.countDocuments({
        $or: [{ empId: id }, { backupEmpIds: id }, { backupEmpId: id }],
      }),
      this.worktimeModel.countDocuments({ emp_id }),
      this.advanceModel.countDocuments({ emp_id }),
      this.bonusModel.countDocuments({ emp_id }),
    ]);
    return planning + worktime + advances + bonuses;
  }

  /**
   * Deletes an employee added by mistake. One with planning, worked time,
   * advances or bonuses is refused: deleting them would leave those records
   * pointing at nobody. Archive them instead.
   */
  async remove(id: string): Promise<EmployeeDocument> {
    const employee = Types.ObjectId.isValid(id)
      ? await this.employeeModel.findById(id).exec()
      : null;
    if (!employee) throw new NotFoundException('Employee not found');
    if ((await this.historyOf(employee)) > 0) {
      throw new ConflictException(
        'This employee has planning, hours or pay on record: archive them instead of deleting them',
      );
    }
    await employee.deleteOne();
    return employee;
  }
}
