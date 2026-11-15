import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Company, CompanyDocument, FEATURES } from './company.schema';
import type { Feature } from './company.schema';
import { Pack, PackDocument } from './pack.schema';
import { cleanPages } from './pages';

export interface PackInput {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  currency?: unknown;
  periodMonths?: unknown;
  features?: unknown;
  disabledPages?: unknown;
  maxEmployees?: unknown;
  trialDays?: unknown;
  active?: unknown;
}

/** The offers the super admin sells. */
@Injectable()
export class PacksService {
  constructor(
    @InjectModel(Pack.name) private readonly packModel: Model<PackDocument>,
    @InjectModel(Company.name)
    private readonly companyModel: Model<CompanyDocument>,
  ) {}

  findAll(): Promise<PackDocument[]> {
    return this.packModel.find().sort({ price: 1, name: 1 }).exec();
  }

  async getById(id: string): Promise<PackDocument> {
    const pack = Types.ObjectId.isValid(id)
      ? await this.packModel.findById(id).exec()
      : null;
    if (!pack) throw new NotFoundException('Pack not found');
    return pack;
  }

  async create(input: PackInput): Promise<PackDocument> {
    const pack = new this.packModel({});
    this.apply(pack, { ...input, name: input?.name ?? '' });
    return this.save(pack);
  }

  async update(id: string, input: PackInput): Promise<PackDocument> {
    const pack = await this.getById(id);
    this.apply(pack, input ?? {});
    return this.save(pack);
  }

  /** Deletes a pack no company uses; a pack in use is archived instead. */
  async remove(id: string) {
    const pack = await this.getById(id);
    const inUse = await this.companyModel.countDocuments({
      'subscription.packId': pack._id,
    });
    if (inUse > 0) {
      throw new ConflictException(
        'This pack is used by a company: archive it instead of deleting it',
      );
    }
    await pack.deleteOne();
    return { deleted: true, name: pack.name };
  }

  private apply(pack: PackDocument, input: PackInput) {
    const number = (
      value: unknown,
      message: string,
      { min, max, whole }: { min: number; max: number; whole?: boolean },
    ) => {
      const n = Number(value);
      if (
        value === '' ||
        value === null ||
        !Number.isFinite(n) ||
        n < min ||
        n > max ||
        (whole && !Number.isInteger(n))
      ) {
        throw new BadRequestException(message);
      }
      return n;
    };

    if (input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!name) throw new BadRequestException('Pack name is required');
      if (name.length > 60) {
        throw new BadRequestException(
          'Pack name must be at most 60 characters',
        );
      }
      pack.name = name;
    }
    if (input.description !== undefined) {
      const description = String(input.description ?? '').trim();
      if (description.length > 300) {
        throw new BadRequestException(
          'Description must be at most 300 characters',
        );
      }
      pack.description = description || undefined;
    }
    if (input.price !== undefined) {
      pack.price = number(input.price, 'Price must be 0 or more', {
        min: 0,
        max: 1_000_000_000,
      });
    }
    if (input.currency !== undefined) {
      const currency = String(input.currency ?? '').trim();
      if (!currency || currency.length > 8) {
        throw new BadRequestException('Currency must be 1 to 8 characters');
      }
      pack.currency = currency;
    }
    if (input.periodMonths !== undefined) {
      pack.periodMonths = number(
        input.periodMonths,
        'Billing period must be 1 to 36 months',
        { min: 1, max: 36, whole: true },
      );
    }
    if (input.features !== undefined) {
      if (
        !Array.isArray(input.features) ||
        input.features.some((f) => !FEATURES.includes(f as Feature))
      ) {
        throw new BadRequestException(
          `Features must be from: ${FEATURES.join(', ')}`,
        );
      }
      pack.features = [...new Set(input.features as Feature[])];
    }
    if (input.disabledPages !== undefined) {
      const pages = cleanPages(input.disabledPages);
      if (!pages) throw new BadRequestException('Unknown page');
      pack.disabledPages = pages;
    }
    if (input.maxEmployees !== undefined) {
      // Empty or 0: no limit
      pack.maxEmployees =
        input.maxEmployees === null ||
        input.maxEmployees === '' ||
        Number(input.maxEmployees) === 0
          ? null
          : number(
              input.maxEmployees,
              'Employee limit must be a whole number, or empty for no limit',
              { min: 1, max: 100_000, whole: true },
            );
    }
    if (input.trialDays !== undefined) {
      pack.trialDays = number(
        input.trialDays,
        'Trial length must be 0 to 365 days',
        { min: 0, max: 365, whole: true },
      );
    }
    if (input.active !== undefined) pack.active = Boolean(input.active);
  }

  private async save(pack: PackDocument) {
    try {
      return await pack.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException('A pack with this name already exists');
      }
      throw err;
    }
  }
}
