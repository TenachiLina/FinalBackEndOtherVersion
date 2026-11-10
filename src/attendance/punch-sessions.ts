/**
 * Machine punches -> work sessions (clock-in / clock-out), anchored on the
 * planning.
 *
 * The machine doesn't say whether a punch is a clock-in or a clock-out.
 * Counting punches (1st in, 2nd out, 3rd in…) breaks for good after a single
 * missing punch: every later punch is read the wrong way round. Here each
 * planned shift takes the punches made around it, and counting starts again
 * at every shift, so a missing punch spoils one shift only and is reported.
 *
 * Copy of the frontend's src/lib/punchSessions.ts (FinalFrontEndOtherVersion),
 * used by the kiosk: keep both the same.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** A punch this long before a shift starts is still its clock-in. */
export const EARLY_ARRIVAL_MS = 3 * HOUR;
/** A punch this long after a shift ends is still its clock-out. */
export const LATE_DEPARTURE_MS = 4 * HOUR;
/** Without planning, a longer gap between two punches starts a new session. */
export const UNPLANNED_GAP_MS = 14 * HOUR;
/** Without planning, a session lasts at most this long. */
export const UNPLANNED_MAX_SPAN_MS = 16 * HOUR;
/** A punch this soon after the previous one is the same face scanned twice: it is left out. */
export const DUPLICATE_PUNCH_MS = 5 * MINUTE;
/**
 * In a shift with an odd number of punches (3, 5…), a last punch this close
 * to the shift's end (or after it) is the clock-out, and one punch before it
 * is an extra one.
 */
export const NEAR_END_MS = 2 * HOUR;

/** Algeria: UTC+1 all year. */
export const ALGIERS_OFFSET_MINUTES = 60;

/** A shift an employee is planned on. Times are "HH:MM" (or "HH:MM:SS"). */
export interface PlannedShift {
  /** The planning date (YYYY-MM-DD): the work day the shift belongs to. */
  workDate: string;
  start: string;
  end: string;
  shiftId?: string;
}

export interface SessionPeriod<T> {
  clockIn: T | null;
  clockOut: T | null;
}

export interface PunchSession<T> {
  /** Work day (YYYY-MM-DD) the session counts for. */
  workDate: string;
  /** The planned shift, or null for punches outside the planning. */
  shift: PlannedShift | null;
  /** Its punches, oldest first. */
  punches: T[];
  /** in/out pairs; several when the employee took breaks. */
  periods: SessionPeriod<T>[];
  /** First clock-in, null when it's missing. */
  clockIn: T | null;
  /** Last clock-out, null when missing or not made yet. */
  clockOut: T | null;
  /**
   * The punch that should be there and isn't. A clock-out is missing only
   * once the session is over (see `open`).
   */
  missing: 'clockIn' | 'clockOut' | null;
  /** Still in progress: its clock-out can still come. */
  open: boolean;
  /**
   * Punches left out of the clock-ins and clock-outs: the same face scanned
   * twice within DUPLICATE_PUNCH_MS, or a clock-in made twice by mistake.
   * Shown so a manager can delete them.
   */
  extra: T[];
}

/** The real instant of a punch (ms), NaN when unreadable. A time without a zone is Algerian time. */
export function punchInstant(
  timestamp: string,
  offsetMinutes = ALGIERS_OFFSET_MINUTES,
): number {
  if (!timestamp) return NaN;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  if (hasZone) return new Date(timestamp).getTime();
  const local = Date.parse(
    `${timestamp.length === 16 ? `${timestamp}:00` : timestamp}Z`,
  );
  return local - offsetMinutes * MINUTE;
}

/** The local date (YYYY-MM-DD) of an instant. */
export function localDate(
  ms: number,
  offsetMinutes = ALGIERS_OFFSET_MINUTES,
): string {
  return new Date(ms + offsetMinutes * MINUTE).toISOString().slice(0, 10);
}

const minutesOf = (time: string) => {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

/** Start and end instants of a planned shift; an end at or before the start is the next day. */
export function shiftBounds(
  shift: PlannedShift,
  offsetMinutes = ALGIERS_OFFSET_MINUTES,
): { start: number; end: number } {
  const midnight =
    Date.parse(`${shift.workDate}T00:00:00Z`) - offsetMinutes * MINUTE;
  const startMin = minutesOf(shift.start);
  let endMin = minutesOf(shift.end);
  if (endMin <= startMin) endMin += 24 * 60;
  return {
    start: midnight + startMin * MINUTE,
    end: midnight + endMin * MINUTE,
  };
}

interface Options {
  /** Now (ms): tells sessions still in progress from finished ones. */
  now?: number;
  offsetMinutes?: number;
}

/**
 * Groups one employee's punches into work sessions.
 *
 * - A punch from 3 h before a planned shift's start to 4 h after its end
 *   belongs to that shift (the closest one when windows overlap).
 * - Inside a session punches alternate in, out, in, out… from its first
 *   punch, so breaks still work.
 * - A shift with a single punch: while the shift is running it's the
 *   clock-in; afterwards it's whichever of start and end it's closer to, so
 *   a lone 00:34 punch after a 16:00 → 02:00 shift is a clock-out with the
 *   clock-in missing.
 * - A punch less than 5 min after the previous one is a double scan: left
 *   out (see `extra`).
 * - A shift with an odd number of punches (3, 5…) whose last punch is within
 *   2 h of the shift's end, or after it: the last punch is the clock-out and
 *   the punch before it is an extra one (in 16:18, in again 17:39, out
 *   00:11 → 16:18 → 00:11, 17:39 extra). Further from the end, the clock-out
 *   is missing instead (in 08:00, out 12:00, in 13:00 on an 08:00 → 17:00
 *   shift).
 * - Punches outside the planning: a gap of more than 14 h (or a session
 *   longer than 16 h) starts a new session, counted from its first punch.
 */
export function groupPunchesIntoSessions<T extends { timestamp: string }>(
  punches: T[],
  planned: PlannedShift[],
  { now = Date.now(), offsetMinutes = ALGIERS_OFFSET_MINUTES }: Options = {},
): PunchSession<T>[] {
  const timed = punches
    .map((punch) => ({
      punch,
      at: punchInstant(punch.timestamp, offsetMinutes),
    }))
    .sort((a, b) =>
      Number.isNaN(a.at) ? 1 : Number.isNaN(b.at) ? -1 : a.at - b.at,
    );

  const windows = dedupeShifts(planned).map((shift) => {
    const { start, end } = shiftBounds(shift, offsetMinutes);
    return { shift, start, end, punches: [] as { punch: T; at: number }[] };
  });

  const unplanned: { punch: T; at: number }[] = [];
  const sessions: (PunchSession<T> & { sortAt: number })[] = [];

  for (const item of timed) {
    if (Number.isNaN(item.at)) {
      // Unreadable time: shown on its own, nothing can be said about it
      sessions.push({
        workDate: item.punch.timestamp.slice(0, 10),
        shift: null,
        punches: [item.punch],
        periods: [{ clockIn: item.punch, clockOut: null }],
        clockIn: item.punch,
        clockOut: null,
        missing: null,
        open: false,
        extra: [],
        sortAt: Infinity,
      });
      continue;
    }

    let best: (typeof windows)[number] | null = null;
    let bestDistance = Infinity;
    for (const w of windows) {
      if (
        item.at < w.start - EARLY_ARRIVAL_MS ||
        item.at > w.end + LATE_DEPARTURE_MS
      )
        continue;
      const distance =
        item.at < w.start
          ? w.start - item.at
          : item.at > w.end
            ? item.at - w.end
            : 0;
      if (distance < bestDistance) {
        best = w;
        bestDistance = distance;
      }
    }
    if (best) best.punches.push(item);
    else unplanned.push(item);
  }

  for (const w of windows) {
    if (!w.punches.length) continue;
    const open = now <= w.end + LATE_DEPARTURE_MS;
    const { kept, duplicates } = dropDuplicates(w.punches);
    let leadingOut = false;
    let trailingOut = false;
    if (kept.length === 1) {
      const at = kept[0].at;
      const running = now < w.end;
      leadingOut = !running && Math.abs(at - w.end) < Math.abs(at - w.start);
    } else if (kept.length % 2 === 1) {
      trailingOut = kept[kept.length - 1].at >= w.end - NEAR_END_MS;
    }
    sessions.push({
      ...buildSession(
        w.punches.map((p) => p.punch),
        kept.map((p) => p.punch),
        duplicates.map((p) => p.punch),
        { leadingOut, trailingOut, open },
      ),
      workDate: w.shift.workDate,
      shift: w.shift,
      sortAt: w.punches[0].at,
    });
  }

  let group: { punch: T; at: number }[] = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0].at;
    const last = group[group.length - 1].at;
    const open =
      now - last <= UNPLANNED_GAP_MS && now - first <= UNPLANNED_MAX_SPAN_MS;
    const { kept, duplicates } = dropDuplicates(group);
    sessions.push({
      ...buildSession(
        group.map((p) => p.punch),
        kept.map((p) => p.punch),
        duplicates.map((p) => p.punch),
        { leadingOut: false, trailingOut: false, open },
      ),
      workDate: localDate(first, offsetMinutes),
      shift: null,
      sortAt: first,
    });
    group = [];
  };
  for (const item of unplanned) {
    const previous = group[group.length - 1];
    if (
      previous &&
      (item.at - previous.at > UNPLANNED_GAP_MS ||
        item.at - group[0].at > UNPLANNED_MAX_SPAN_MS)
    ) {
      flush();
    }
    group.push(item);
  }
  flush();

  return sessions
    .sort((a, b) => a.sortAt - b.sortAt)
    .map(({ sortAt: _sortAt, ...session }) => session);
}

/** Leaves out a punch made less than DUPLICATE_PUNCH_MS after the previous one kept. */
function dropDuplicates<P extends { at: number }>(
  punches: P[],
): { kept: P[]; duplicates: P[] } {
  const kept: P[] = [];
  const duplicates: P[] = [];
  for (const p of punches) {
    const previous = kept[kept.length - 1];
    if (previous && p.at - previous.at < DUPLICATE_PUNCH_MS) duplicates.push(p);
    else kept.push(p);
  }
  return { kept, duplicates };
}

/**
 * in/out pairs from the first kept punch.
 * `leadingOut`: the only punch is a clock-out.
 * `trailingOut`: odd number of punches whose last is the clock-out; the
 * punch before it is an extra one.
 */
function buildSession<T>(
  all: T[],
  kept: T[],
  duplicates: T[],
  {
    leadingOut,
    trailingOut,
    open,
  }: { leadingOut: boolean; trailingOut: boolean; open: boolean },
): Omit<PunchSession<T>, 'workDate' | 'shift'> {
  const extra = [...duplicates];
  let paired = kept;
  if (trailingOut && kept.length >= 3) {
    extra.push(kept[kept.length - 2]);
    paired = [...kept.slice(0, -2), kept[kept.length - 1]];
  }
  const periods: SessionPeriod<T>[] = [];
  let i = 0;
  if (leadingOut) {
    periods.push({ clockIn: null, clockOut: paired[0] });
    i = 1;
  }
  for (; i < paired.length; i += 2) {
    periods.push({ clockIn: paired[i], clockOut: paired[i + 1] ?? null });
  }
  const first = periods[0];
  const last = periods[periods.length - 1];
  const missing =
    first.clockIn === null
      ? 'clockIn'
      : last.clockOut === null && !open
        ? 'clockOut'
        : null;
  return {
    punches: all,
    periods,
    clockIn: first.clockIn,
    clockOut: last.clockOut,
    missing,
    open,
    extra: all.filter((p) => extra.includes(p)),
  };
}

/** The same shift planned twice on a day counts once. */
function dedupeShifts(planned: PlannedShift[]): PlannedShift[] {
  const seen = new Set<string>();
  return planned.filter((s) => {
    if (!s?.workDate || !s.start || !s.end) return false;
    const key = `${s.workDate}|${s.start.slice(0, 5)}|${s.end.slice(0, 5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Minutes worked: complete in/out periods only. */
export function sessionMinutes<T extends { timestamp: string }>(
  session: Pick<PunchSession<T>, 'periods'>,
  offsetMinutes = ALGIERS_OFFSET_MINUTES,
): number {
  let total = 0;
  for (const p of session.periods) {
    if (!p.clockIn || !p.clockOut) continue;
    const diff =
      punchInstant(p.clockOut.timestamp, offsetMinutes) -
      punchInstant(p.clockIn.timestamp, offsetMinutes);
    if (diff > 0) total += Math.round(diff / MINUTE);
  }
  return total;
}

/** A planning record as the API sends it (populated or plain ids). */
export interface PlanningLike {
  planDate?: string | Date | null;
  empId?: { _id?: unknown; empNumber?: number | string } | string | null;
  shiftId?:
    | { _id?: unknown; startTime?: string; endTime?: string }
    | string
    | null;
}

/**
 * Planned shifts by employee number ("15"). `dateOf` overrides each record's
 * planDate (when the planning was asked for one date). Records without the
 * shift's times are left out.
 */
export function plannedShiftsByEmployee(
  records: PlanningLike[] | null | undefined,
  dateOf?: (record: PlanningLike) => string,
): Map<string, PlannedShift[]> {
  const result = new Map<string, PlannedShift[]>();
  for (const p of records ?? []) {
    const emp = typeof p?.empId === 'object' ? p.empId : null;
    const shift = typeof p?.shiftId === 'object' ? p.shiftId : null;
    const empNumber = emp?.empNumber;
    if (
      empNumber === undefined ||
      empNumber === null ||
      !shift?.startTime ||
      !shift.endTime
    )
      continue;
    const workDate = dateOf ? dateOf(p) : planDateString(p.planDate);
    if (!workDate) continue;
    const key = String(empNumber).trim();
    result.set(key, [
      ...(result.get(key) ?? []),
      {
        workDate,
        start: shift.startTime,
        end: shift.endTime,
        shiftId: shift._id ? String(shift._id) : undefined,
      },
    ]);
  }
  return result;
}

function planDateString(value: PlanningLike['planDate']): string | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}
