import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from './audit-log.schema';
import { User, UserDocument } from '../auth/user.schema';
import { CompaniesService } from '../companies/companies.service';

export type AuditEntry = Omit<
  AuditLog,
  'companyId' | 'userId' | 'createdAt'
> & {
  companyId: string | null;
  userId: string | null;
};

export interface AuditQuery {
  from?: string;
  to?: string;
  userId?: string;
  // An action key ("employee.delete") or a whole group ("employee")
  action?: string;
  search?: string;
  status?: 'success' | 'failed';
  page?: string;
  limit?: string;
}

const toId = (id: string | null) =>
  id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly companiesService: CompaniesService,
  ) {}

  // The company's clock, as in "+01:00"; UTC for the super admin's log of every company
  private async utcOffset(companyId: string | null) {
    if (!companyId) return 'Z';
    const company = await this.companiesService.findById(companyId);
    const offset = company?.settings?.utcOffset ?? '';
    return /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '+01:00';
  }

  /** Never throws: a failed log write must not break the user's action. */
  async record(entry: AuditEntry) {
    try {
      await this.auditModel.create({
        ...entry,
        companyId: toId(entry.companyId),
        userId: toId(entry.userId),
      });
    } catch (err) {
      this.logger.error(
        `Couldn't write activity log "${entry.action}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Who a failed login was for, so the company's admins can see it. */
  async findUserByEmail(email: string) {
    return this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select('name email role companyId')
      .lean()
      .exec();
  }

  /**
   * One page of the log, newest first.
   * companyId null = every company (super admin outside any company).
   */
  async find(companyId: string | null, query: AuditQuery) {
    const filter: Record<string, any> = {};
    if (companyId) filter.companyId = new Types.ObjectId(companyId);

    const created: Record<string, Date> = {};
    // Days are the company's days, not UTC ones: at 00:30 in Algeria, UTC is
    // still on the day before.
    const offset =
      query.from || query.to ? await this.utcOffset(companyId) : 'Z';
    if (query.from) created.$gte = new Date(`${query.from}T00:00:00.000${offset}`);
    if (query.to) created.$lte = new Date(`${query.to}T23:59:59.999${offset}`);
    if (Object.keys(created).length) filter.createdAt = created;

    const userId = toId(query.userId ?? null);
    if (userId) filter.userId = userId;
    if (query.action) {
      filter.action = query.action.includes('.')
        ? query.action
        : new RegExp(`^${escapeRegex(query.action)}\\.`);
    }
    if (query.status === 'success') filter.success = true;
    if (query.status === 'failed') filter.success = false;
    if (query.search?.trim()) {
      const re = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = [
        { userName: re },
        { userEmail: re },
        { target: re },
        { path: re },
      ];
    }

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);
    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  /** Everyone who appears in the log, for the "user" filter. */
  async actors(companyId: string | null) {
    const match: Record<string, any> = { userId: { $ne: null } };
    if (companyId) match.companyId = new Types.ObjectId(companyId);
    const rows = await this.auditModel
      .aggregate<{ _id: Types.ObjectId; name?: string; email?: string }>([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$userId',
            name: { $first: '$userName' },
            email: { $first: '$userEmail' },
          },
        },
        { $sort: { name: 1 } },
      ])
      .exec();
    return rows.map((r) => ({ id: String(r._id), name: r.name, email: r.email }));
  }
}
