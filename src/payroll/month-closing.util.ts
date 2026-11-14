// ─────────────────────────────────────────────────────────────────────────
// Month closing: the dates
//
// A month closes by itself a number of days after it ends (the company's
// "Close months after" setting), or earlier when an admin closes it by hand.
// Months are "YYYY-MM"; days are counted in the company's own time zone.
// ─────────────────────────────────────────────────────────────────────────

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UTC_OFFSET = /^([+-])(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && ISO_MONTH.test(value);

/** "+01:00" → 60. Anything else counts as UTC. */
export function offsetMinutes(utcOffset: unknown): number {
  const m = UTC_OFFSET.exec(String(utcOffset ?? ''));
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/**
 * The month ("YYYY-MM") a stored date belongs to. Work time, planning and
 * advance dates are stored as midnight UTC of the day, bonuses as
 * "YYYY-MM-DD" text: both give the day's own month. Null when unreadable.
 */
export function monthOf(date: unknown): string | null {
  if (date == null || date === '') return null;
  if (typeof date === 'string' && /^\d{4}-\d{2}/.test(date)) {
    const month = date.slice(0, 7);
    return isMonth(month) ? month : null;
  }
  const d = date instanceof Date ? date : new Date(date as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}

/** The month after "YYYY-MM". */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12
    ? `${y + 1}-01`
    : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** The moment the month ends: midnight of the 1st of the next month, company time. */
export function monthEnd(month: string, utcOffset: unknown): Date {
  const [y, m] = nextMonth(month).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - offsetMinutes(utcOffset) * 60_000);
}

/** True once the month is over in the company's time zone. */
export function isOver(month: string, utcOffset: unknown, now: Date): boolean {
  return now.getTime() >= monthEnd(month, utcOffset).getTime();
}

/**
 * The company's "Close months after N days" setting as a number of days,
 * or null when months are not closed automatically.
 */
export function closeDelayDays(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
}

/** When the month closes by itself; null when the company closes by hand only. */
export function autoCloseAt(
  month: string,
  delayDays: unknown,
  utcOffset: unknown,
): Date | null {
  const days = closeDelayDays(delayDays);
  if (days === null) return null;
  return new Date(monthEnd(month, utcOffset).getTime() + days * DAY_MS);
}

/** True when the delay after the end of the month has passed. */
export function isAutoCloseDue(
  month: string,
  delayDays: unknown,
  utcOffset: unknown,
  now: Date,
): boolean {
  const at = autoCloseAt(month, delayDays, utcOffset);
  return at !== null && now.getTime() >= at.getTime();
}

/** The 12 months of a year, "YYYY-01" … "YYYY-12". */
export function monthsOfYear(year: number): string[] {
  return Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
  );
}
