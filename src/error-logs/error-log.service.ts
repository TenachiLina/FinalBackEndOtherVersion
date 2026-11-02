import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorLog, ErrorLogDocument } from './error-log.schema';
import { setErrorWriter } from './error-reporter';
import { CompaniesService } from '../companies/companies.service';
import type { ErrorReport } from './error-reporter';

export interface ErrorLogQuery {
  from?: string;
  to?: string;
  level?: string;
  source?: string;
  search?: string;
  fingerprint?: string;
  page?: string;
  limit?: string;
}

const toId = (id?: string | null) =>
  id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SUMMARY_DAYS = 7;

@Injectable()
export class ErrorLogService implements OnModuleInit {
  // This context is never reported, so a failed save can't loop.
  private readonly logger = new Logger('ErrorLogService');

  constructor(
    @InjectModel(ErrorLog.name)
    private readonly errorModel: Model<ErrorLogDocument>,
    private readonly companiesService: CompaniesService,
  ) {}

  // The company's clock, as in "+01:00"; UTC for the super admin's log of every company
  private async utcOffset(companyId: string | null) {
    if (!companyId) return 'Z';
    const company = await this.companiesService.findById(companyId);
    const offset = company?.settings?.utcOffset ?? '';
    return /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '+01:00';
  }

  onModuleInit() {
    setErrorWriter((report) => this.write(report));
  }

  private async write(report: ErrorReport) {
    try {
      await this.errorModel.create({
        ...report,
        companyId: toId(report.companyId),
        userId: toId(report.userId),
      });
    } catch (err) {
      this.logger.error(
        `Couldn't save error "${report.message}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private baseFilter(companyId: string | null) {
    const filter: Record<string, any> = {};
    if (companyId) filter.companyId = new Types.ObjectId(companyId);
    return filter;
  }

  /** One page of errors, newest first. companyId null = every company. */
  async find(companyId: string | null, query: ErrorLogQuery) {
    const filter = this.baseFilter(companyId);
    const created: Record<string, Date> = {};
    // Days are the company's days, not UTC ones: at 00:30 in Algeria, UTC is
    // still on the day before.
    const offset =
      query.from || query.to ? await this.utcOffset(companyId) : 'Z';
    if (query.from) created.$gte = new Date(`${query.from}T00:00:00.000${offset}`);
    if (query.to) created.$lte = new Date(`${query.to}T23:59:59.999${offset}`);
    if (Object.keys(created).length) filter.createdAt = created;
    if (query.level) filter.level = query.level;
    if (query.source) filter.source = query.source;
    if (query.fingerprint) filter.fingerprint = query.fingerprint;
    if (query.search?.trim()) {
      const term = query.search.trim();
      const re = new RegExp(escapeRegex(term), 'i');
      filter.$or = [
        { reference: term.toUpperCase() },
        { message: re },
        { name: re },
        { path: re },
        { where: re },
        { userEmail: re },
        { userName: re },
      ];
    }

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);
    const [items, total] = await Promise.all([
      this.errorModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.errorModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  /** The errors that happened most in the last days, grouped by fingerprint. */
  async summary(companyId: string | null) {
    const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 60 * 60 * 1000);
    const groups = await this.errorModel
      .aggregate([
        { $match: { ...this.baseFilter(companyId), createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$fingerprint',
            count: { $sum: 1 },
            lastSeen: { $first: '$createdAt' },
            firstSeen: { $last: '$createdAt' },
            level: { $first: '$level' },
            source: { $first: '$source' },
            name: { $first: '$name' },
            message: { $first: '$message' },
            hint: { $first: '$hint' },
            where: { $first: '$where' },
            route: { $first: '$route' },
            method: { $first: '$method' },
            users: { $addToSet: '$userId' },
          },
        },
        { $sort: { level: 1, count: -1 } },
        { $limit: 8 },
      ])
      .exec();
    return {
      days: SUMMARY_DAYS,
      groups: groups.map(({ _id, users, ...g }) => ({
        ...g,
        fingerprint: _id,
        affectedUsers: users.filter(Boolean).length,
      })),
    };
  }
}
