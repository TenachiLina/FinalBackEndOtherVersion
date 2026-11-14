// ─────────────────────────────────────────────────────────────────────────
// Payroll formulas
//
// The single place where pay is calculated. The web app and the mobile app
// only show what these functions return (GET /payroll/*), so every screen
// gives the same number.
//
//   hourly rate    = base salary / hours per day / working days per month
//   gross          = worked hours * hourly rate
//   weekly advance = (gross - consumption) * weekly advance ratio
//   monthly net    = gross - penalties - consumption - advances + bonuses
//
// Payslip (fiche de paie), which follows the declared salary, not the hours:
//   post salary     = base / 30 * 30
//   social security = post salary * 9 %
//   net             = post salary - social security
// ─────────────────────────────────────────────────────────────────────────

export interface PayrollSettings {
  hoursPerDay: number;
  workingDaysPerMonth: number;
  /** Share of earned pay offered as a weekly advance; 0.5 = half. */
  weeklyAdvanceRatio: number;
  currency: string;
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  hoursPerDay: 8,
  workingDaysPerMonth: 26,
  weeklyAdvanceRatio: 0.5,
  currency: 'DA',
};

export const PAYSLIP_BASE_DAYS = 30;
export const SOCIAL_SECURITY_RATE = 0.09;

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** A company's payroll settings; anything missing or unusable keeps the default. */
export function payrollSettings(
  settings: Partial<PayrollSettings> | null | undefined,
): PayrollSettings {
  const s = settings ?? {};
  const out = { ...DEFAULT_PAYROLL_SETTINGS };
  // The hourly rate divides by these two, so they must be above 0
  if (isNumber(s.hoursPerDay) && s.hoursPerDay > 0)
    out.hoursPerDay = s.hoursPerDay;
  if (isNumber(s.workingDaysPerMonth) && s.workingDaysPerMonth > 0) {
    out.workingDaysPerMonth = s.workingDaysPerMonth;
  }
  // 0 is a real choice here (no weekly advances), not "not set"
  if (isNumber(s.weeklyAdvanceRatio) && s.weeklyAdvanceRatio >= 0) {
    out.weeklyAdvanceRatio = s.weeklyAdvanceRatio;
  }
  if (s.currency) out.currency = s.currency;
  return out;
}

/** Two decimals, as shown on screen. */
export const round2 = (n: number) => Number(n.toFixed(2));

/** A number from a stored field; anything that isn't one is 0, never NaN. */
export function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** "HH:MM:SS" | "HH:MM" | decimal text | number → decimal hours. */
export function timeToDecimalHours(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const str = String(value).trim();
  if (str === '' || str === '00:00' || str === '00:00:00') return 0;
  if (!str.includes(':')) {
    const num = parseFloat(str);
    return Number.isNaN(num) ? 0 : num;
  }
  // "-01:30" is minus one and a half hours: the sign is for the whole duration
  if (str.startsWith('-')) {
    const rest = str.slice(1);
    const hours = rest.startsWith('-') ? 0 : timeToDecimalHours(rest);
    return hours === 0 ? 0 : -hours;
  }
  const parts = str.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

export function hourlyRate(baseSalary: unknown, s: PayrollSettings): number {
  return toNumber(baseSalary) / s.hoursPerDay / s.workingDaysPerMonth;
}

/** The stored work time fields the formulas read. */
export interface WorktimeLike {
  work_hours?: unknown;
  late_minutes?: unknown;
  overtime_minutes?: unknown;
  penalty?: unknown;
  consomation?: unknown;
  consommation?: unknown;
  absent?: unknown;
}

export interface WorkTotals {
  hours: number;
  penalties: number;
  consommation: number;
  absences: number;
  lateMinutes: number;
  /** Days with some lateness */
  lateDays: number;
  overtimeMinutes: number;
  records: number;
}

export function sumWork(rows: WorktimeLike[]): WorkTotals {
  const totals: WorkTotals = {
    hours: 0,
    penalties: 0,
    consommation: 0,
    absences: 0,
    lateMinutes: 0,
    lateDays: 0,
    overtimeMinutes: 0,
    records: rows.length,
  };
  for (const r of rows) {
    const late = toNumber(r.late_minutes);
    totals.hours += timeToDecimalHours(r.work_hours);
    totals.penalties += toNumber(r.penalty);
    // The collection spells it "consomation"
    totals.consommation += toNumber(r.consommation ?? r.consomation);
    totals.absences += r.absent ? 1 : 0;
    totals.lateMinutes += late;
    totals.lateDays += late > 0 ? 1 : 0;
    totals.overtimeMinutes += toNumber(r.overtime_minutes);
  }
  return totals;
}

export interface PayLine {
  hourlyRate: number;
  hours: number;
  /** hours * hourly rate */
  gross: number;
  penalties: number;
  consommation: number;
  absences: number;
  lateMinutes: number;
  lateDays: number;
  overtimeMinutes: number;
  records: number;
  advances: number;
  bonuses: number;
  /** gross - penalties - consumption - advances + bonuses */
  net: number;
  /** (gross - consumption) * weekly advance ratio; penalties are settled at month end */
  advanceOffer: number;
}

/** One employee's pay for a period, not rounded (totals add these up). */
export function exactPayLine(
  input: {
    baseSalary: unknown;
    rows: WorktimeLike[];
    advances: number;
    bonuses: number;
  },
  s: PayrollSettings,
): PayLine {
  const rate = hourlyRate(input.baseSalary, s);
  const work = sumWork(input.rows);
  const gross = work.hours * rate;
  const net =
    gross -
    work.penalties -
    work.consommation -
    input.advances +
    input.bonuses;
  return {
    hourlyRate: rate,
    hours: work.hours,
    gross,
    penalties: work.penalties,
    consommation: work.consommation,
    absences: work.absences,
    lateMinutes: work.lateMinutes,
    lateDays: work.lateDays,
    overtimeMinutes: work.overtimeMinutes,
    records: work.records,
    advances: input.advances,
    bonuses: input.bonuses,
    net,
    advanceOffer: (gross - work.consommation) * s.weeklyAdvanceRatio,
  };
}

/** The amounts of a line rounded to two decimals, as shown on screen. */
export function roundPayLine(line: PayLine): PayLine {
  return {
    ...line,
    hourlyRate: round2(line.hourlyRate),
    hours: round2(line.hours),
    gross: round2(line.gross),
    penalties: round2(line.penalties),
    consommation: round2(line.consommation),
    advances: round2(line.advances),
    bonuses: round2(line.bonuses),
    net: round2(line.net),
    advanceOffer: round2(line.advanceOffer),
  };
}

/** One employee's pay for a period. Amounts are rounded to two decimals. */
export function payLine(
  input: Parameters<typeof exactPayLine>[0],
  s: PayrollSettings,
): PayLine {
  return roundPayLine(exactPayLine(input, s));
}

export interface PayTotals {
  hours: number;
  gross: number;
  penalties: number;
  consommation: number;
  advances: number;
  bonuses: number;
  net: number;
  absences: number;
  lateMinutes: number;
  /** Records with some lateness */
  lateDays: number;
  overtimeMinutes: number;
  /** Work time records in the period */
  records: number;
  /** Employees with worked hours in the period */
  activeEmployees: number;
  employees: number;
}

/**
 * Company totals. Pass the exact (not rounded) lines: each total is rounded
 * once, so it doesn't drift by a cent per employee.
 */
export function payTotals(lines: PayLine[]): PayTotals {
  const sum = (pick: (l: PayLine) => number) =>
    round2(lines.reduce((total, l) => total + pick(l), 0));
  return {
    hours: sum((l) => l.hours),
    gross: sum((l) => l.gross),
    penalties: sum((l) => l.penalties),
    consommation: sum((l) => l.consommation),
    advances: sum((l) => l.advances),
    bonuses: sum((l) => l.bonuses),
    net: sum((l) => l.net),
    absences: sum((l) => l.absences),
    lateMinutes: sum((l) => l.lateMinutes),
    lateDays: sum((l) => l.lateDays),
    overtimeMinutes: sum((l) => l.overtimeMinutes),
    records: sum((l) => l.records),
    activeEmployees: lines.filter((l) => l.hours > 0).length,
    employees: lines.length,
  };
}

export interface PayslipAmounts {
  days: number;
  baseSalary: number;
  postSalary: number;
  socialSecurity: number;
  net: number;
}

/** Payslip amounts: the declared salary when it is set, otherwise the base salary. */
export function payslipAmounts(employee: {
  baseSalary?: unknown;
  declaredSalary?: unknown;
}): PayslipAmounts {
  const days = PAYSLIP_BASE_DAYS;
  const baseSalary = toNumber(
    employee.declaredSalary != null
      ? employee.declaredSalary
      : employee.baseSalary,
  );
  const postSalary = round2((baseSalary / PAYSLIP_BASE_DAYS) * days);
  const socialSecurity = round2(postSalary * SOCIAL_SECURITY_RATE);
  return {
    days,
    baseSalary,
    postSalary,
    socialSecurity,
    net: round2(postSalary - socialSecurity),
  };
}
