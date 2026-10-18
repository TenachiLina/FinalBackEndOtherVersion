import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Company,
  CompanyDevice,
  CompanyDocument,
  CompanySettings,
  Feature,
  FEATURES,
} from './company.schema';

export interface CompanyInput {
  name?: string;
  active?: boolean;
  features?: Feature[];
  settings?: Partial<CompanySettings>;
  devices?: CompanyDevice[];
}

const UTC_OFFSET_RE = /^[+-](0\d|1\d|2[0-3]):[0-5]\d$/;
const CACHE_MS = 30_000;

@Injectable()
export class CompaniesService {
  // The guard loads the company on every request; a short cache keeps that cheap.
  private cache = new Map<string, { company: CompanyDocument; at: number }>();

  constructor(
    @InjectModel(Company.name) private companyModel: Model<CompanyDocument>,
  ) {}

  findAll(): Promise<CompanyDocument[]> {
    return this.companyModel.find().sort({ name: 1 }).exec();
  }

  async findById(id: string, { fresh = false } = {}) {
    if (!Types.ObjectId.isValid(id)) return null;
    const hit = this.cache.get(id);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.company;
    const company = await this.companyModel.findById(id).exec();
    if (company) this.cache.set(id, { company, at: Date.now() });
    else this.cache.delete(id);
    return company;
  }

  async getById(id: string): Promise<CompanyDocument> {
    const company = await this.findById(id, { fresh: true });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  findByDeviceSerial(serial: string): Promise<CompanyDocument | null> {
    return this.companyModel.findOne({ 'devices.serial': serial }).exec();
  }

  async create(input: CompanyInput): Promise<CompanyDocument> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Company name is required');
    const company = new this.companyModel({ name });
    this.apply(company, { ...input, name });
    return this.save(company);
  }

  /** Full update, used by the super admin. */
  async update(id: string, input: CompanyInput): Promise<CompanyDocument> {
    const company = await this.getById(id);
    this.apply(company, input);
    return this.save(company);
  }

  /** What a company's own admin may change: name and settings, not features or devices. */
  async updateOwn(id: string, input: CompanyInput): Promise<CompanyDocument> {
    return this.update(id, { name: input.name, settings: input.settings });
  }

  private apply(company: CompanyDocument, input: CompanyInput) {
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new BadRequestException('Company name is required');
      company.name = name;
    }
    if (input.active !== undefined) company.active = Boolean(input.active);
    if (input.features !== undefined) {
      if (
        !Array.isArray(input.features) ||
        input.features.some((f) => !FEATURES.includes(f))
      ) {
        throw new BadRequestException(
          `Features must be from: ${FEATURES.join(', ')}`,
        );
      }
      company.features = [...new Set(input.features)];
    }
    if (input.settings !== undefined) {
      company.settings = this.validateSettings({
        ...this.plainSettings(company),
        ...input.settings,
      });
    }
    if (input.devices !== undefined) {
      if (!Array.isArray(input.devices)) {
        throw new BadRequestException('Devices must be a list');
      }
      const devices = input.devices
        .map((d) => ({
          serial: String(d?.serial ?? '').trim(),
          name: d?.name ? String(d.name).trim() : undefined,
        }))
        .filter((d) => d.serial);
      if (new Set(devices.map((d) => d.serial)).size !== devices.length) {
        throw new BadRequestException('Each device serial can be listed once');
      }
      company.devices = devices;
    }
  }

  private plainSettings(company: CompanyDocument): CompanySettings {
    const s: any = company.settings ?? {};
    return typeof s.toObject === 'function' ? s.toObject() : { ...s };
  }

  private validateSettings(s: CompanySettings): CompanySettings {
    const positive = (v: unknown, field: string, max: number) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > max) {
        throw new BadRequestException(`${field} must be between 0 and ${max}`);
      }
      return n;
    };
    const currency = String(s.currency ?? '').trim();
    if (!currency || currency.length > 8) {
      throw new BadRequestException('Currency must be 1 to 8 characters');
    }
    if (!UTC_OFFSET_RE.test(String(s.utcOffset))) {
      throw new BadRequestException('UTC offset must look like +01:00');
    }
    return {
      currency,
      utcOffset: String(s.utcOffset),
      hoursPerDay: positive(s.hoursPerDay, 'Hours per day', 24),
      workingDaysPerMonth: positive(
        s.workingDaysPerMonth,
        'Working days per month',
        31,
      ),
      weeklyAdvanceRatio: positive(
        s.weeklyAdvanceRatio,
        'Weekly advance ratio',
        1,
      ),
    };
  }

  private async save(company: CompanyDocument) {
    try {
      const saved = await company.save();
      this.cache.delete(String(saved._id));
      return saved;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          'One of these device serials is already used by another company',
        );
      }
      throw err;
    }
  }
}
