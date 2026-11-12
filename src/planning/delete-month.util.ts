/**
 * Rules for deleting the planning of a whole month (DELETE /planning/month).
 *
 * A month's planning may only be deleted when nothing depends on it:
 * - never the current month: people are working on it right now
 * - never a month that already has clock-ins or clock-outs: the punches are
 *   paired with the planning, and payroll/reports read both
 *
 * "Now" is read in Algeria (UTC+1 all year), not in the server's time zone,
 * so the current month switches at midnight for the restaurant.
 */

/** Algeria: UTC+1 all year, no daylight saving. */
export const ALGIERS_OFFSET_MINUTES = 60;
const MINUTE = 60 * 1000;

export interface YearMonth {
  /** e.g. 2026 */
  year: number;
  /** 1 = January … 12 = December */
  month: number;
}

/** "2026" + "12" (or "1"…"12", "01"…"09") → { year: 2026, month: 12 }, else null. */
export function parseYearMonth(
  year: unknown,
  month: unknown,
): YearMonth | null {
  if (typeof year !== 'string' || typeof month !== 'string') return null;
  if (!/^\d{4}$/.test(year) || !/^(0?[1-9]|1[0-2])$/.test(month)) return null;
  return { year: Number(year), month: Number(month) };
}

/** The month it is in Algeria at `now`. */
export function currentMonthInAlgiers(now: Date): YearMonth {
  const algiers = new Date(now.getTime() + ALGIERS_OFFSET_MINUTES * MINUTE);
  return { year: algiers.getUTCFullYear(), month: algiers.getUTCMonth() + 1 };
}

/** Orders months: negative when a is before b, 0 when the same month. */
export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/**
 * The month's planning dates. planDate is stored at UTC midnight, so the
 * month is [1st 00:00 UTC, 1st of next month 00:00 UTC).
 */
export function planningRange({ year, month }: YearMonth): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * Where to look for the month's clock-ins and clock-outs.
 *
 * Clocking dates are not all stored the same way: machine punches are real
 * instants (a punch at 00:30 in Algiers on the 1st is 23:30 UTC the day
 * before), worktime.work_date is the server's local midnight or UTC
 * midnight. The Algiers month [1st 00:00 Algiers, next 1st 00:00 Algiers)
 * catches the punches and both kinds of day-dates; the server's own local
 * month is added for a server running in another time zone. On a server in
 * UTC this also catches punches of the first hour of the next month, which
 * only makes the check stricter, never looser.
 */
export function clockingRange(ym: YearMonth): { start: Date; end: Date } {
  const { start: utcStart, end: utcEnd } = planningRange(ym);
  const shift = ALGIERS_OFFSET_MINUTES * MINUTE;
  const algiersStart = utcStart.getTime() - shift;
  const algiersEnd = utcEnd.getTime() - shift;
  const localStart = new Date(ym.year, ym.month - 1, 1).getTime();
  const localEnd = new Date(ym.year, ym.month, 1).getTime();
  return {
    start: new Date(Math.min(algiersStart, localStart)),
    end: new Date(Math.max(algiersEnd, localEnd)),
  };
}

export const MONTH_DELETE_MESSAGES = {
  invalid: 'Choose the month to delete',
  current: "The current month's planning cannot be deleted",
  clocked:
    'This month already has clock-ins or clock-outs: its planning cannot be deleted',
} as const;
