import {
  MISSING_GRACE_MINUTES,
  minutesOf,
} from '../notifications/notifications.util';

// ─────────────────────────────────────────────────────────────────────────
// The Home dashboard: where everyone stands today
//
// Each person appears once, with one status:
//   present   clocked in, not out yet
//   left      clocked in and out
//   absent    marked absent
//   missing   planned, shift started more than half an hour ago, no clock-in
//   expected  planned, shift not started yet (or within the half hour)
// "late" is a flag on someone who clocked in after the start of the shift.
// ─────────────────────────────────────────────────────────────────────────

export type TodayStatus =
  | 'present'
  | 'left'
  | 'absent'
  | 'missing'
  | 'expected';

export interface PlannedShift {
  empNumber: number;
  name: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface ClockRecord {
  empNumber: number;
  name: string;
  clockIn?: string | null;
  clockOut?: string | null;
  lateMinutes?: unknown;
  absent?: unknown;
}

export interface PersonToday {
  empNumber: number;
  name: string;
  status: TodayStatus;
  /** "08:00 – 16:00"; null for someone who came without being planned */
  shift: string | null;
  clockIn: string | null;
  clockOut: string | null;
  late: boolean;
  lateMinutes: number;
}

const ORDER: TodayStatus[] = [
  'missing',
  'absent',
  'present',
  'expected',
  'left',
];

/** Everyone concerned by today, the ones needing attention first, then by name. */
export function todayBoard(
  planned: PlannedShift[],
  records: ClockRecord[],
  nowMinutes: number,
): PersonToday[] {
  const people = new Map<number, PersonToday>();

  // The earliest planned shift of each person
  for (const p of planned) {
    const known = people.get(p.empNumber);
    const start = minutesOf(p.start);
    if (start === null) continue;
    if (known && minutesOf(known.shift?.slice(0, 5)) !== null) {
      if (minutesOf(known.shift!.slice(0, 5))! <= start) continue;
    }
    people.set(p.empNumber, {
      empNumber: p.empNumber,
      name: p.name,
      status:
        nowMinutes >= start + MISSING_GRACE_MINUTES ? 'missing' : 'expected',
      shift: `${p.start} – ${p.end}`,
      clockIn: null,
      clockOut: null,
      late: false,
      lateMinutes: 0,
    });
  }

  for (const r of records) {
    const base: PersonToday = people.get(r.empNumber) ?? {
      empNumber: r.empNumber,
      name: r.name,
      status: 'expected',
      shift: null,
      clockIn: null,
      clockOut: null,
      late: false,
      lateMinutes: 0,
    };
    const lateMinutes = Number(r.lateMinutes) || 0;
    if (r.absent) {
      people.set(r.empNumber, { ...base, status: 'absent' });
    } else if (r.clockIn) {
      // Several records in a day (two shifts): the first arrival, the last departure
      const earlier =
        base.clockIn && minutesOf(base.clockIn)! <= minutesOf(r.clockIn)!;
      const clockIn = earlier ? base.clockIn : r.clockIn;
      const stillIn =
        !r.clockOut || (base.status === 'present' && !!base.clockIn);
      people.set(r.empNumber, {
        ...base,
        status: stillIn ? 'present' : 'left',
        clockIn,
        clockOut: stillIn ? null : (r.clockOut ?? null),
        late: base.late || lateMinutes > 0,
        lateMinutes: Math.max(base.lateMinutes, lateMinutes),
      });
    } else if (!people.has(r.empNumber)) {
      // A record with nothing in it (created ahead, not clocked): nothing to show
      continue;
    }
  }

  return [...people.values()].sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
      a.name.localeCompare(b.name),
  );
}

export interface TodayCounts {
  planned: number;
  present: number;
  left: number;
  late: number;
  absent: number;
  missing: number;
  expected: number;
}

export function countToday(
  people: PersonToday[],
  plannedPeople: number,
): TodayCounts {
  const count = (status: TodayStatus) =>
    people.filter((p) => p.status === status).length;
  return {
    planned: plannedPeople,
    present: count('present'),
    left: count('left'),
    late: people.filter((p) => p.late).length,
    absent: count('absent'),
    missing: count('missing'),
    expected: count('expected'),
  };
}
