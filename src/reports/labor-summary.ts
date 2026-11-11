import { createHash } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────
// Labor summary: hours per station (work post = a task of the planning)
// over a period, for an outside reporting system.
//
// Work time records don't name a station: a record is matched to the
// planning entry of the same employee, day and shift, and gets that
// entry's task. Hours that match no entry are reported with stationCode
// null, so the station rows always add up to the site totals.
//
// Salaries: each employee's monthly base salary counts for the share of
// each calendar month the period covers (from their hire date, when set).
// Employer charges are 34% of the declared salary of insured employees:
// everything sent to social security (the employee's 9% and the
// employer's 25%), as the company counts it. An employee's salary and charges are split between
// stations by the hours they worked there; with no hours, they go to
// stationCode null.
//
// Not included yet (the data doesn't exist): new hires, departures,
// absence hours, overtime pay and contract type. Bonuses and advances are
// per employee, so they are only given for the whole site.
// ─────────────────────────────────────────────────────────────────────────

export const LABOR_SUMMARY_VERSION = '2';

/** Social security on the declared salary: the employee's 9% + the employer's 25% */
export const EMPLOYER_CHARGE_RATE = 0.34;

export interface Period {
  start: string; // "YYYY-MM-DD"
  end: string;
}

export interface LaborSummaryInput {
  period: Period;
  companyId: string;
  currency: string;
  employees: {
    _id: unknown;
    empNumber: number;
    baseSalary?: number;
    insured?: boolean;
    declaredSalary?: number | null;
    hireDate?: string; // "YYYY-MM-DD"
  }[];
  tasks: { taskId: number; taskName: string }[];
  shifts: { _id: unknown; startTime: string; endTime: string }[];
  planning: {
    empId: string;
    shiftId: string;
    taskId: number;
    planDate: Date;
    backupEmpIds?: string[];
    backupEmpId?: string | null;
    customStartTime?: string;
    customEndTime?: string;
  }[];
  worktime: {
    emp_id: number;
    shift_id?: string;
    work_date?: Date;
    work_hours?: string;
    overtime_minutes?: string;
    absent?: boolean;
  }[];
  bonuses: { amount: number }[];
  advances: { amount: number }[];
  generatedAt?: Date;
}

type StationCode = string | null;

const round2 = (n: number) => Math.round(n * 100) / 100;
const hours = (minutes: number) => round2(minutes / 60);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** "HH:MM" (or "HH:MM:SS") to minutes; anything else counts as 0 */
function toMinutes(value: unknown): number {
  const m = /^(\d{1,3}):(\d{2})/.exec(typeof value === 'string' ? value : '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Length of a planned slot; an end at or before the start is the next day */
function slotMinutes(start: string, end: string): number {
  const length = toMinutes(end) - toMinutes(start);
  return length <= 0 ? length + 1440 : length;
}

/** Same code for the same employee every time, without revealing who it is */
function employeeRef(companyId: string, empNumber: number | string): string {
  return (
    'E-' +
    createHash('sha256')
      .update(`${companyId}:${empNumber}`)
      .digest('hex')
      .slice(0, 12)
  );
}

/**
 * How many monthly salaries a period is worth: each calendar month counts
 * for the share of its days inside the period. Starts at `from` (a hire
 * date) when that is later than the period start.
 */
export function monthsCovered(period: Period, from?: string): number {
  const valid = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const start =
    valid(from) && from! > period.start ? from! : period.start;
  if (start > period.end) return 0;
  const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const end = utc(period.end);
  let months = 0;
  let cursor = utc(start);
  while (cursor <= end) {
    const d = new Date(cursor);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthEnd = Date.UTC(y, m + 1, 0);
    const daysInMonth = new Date(monthEnd).getUTCDate();
    const last = Math.min(monthEnd, end);
    months += ((last - cursor) / 86_400_000 + 1) / daysInMonth;
    cursor = Date.UTC(y, m + 1, 1);
  }
  return months;
}

export function buildLaborSummary(input: LaborSummaryInput) {
  const { period, companyId } = input;

  const empNumberById = new Map(
    input.employees.map((e) => [String(e._id), e.empNumber]),
  );
  const shiftById = new Map(input.shifts.map((s) => [String(s._id), s]));
  // An employee deleted since keeps a code of their own
  const refOf = (empId: string) =>
    employeeRef(companyId, empNumberById.get(empId) ?? `id:${empId}`);

  // ── Planned ──────────────────────────────────────────────────────────
  const plannedMinutes = new Map<StationCode, number>();
  const plannedPeople = new Map<StationCode, Set<string>>();
  const slots = new Map<
    string,
    {
      date: string;
      stationCode: string;
      start: string;
      end: string;
      plannedStaff: number;
    }
  >();
  // employee number + day -> the entries they are planned on (or backup for)
  const planned = new Map<string, { shiftId: string; station: string }[]>();
  const backups = new Map<string, { shiftId: string; station: string }[]>();
  const push = <T>(map: Map<string, T[]>, key: string, value: T) =>
    map.set(key, [...(map.get(key) ?? []), value]);

  for (const p of input.planning) {
    const station = String(p.taskId);
    const date = day(new Date(p.planDate));
    const shift = shiftById.get(String(p.shiftId));
    const start = p.customStartTime || shift?.startTime;
    const end = p.customEndTime || shift?.endTime;

    if (!plannedPeople.has(station)) plannedPeople.set(station, new Set());
    plannedPeople.get(station)!.add(refOf(String(p.empId)));

    if (start && end) {
      plannedMinutes.set(
        station,
        (plannedMinutes.get(station) ?? 0) + slotMinutes(start, end),
      );
      const key = `${date}|${station}|${start}|${end}`;
      const slot = slots.get(key) ?? {
        date,
        stationCode: station,
        start,
        end,
        plannedStaff: 0,
      };
      slot.plannedStaff += 1;
      slots.set(key, slot);
    }

    const entry = { shiftId: String(p.shiftId), station };
    const empNumber = empNumberById.get(String(p.empId));
    if (empNumber !== undefined) push(planned, `${empNumber}|${date}`, entry);
    for (const b of new Set([...(p.backupEmpIds ?? []), p.backupEmpId ?? ''])) {
      const n = empNumberById.get(String(b));
      if (n !== undefined) push(backups, `${n}|${date}`, entry);
    }
  }

  /** The station a work time record belongs to, or null when none fits */
  const stationOf = (empNumber: number, date: string, shiftId?: string) => {
    const key = `${empNumber}|${date}`;
    for (const list of [planned.get(key) ?? [], backups.get(key) ?? []]) {
      if (shiftId) {
        const match = list.find((e) => e.shiftId === String(shiftId));
        if (match) return match.station;
      } else if (list.length === 1) {
        return list[0].station;
      }
    }
    return null;
  };

  // ── Worked ───────────────────────────────────────────────────────────
  const regular = new Map<StationCode, number>();
  const overtime = new Map<StationCode, number>();
  const daily = new Map<
    string,
    {
      date: string;
      stationCode: StationCode;
      minutes: number;
      staff: Set<number>;
    }
  >();
  const perEmployee = new Map<
    string,
    {
      employeeRef: string;
      stationCode: StationCode;
      minutes: number;
      cost?: number;
    }
  >();

  for (const w of input.worktime) {
    if (w.absent || !w.work_date) continue;
    const worked = toMinutes(w.work_hours);
    if (worked <= 0) continue;
    const extra = Math.min(
      Math.max(Number(w.overtime_minutes) || 0, 0),
      worked,
    );
    const date = day(new Date(w.work_date));
    const station = stationOf(w.emp_id, date, w.shift_id);

    regular.set(station, (regular.get(station) ?? 0) + worked - extra);
    overtime.set(station, (overtime.get(station) ?? 0) + extra);

    const dayKey = `${date}|${station}`;
    const d = daily.get(dayKey) ?? {
      date,
      stationCode: station,
      minutes: 0,
      staff: new Set<number>(),
    };
    d.minutes += worked;
    d.staff.add(w.emp_id);
    daily.set(dayKey, d);

    const ref = employeeRef(companyId, w.emp_id);
    const lineKey = `${ref}|${station}`;
    const line = perEmployee.get(lineKey) ?? {
      employeeRef: ref,
      stationCode: station,
      minutes: 0,
    };
    line.minutes += worked;
    perEmployee.set(lineKey, line);
  }

  // ── Salaries and charges ─────────────────────────────────────────────
  const salaries = new Map<StationCode, number>();
  const charges = new Map<StationCode, number>();
  const add = (m: Map<StationCode, number>, k: StationCode, v: number) =>
    m.set(k, (m.get(k) ?? 0) + v);
  for (const e of input.employees) {
    const months = monthsCovered(period, e.hireDate);
    const salary = (Number(e.baseSalary) || 0) * months;
    const declared = Number(e.declaredSalary);
    const charge =
      e.insured && e.declaredSalary != null && Number.isFinite(declared)
        ? declared * EMPLOYER_CHARGE_RATE * months
        : 0;
    if (salary + charge <= 0) continue;

    const ref = employeeRef(companyId, e.empNumber);
    const lines = [...perEmployee.values()].filter((l) => l.employeeRef === ref);
    const total = lines.reduce((a, l) => a + l.minutes, 0);
    if (total === 0) {
      // No hours in the period: the cost belongs to no station
      const line = perEmployee.get(`${ref}|null`) ?? {
        employeeRef: ref,
        stationCode: null,
        minutes: 0,
      };
      perEmployee.set(`${ref}|null`, line);
      lines.push(line);
    }
    for (const line of lines) {
      const share = total === 0 ? 1 : line.minutes / total;
      add(salaries, line.stationCode, salary * share);
      add(charges, line.stationCode, charge * share);
      line.cost = (line.cost ?? 0) + (salary + charge) * share;
    }
  }

  // ── Output ───────────────────────────────────────────────────────────
  const names = new Map(input.tasks.map((t) => [String(t.taskId), t.taskName]));
  const byCode = (
    a: { stationCode: StationCode },
    b: { stationCode: StationCode },
  ) =>
    a.stationCode === null
      ? 1
      : b.stationCode === null
        ? -1
        : Number(a.stationCode) - Number(b.stationCode);

  const used = new Set<StationCode>([
    ...plannedPeople.keys(),
    ...regular.keys(),
    ...overtime.keys(),
    ...salaries.keys(),
    ...charges.keys(),
  ]);
  const periodTotals = [...used]
    .map((code) => ({
      period,
      stationCode: code,
      stationName: code === null ? null : (names.get(code) ?? null),
      headcount: code === null ? 0 : (plannedPeople.get(code)?.size ?? 0),
      regularHours: hours(regular.get(code) ?? 0),
      overtimeHours: hours(overtime.get(code) ?? 0),
      plannedHours: hours(plannedMinutes.get(code) ?? 0),
      baseSalaries: round2(salaries.get(code) ?? 0),
      employerCharges: round2(charges.get(code) ?? 0),
      totalLaborCost: round2(
        (salaries.get(code) ?? 0) + (charges.get(code) ?? 0),
      ),
    }))
    .sort(byCode);

  const sum = (m: Map<unknown, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);

  return {
    metadata: {
      source: 'clockinout',
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      version: LABOR_SUMMARY_VERSION,
      period,
      currency: input.currency,
      employerChargeRate: EMPLOYER_CHARGE_RATE,
      stations: [...input.tasks]
        .sort((a, b) => a.taskId - b.taskId)
        // A task is either there or deleted: every listed one is active
        .map((t) => ({
          code: String(t.taskId),
          name: t.taskName,
          active: true,
        })),
    },
    siteTotals: {
      period,
      headcount: input.employees.length,
      regularHours: hours(sum(regular)),
      overtimeHours: hours(sum(overtime)),
      plannedHours: hours(sum(plannedMinutes)),
      bonuses: round2(
        input.bonuses.reduce((a, b) => a + (Number(b.amount) || 0), 0),
      ),
      advancesPaid: round2(
        input.advances.reduce((a, b) => a + (Number(b.amount) || 0), 0),
      ),
      baseSalaries: round2(sum(salaries)),
      employerCharges: round2(sum(charges)),
      // Bonuses only exist for the whole site, so only this total has them
      totalLaborCost: round2(
        sum(salaries) +
          sum(charges) +
          input.bonuses.reduce((a, b) => a + (Number(b.amount) || 0), 0),
      ),
    },
    periodTotals,
    plannedShifts: [...slots.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(a.stationCode) - Number(b.stationCode) ||
        a.start.localeCompare(b.start),
    ),
    dailyWorked: [...daily.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || byCode(a, b))
      .map((d) => ({
        date: d.date,
        stationCode: d.stationCode,
        workedHours: hours(d.minutes),
        staffPresent: d.staff.size,
      })),
    employeeLines: [...perEmployee.values()]
      .sort(
        (a, b) => a.employeeRef.localeCompare(b.employeeRef) || byCode(a, b),
      )
      .map((l) => ({
        employeeRef: l.employeeRef,
        stationCode: l.stationCode,
        hoursWorked: hours(l.minutes),
        laborCost: round2(l.cost ?? 0),
      })),
  };
}
