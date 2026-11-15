import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { CompaniesService } from './companies.service';
import type { CompanyDocument } from './company.schema';
import { PacksService } from './packs.service';
import {
  addDays,
  addMonths,
  endOfDay,
  extendedEnd,
  isIsoDate,
  startOfDay,
} from './subscription.util';

export interface SubscriptionInput {
  /** The pack to give; its features, pages and employee limit are copied onto the company */
  packId?: unknown;
  /** "trial" or "active" (a paid period) */
  kind?: unknown;
  /** "YYYY-MM-DD"; today when missing */
  startsAt?: unknown;
  /** "YYYY-MM-DD", the last day included; otherwise worked out from trialDays / months */
  endsAt?: unknown;
  trialDays?: unknown;
  months?: unknown;
  /** Overrides the pack's limit; empty or 0 for no limit */
  maxEmployees?: unknown;
  note?: unknown;
}

export interface PaymentInput {
  amount?: unknown;
  /** "YYYY-MM-DD"; today when missing */
  date?: unknown;
  /** How it was paid: cash, transfer, cheque… */
  method?: unknown;
  reference?: unknown;
  note?: unknown;
  /** Months this payment adds to the subscription; 0 to record a payment only */
  months?: unknown;
}

type Actor = { id: string; name: string };

const today = (now: Date) => now.toISOString().slice(0, 10);

/**
 * A company's subscription: which pack it has, as a trial or a paid period,
 * until when, and the payments the super admin recorded for it. Payments are
 * made outside the app (cash, transfer): nothing is charged here.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly companies: CompaniesService,
    private readonly packs: PacksService,
  ) {}

  private static text(value: unknown, field: string, max: number) {
    const text = value == null ? '' : String(value).trim();
    if (text.length > max) {
      throw new BadRequestException(
        `${field} must be at most ${max} characters`,
      );
    }
    return text || undefined;
  }

  private static whole(
    value: unknown,
    message: string,
    min: number,
    max: number,
  ) {
    const n = Number(value);
    if (
      value === '' ||
      value === null ||
      !Number.isInteger(n) ||
      n < min ||
      n > max
    ) {
      throw new BadRequestException(message);
    }
    return n;
  }

  /** Gives a company a pack, as a trial or a paid period. */
  async set(
    companyId: string,
    input: SubscriptionInput,
    now = new Date(),
  ): Promise<CompanyDocument> {
    const company = await this.companies.getById(companyId);
    const current: any = company.subscription ?? null;

    const kind = input.kind ?? current?.status;
    if (kind !== 'trial' && kind !== 'active') {
      throw new BadRequestException('Choose a trial or a paid subscription');
    }

    const pack =
      input.packId !== undefined && input.packId !== null && input.packId !== ''
        ? await this.packs.getById(String(input.packId))
        : null;
    if (pack && !pack.active) {
      throw new BadRequestException(
        'This pack is archived: choose another one',
      );
    }
    if (!pack && !current) {
      throw new BadRequestException('Choose a pack');
    }

    const startDay =
      input.startsAt === undefined || input.startsAt === ''
        ? current?.startsAt && !pack && input.kind === undefined
          ? today(new Date(current.startsAt))
          : today(now)
        : input.startsAt;
    if (!isIsoDate(startDay)) {
      throw new BadRequestException('Start date must be YYYY-MM-DD');
    }
    const startsAt = startOfDay(startDay);

    let endsAt: Date;
    if (input.endsAt !== undefined && input.endsAt !== '') {
      if (!isIsoDate(input.endsAt)) {
        throw new BadRequestException('End date must be YYYY-MM-DD');
      }
      endsAt = endOfDay(input.endsAt);
    } else if (kind === 'trial') {
      const days =
        input.trialDays !== undefined && input.trialDays !== ''
          ? SubscriptionsService.whole(
              input.trialDays,
              'Trial length must be 1 to 365 days',
              1,
              365,
            )
          : pack?.trialDays || 14;
      endsAt = endOfDay(today(addDays(startsAt, days)));
    } else {
      const months =
        input.months !== undefined && input.months !== ''
          ? SubscriptionsService.whole(
              input.months,
              'Months must be 1 to 36',
              1,
              36,
            )
          : (pack?.periodMonths ?? 1);
      endsAt = endOfDay(today(addMonths(startsAt, months)));
    }
    if (endsAt.getTime() < startsAt.getTime()) {
      throw new BadRequestException(
        'The end date must be on or after the start',
      );
    }

    let maxEmployees: number | null =
      pack?.maxEmployees ?? current?.maxEmployees ?? null;
    if (input.maxEmployees !== undefined) {
      maxEmployees =
        input.maxEmployees === null ||
        input.maxEmployees === '' ||
        Number(input.maxEmployees) === 0
          ? null
          : SubscriptionsService.whole(
              input.maxEmployees,
              'Employee limit must be a whole number, or empty for no limit',
              1,
              100_000,
            );
    }

    company.subscription = {
      packId: pack ? (pack._id as Types.ObjectId) : (current?.packId ?? null),
      packName: pack?.name ?? current?.packName ?? '',
      status: kind,
      startsAt,
      endsAt,
      maxEmployees,
      price: pack?.price ?? current?.price ?? null,
      currency: pack?.currency ?? current?.currency ?? null,
      periodMonths: pack?.periodMonths ?? current?.periodMonths ?? null,
      note:
        input.note !== undefined
          ? SubscriptionsService.text(input.note, 'Note', 300)
          : current?.note,
      payments: current?.payments ?? [],
    } as any;

    // The pack decides what the company can open
    if (pack) {
      company.features = [...pack.features];
      company.disabledPages = [...(pack.disabledPages ?? [])];
    }
    company.markModified('subscription');
    return this.companies.persist(company);
  }

  /** Records a payment received outside the app, and extends the subscription. */
  async addPayment(
    companyId: string,
    input: PaymentInput,
    by: Actor,
    now = new Date(),
  ): Promise<CompanyDocument> {
    const company = await this.companies.getById(companyId);
    const current: any = company.subscription ?? null;
    if (!current) {
      throw new BadRequestException(
        'Give this company a pack before recording a payment',
      );
    }

    const amount = Number(input.amount);
    if (
      input.amount === '' ||
      input.amount === null ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new BadRequestException('amount must be greater than 0');
    }
    const date =
      input.date === undefined || input.date === '' ? today(now) : input.date;
    if (!isIsoDate(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const months =
      input.months === undefined || input.months === ''
        ? (current.periodMonths ?? 1)
        : SubscriptionsService.whole(
            input.months,
            'Months must be 0 to 36',
            0,
            36,
          );

    const payment = {
      _id: new Types.ObjectId(),
      date,
      amount,
      method: SubscriptionsService.text(input.method, 'Payment method', 40),
      reference: SubscriptionsService.text(input.reference, 'Reference', 80),
      note: SubscriptionsService.text(input.note, 'Note', 300),
      months,
      recordedBy: by.name,
      recordedAt: now,
    };

    const plain = (v: any) => (typeof v?.toObject === 'function' ? v.toObject() : v);
    const next = {
      ...plain(current),
      payments: [...(current.payments ?? []).map(plain), payment],
    };
    if (months > 0) {
      // A payment turns a trial into a paid subscription. The months run on
      // from the current end, or from today when it had already ended.
      next.status = 'active';
      next.endsAt = extendedEnd(current.endsAt, months, endOfDay(today(now)));
    }
    company.subscription = next;
    company.markModified('subscription');
    return this.companies.persist(company);
  }

  /** Removes the subscription: the company is unlimited again, with no end date. */
  async clear(companyId: string): Promise<CompanyDocument> {
    const company = await this.companies.getById(companyId);
    company.subscription = null;
    company.markModified('subscription');
    return this.companies.persist(company);
  }
}
