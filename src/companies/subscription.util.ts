// ─────────────────────────────────────────────────────────────────────────
// Subscriptions: the rules
//
// A company either has no subscription (unlimited: companies created before
// packs existed, or ones the super admin leaves free) or one with an end
// date: a trial or a paid period. Payments are made outside the app and
// recorded by the super admin.
//
//   more than 7 days left   nothing is shown
//   7 days or less left     a warning is shown
//   past the end date       the company is read-only: everything can still be
//                           seen and exported, nothing can be changed
// ─────────────────────────────────────────────────────────────────────────

export const WARNING_DAYS = 7;
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SubscriptionKind = 'trial' | 'active';
export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired';

export interface SubscriptionLike {
  status?: SubscriptionKind | string | null;
  endsAt?: Date | string | null;
  packName?: string | null;
  maxEmployees?: number | null;
}

export interface SubscriptionState {
  /** "expired" once the end date has passed, whatever it was before */
  status: SubscriptionStatus;
  /** What it is or was: a trial or a paid period; null without a subscription */
  kind: SubscriptionKind | null;
  packName: string | null;
  endsAt: Date | null;
  /** Whole days left, 0 on the last day; null without an end date */
  daysLeft: number | null;
  /** 7 days or less left */
  endingSoon: boolean;
  /** Past the end date: nothing can be changed any more */
  readOnly: boolean;
  /** null: no limit */
  maxEmployees: number | null;
}

const NONE: SubscriptionState = {
  status: 'none',
  kind: null,
  packName: null,
  endsAt: null,
  daysLeft: null,
  endingSoon: false,
  readOnly: false,
  maxEmployees: null,
};

/** Where a company's subscription stands at `now`. */
export function subscriptionState(
  subscription: SubscriptionLike | null | undefined,
  now: Date = new Date(),
): SubscriptionState {
  if (!subscription || !subscription.endsAt) return NONE;
  const endsAt = new Date(subscription.endsAt);
  if (Number.isNaN(endsAt.getTime())) return NONE;
  const kind: SubscriptionKind =
    subscription.status === 'trial' ? 'trial' : 'active';
  const left = endsAt.getTime() - now.getTime();
  const expired = left < 0;
  const max = subscription.maxEmployees;
  return {
    status: expired ? 'expired' : kind,
    kind,
    packName: subscription.packName ?? null,
    endsAt,
    daysLeft: expired ? 0 : Math.floor(left / DAY_MS),
    endingSoon: !expired && left <= WARNING_DAYS * DAY_MS,
    readOnly: expired,
    maxEmployees: typeof max === 'number' && max > 0 ? max : null,
  };
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  ISO_DATE.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** The first moment of a "YYYY-MM-DD" day (UTC). */
export const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The last moment of a "YYYY-MM-DD" day (UTC): a subscription runs through its end date. */
export const endOfDay = (day: string) => new Date(`${day}T23:59:59.999Z`);

/** `date` plus a number of days. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * `date` plus a number of calendar months, keeping the day of the month
 * (31 January + 1 month = the last day of February).
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * The new end date after a payment for `months` months: counted from the
 * current end date when the subscription is still running, from today when
 * it has already ended (the gap is not charged).
 */
export function extendedEnd(
  currentEnd: Date | string | null | undefined,
  months: number,
  now: Date = new Date(),
): Date {
  const end = currentEnd ? new Date(currentEnd) : null;
  const from = end && end.getTime() > now.getTime() ? end : now;
  return addMonths(from, months);
}
