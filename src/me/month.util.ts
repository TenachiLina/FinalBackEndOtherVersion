import { BadRequestException } from '@nestjs/common';

export interface MonthRange {
  year: number;
  month: number; // 1-12
  /** First day of the month, UTC midnight (planning and worktime dates are stored so). */
  start: Date;
  /** First day of the next month, UTC midnight (excluded). */
  end: Date;
  /** "YYYY-MM-01" and the last day "YYYY-MM-DD", for string-dated records (bonuses). */
  firstDay: string;
  lastDay: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Reads ?year=&month= into a calendar month. Throws 400 when they are missing or wrong. */
export function parseMonth(year: unknown, month: unknown): MonthRange {
  const y = Number(year);
  const m = Number(month);
  if (
    !/^\d{4}$/.test(String(year ?? '')) ||
    !/^\d{1,2}$/.test(String(month ?? '')) ||
    y < 2000 ||
    y > 2100 ||
    m < 1 ||
    m > 12
  ) {
    throw new BadRequestException(
      'year and month are required (e.g. year=2026&month=11)',
    );
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const last = new Date(end.getTime() - 86_400_000);
  return {
    year: y,
    month: m,
    start,
    end,
    firstDay: `${y}-${pad(m)}-01`,
    lastDay: `${y}-${pad(m)}-${pad(last.getUTCDate())}`,
  };
}

/** "YYYY-MM-DD" of a stored date (UTC calendar day). Null when missing. */
export function dayOf(date: unknown): string | null {
  if (date == null || date === '') return null;
  const d = date instanceof Date ? date : new Date(String(date));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
