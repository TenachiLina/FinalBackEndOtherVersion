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
  CompanyBranding,
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
  slug?: string;
  branding?: Partial<CompanyBranding>;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO_CHARS = 400_000; // ~300 KB image
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
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

  findBySlug(slug: string): Promise<CompanyDocument | null> {
    return this.companyModel
      .findOne({ slug: String(slug).trim().toLowerCase(), active: true })
      .exec();
  }

  findByDeviceSerial(serial: string): Promise<CompanyDocument | null> {
    return this.companyModel.findOne({ 'devices.serial': serial }).exec();
  }

  async create(input: CompanyInput): Promise<CompanyDocument> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Company name is required');
    const company = new this.companyModel({ name });
    this.apply(company, { ...input, name });
    await this.ensureSlug(company, input);
    return this.save(company);
  }

  /** Full update, used by the super admin. */
  async update(id: string, input: CompanyInput): Promise<CompanyDocument> {
    const company = await this.getById(id);
    this.apply(company, input);
    await this.ensureSlug(company, input);
    return this.save(company);
  }

  /** What a company's own admin may change: name and settings, not features or devices. */
  async updateOwn(id: string, input: CompanyInput): Promise<CompanyDocument> {
    return this.update(id, { name: input.name, settings: input.settings });
  }

  /** Branding for one company. Shown before login, so nothing sensitive. */
  async publicBranding(slug: string) {
    const company = await this.findBySlug(slug);
    if (!company) throw new NotFoundException('Company not found');
    return {
      name: company.name,
      slug: company.slug,
      branding: company.branding ?? {},
    };
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
    if (input.slug !== undefined) {
      const slug = String(input.slug).trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        throw new BadRequestException(
          'Sign-in link name: lowercase letters, numbers and dashes only',
        );
      }
      company.slug = slug;
    } 
    if (input.branding !== undefined) {
      company.branding = this.validateBranding({
        ...this.plain(company.branding),
        ...input.branding,
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

  /** When no link name was typed, builds one from the name: pizza-roma, pizza-roma-2, ... */
  private async ensureSlug(company: CompanyDocument, input: CompanyInput) {
    if (input.slug !== undefined || company.slug) return;
    const base = slugify(company.name);
    if (!base) return;
    let slug = base;
    for (let n = 2; await this.companyModel.exists({ slug, _id: { $ne: company._id } }); n++) {
      const suffix = `-${n}`;
      slug = base.slice(0, 50 - suffix.length) + suffix;
    }
    company.slug = slug;
  }

  private plain<T>(value: T | undefined): T {
    const v: any = value ?? {};
    return typeof v.toObject === 'function' ? v.toObject() : { ...v };
  }

  private validateBranding(b: Partial<CompanyBranding>): CompanyBranding {
    const text = (v: unknown, field: string, max: number) => {
      const s = v == null ? '' : String(v).trim();
      if (s.length > max) {
        throw new BadRequestException(
          `${field} must be at most ${max} characters`,
        );
      }
      return s || undefined;
    };
    const logo = b.logo ? String(b.logo) : undefined;
    if (logo && (!LOGO_RE.test(logo) || logo.length > MAX_LOGO_CHARS)) {
      throw new BadRequestException(
        'Logo must be a PNG, JPEG, WebP or SVG image under 300 KB',
      );
    }
    const color = text(b.color, 'Colour', 7);
    if (color && !COLOR_RE.test(color)) {
      throw new BadRequestException('Colour must look like #1E40AF');
    }
    return {
      logo,
      title: text(b.title, 'Title', 80),
      subtitle: text(b.subtitle, 'Subtitle', 200),
      color,
    };
  }

  private plainSettings(company: CompanyDocument): CompanySettings {
    const s: any = company.settings ?? {};
    return typeof s.toObject === 'function' ? s.toObject() : { ...s };
  }

  private validateSettings(s: CompanySettings): CompanySettings {
    const positive = (v: unknown, field: string, max: number, allowZero = false) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero) || n > max) {
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
    const language = String(s.language ?? 'en');
    if (!['en', 'fr', 'ar'].includes(language)) {
      throw new BadRequestException('Language must be en, fr or ar');
    }
    return {
      language,
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
        true,
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
          'That sign-in link name or one of the device serials is already used by another company',
        );
      }
      throw err;
    }
  }
}
