// ─────────────────────────────────────────────────────────────────────────
// Notifications: what is worth telling a manager right now
//
// Nothing here is stored or scheduled: the alerts are worked out from
// today's planning and clocking each time the bell asks (GET /notifications).
// Only "I have read this one" is saved, per user (notification-read.schema).
//
// An alert's key changes when its content changes (one more late arrival),
// so it shows as unread again; the same content stays read.
// ─────────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'late' // people who clocked in late today
  | 'missing' // planned, shift started, not clocked in
  | 'absent' // marked absent today
  | 'monthClosing' // a month closes by itself soon
  | 'subscriptionEnding'
  | 'subscriptionEnded'
  | 'deviceSilent'; // a clocking machine stopped talking to the server

export interface NotificationItem {
  key: string;
  type: NotificationType;
  level: 'info' | 'warning' | 'danger';
  /** What the app needs to write the sentence in the user's language */
  params: Record<string, string | number | string[]>;
  /** Where clicking leads */
  href: string;
}

/** A shift counts as missed once it started this long ago with no clock-in. */
export const MISSING_GRACE_MINUTES = 30;
/** A machine that hasn't talked to the server for this long is reported. */
export const DEVICE_SILENT_MS = 15 * 60_000;
/** A month about to close is announced this many days before. */
export const CLOSING_NOTICE_DAYS = 3;

const UTC_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/** The company's own day ("YYYY-MM-DD") and minutes since its midnight. */
export function localNow(now: Date, utcOffset: unknown) {
  const m = UTC_OFFSET.exec(String(utcOffset ?? ''));
  const offset = m
    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
    : 0;
  const local = new Date(now.getTime() + offset * 60_000);
  return {
    day: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** "08:30" → 510. Null when it isn't a time. */
export function minutesOf(time: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? minutes : null;
}

export interface PlannedToday {
  empNumber: number;
  name: string;
  /** "HH:MM" */
  start: string;
}

export interface ClockedToday {
  empNumber: number;
  name: string;
  clockIn?: string | null;
  lateMinutes?: unknown;
  absent?: unknown;
}

/**
 * Today's attendance alerts: who arrived late, who is marked absent, and who
 * is planned on a shift that started more than half an hour ago without
 * clocking in. Each person is named once, in alphabetical order.
 */
export function attendanceToday(
  planned: PlannedToday[],
  clocked: ClockedToday[],
  nowMinutes: number,
) {
  const names = (people: { name: string }[]) =>
    [...new Set(people.map((p) => p.name))].sort((a, b) => a.localeCompare(b));
  const late = clocked.filter((c) => Number(c.lateMinutes) > 0 && !c.absent);
  const absent = clocked.filter((c) => !!c.absent);
  // Anyone with a record today has been dealt with: clocked in, or marked absent
  const seen = new Set(
    clocked.filter((c) => c.clockIn || c.absent).map((c) => c.empNumber),
  );
  const missing = planned.filter((p) => {
    const start = minutesOf(p.start);
    return (
      start !== null &&
      nowMinutes >= start + MISSING_GRACE_MINUTES &&
      !seen.has(p.empNumber)
    );
  });
  return { late: names(late), absent: names(absent), missing: names(missing) };
}

export interface DeviceLike {
  serial: string;
  name?: string | null;
  lastSeenAt?: Date | string | null;
}

/** The machines that talked to the server before, and stopped. */
export function silentDevices(devices: DeviceLike[], now: Date) {
  return devices
    .filter((d) => {
      if (!d.lastSeenAt) return false; // never connected: nothing to compare with
      const seen = new Date(d.lastSeenAt).getTime();
      return (
        !Number.isNaN(seen) && now.getTime() - seen > DEVICE_SILENT_MS
      );
    })
    .map((d) => ({
      serial: d.serial,
      name: d.name || d.serial,
      lastSeenAt: new Date(d.lastSeenAt as Date).toISOString(),
    }));
}

/** The people in an alert, as a short stable fingerprint for its key. */
export function fingerprint(names: string[]): string {
  let hash = 0;
  for (const ch of names.join('|')) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return `${names.length}-${(hash >>> 0).toString(36)}`;
}
