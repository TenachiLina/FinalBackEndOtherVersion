import type { Feature } from './company.schema';

/**
 * The pages a company can have switched off one by one, inside a feature it
 * has. A feature (company.features) switches a whole part of the product on;
 * a page listed in company.disabledPages is then hidden from the menu, and
 * the routes that belong to that page alone are refused (@RequirePage).
 *
 * Example: "clockin" on with "kiosk" off: managers still clock people in
 * from the Clock In / Out page, but the kiosk screen and its account stop.
 */
export const PAGES = {
  // planning
  planningNew: 'planning',
  planningView: 'planning',
  shifts: 'planning',
  // clock-in
  clockinManual: 'clockin',
  kiosk: 'clockin',
  clockinHistory: 'clockin',
  // reporting
  overview: 'reporting',
  attendance: 'reporting',
  monthlyPayroll: 'reporting',
  payslips: 'reporting',
  // advances
  weeklyAdvances: 'advances',
  advancesList: 'advances',
  // bonuses
  bonusesGive: 'bonuses',
  bonusesHistory: 'bonuses',
  // always available unless switched off
  insuredEmployees: null,
  corrections: null,
} as const satisfies Record<string, Feature | null>;

export type Page = keyof typeof PAGES;

export const PAGE_KEYS = Object.keys(PAGES) as Page[];

export const isPage = (value: unknown): value is Page =>
  typeof value === 'string' && value in PAGES;

/** Reads a list of pages to switch off; null when it isn't one. */
export function cleanPages(value: unknown): Page[] | null {
  if (!Array.isArray(value) || value.some((p) => !isPage(p))) return null;
  return [...new Set(value as Page[])];
}
