import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';

/**
 * Works out exactly what an action changed, for the activity log.
 *
 * Before an update or delete runs, the record is read ("snapshot"); after it
 * succeeds, it is read again and both versions are compared field by field.
 * Values are turned into what people recognise: employee names instead of
 * IDs, shift hours instead of shift IDs, dates in the company's time zone.
 *
 * Labels and values are English; the app translates them.
 */

export interface Change {
  label: string;
  // Missing before = added; missing after = removed
  before?: string;
  after?: string;
}

export interface ChangeSummary {
  target?: string;
  changes: Change[];
  // A more precise action than the route's, e.g. "worktime.clockOut"
  action?: string;
  // Nothing worth logging happened (e.g. the same times saved again)
  skip?: boolean;
}

// Fields a normal clock-in or clock-out fills in. Any other change to a
// work-time record means someone edited it.
const CLOCK_FIELDS = new Set([
  'clock_in',
  'clock_out',
  'work_hours',
  'late_minutes',
  'overtime_minutes',
  'shift_id',
  'work_date',
  'emp_id',
]);
const IGNORED_FIELDS = new Set(['_id', '__v', 'companyId']);

const MAX_CHANGES = 40;

type Fmt = (value: any, lk: Lookups) => Promise<string> | string;
type FieldSpec = [path: string, label: string, fmt?: Fmt];

interface Tracker {
  model: string;
  fields: FieldSpec[];
  target: (doc: any, lk: Lookups) => Promise<string | undefined>;
  // Where the record's id comes from (default: the :id in the URL)
  id?: (req: any) => string | undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

const get = (obj: any, path: string) =>
  path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

// Values that mean "nothing set": left out when listing a new or deleted record
const isBlank = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === '' ||
  v === false ||
  v === 0 ||
  v === '0' ||
  v === '00:00' ||
  (Array.isArray(v) && v.length === 0);

const idOf = (v: any): string | undefined =>
  v == null ? undefined : String(v._id ?? v);

/** Names for IDs, read once per request. */
class Lookups {
  private cache = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly models: Connection['models'],
    // Company clock offset in minutes, for dates and times
    readonly offsetMinutes: number,
  ) {}

  private memo(key: string, load: () => Promise<string | undefined>) {
    if (!this.cache.has(key)) this.cache.set(key, load().catch(() => undefined));
    return this.cache.get(key)!;
  }

  private find(model: string, filter: any, select: string) {
    const m = this.models[model] as Model<any> | undefined;
    return m ? m.findOne(filter).select(select).lean<any>().exec() : null;
  }

  private static fullName(e: any) {
    return e ? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() : undefined;
  }

  async employeeById(id: unknown) {
    const key = idOf(id);
    if (!key) return '';
    if (!Types.ObjectId.isValid(key)) return key;
    const name = await this.memo(`emp:${key}`, async () =>
      Lookups.fullName(
        await this.find('Employee', { _id: key }, 'firstName lastName'),
      ),
    );
    return name || `Employee ${key.slice(-6)}`;
  }

  async employeeByNumber(n: unknown) {
    if (n === undefined || n === null || n === '') return '';
    const num = Number(n);
    const name = Number.isFinite(num)
      ? await this.memo(`empn:${num}`, async () =>
          Lookups.fullName(
            await this.find('Employee', { empNumber: num }, 'firstName lastName'),
          ),
        )
      : undefined;
    return name ? `${name} (#${n})` : `Employee #${n}`;
  }

  async shift(id: unknown) {
    const key = idOf(id);
    if (!key) return '';
    if (!Types.ObjectId.isValid(key)) return key;
    const label = await this.memo(`shift:${key}`, async () => {
      const s = await this.find('Shift', { _id: key }, 'startTime endTime');
      return s ? `${s.startTime}–${s.endTime}` : undefined;
    });
    return label ? `Shift ${label}` : `Shift ${key.slice(-6)}`;
  }

  async task(taskId: unknown) {
    if (taskId === undefined || taskId === null || taskId === '') return '';
    const num = Number(taskId);
    const name = Number.isFinite(num)
      ? await this.memo(`task:${num}`, async () => {
          const t = await this.find('Task', { taskId: num }, 'taskName');
          return t?.taskName;
        })
      : undefined;
    return name ?? `Task #${taskId}`;
  }

  /** "2026-10-20 08:03" in the company's local time. */
  dateTime(v: unknown) {
    if (!v) return '';
    const d = new Date(v as any);
    if (Number.isNaN(d.getTime())) return String(v);
    const l = new Date(d.getTime() + this.offsetMinutes * 60_000);
    return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`;
  }

  date(v: unknown) {
    return this.dateTime(v).slice(0, 10);
  }
}

// ── Formatters ──────────────────────────────────────────────────────────────

const yesNo: Fmt = (v) => (v ? 'Yes' : 'No');
// "00:00" is how the app stores "not clocked yet"
const clockTime: Fmt = (v) => (!v || v === '00:00' ? '' : String(v));
const date: Fmt = (v, lk) => lk.date(v);
const dateTime: Fmt = (v, lk) => lk.dateTime(v);
const empById: Fmt = (v, lk) => lk.employeeById(v);
const empByNumber: Fmt = (v, lk) => lk.employeeByNumber(v);
const shift: Fmt = (v, lk) => lk.shift(v);
const task: Fmt = (v, lk) => lk.task(v);
const list =
  (each: Fmt): Fmt =>
  async (v, lk) =>
    Array.isArray(v)
      ? (await Promise.all(v.map((x) => each(x, lk)))).filter(Boolean).join(', ')
      : '';
const plain: Fmt = (v) =>
  v === undefined || v === null
    ? ''
    : Array.isArray(v)
      ? v.join(', ')
      : String(v);
const subTasks: Fmt = (v) =>
  Array.isArray(v)
    ? v
        .map((t: any) =>
          [t?.label, t?.startTime && t?.endTime && `${t.startTime}–${t.endTime}`]
            .filter(Boolean)
            .join(' '),
        )
        .join(', ')
    : '';

// ── What to compare for each kind of record ─────────────────────────────────

const WORKTIME: Tracker = {
  model: 'Worktime',
  target: async (d, lk) =>
    d && `${await lk.employeeByNumber(d.emp_id)} · ${lk.date(d.work_date)}`,
  fields: [
    ['emp_id', 'Employee', empByNumber],
    ['work_date', 'Day', date],
    ['shift_id', 'Shift', shift],
    ['clock_in', 'Clock-in time', clockTime],
    ['clock_out', 'Clock-out time', clockTime],
    ['work_hours', 'Hours worked'],
    ['late_minutes', 'Minutes late'],
    ['overtime_minutes', 'Overtime minutes'],
    ['absent', 'Absent', yesNo],
    ['absent_comment', 'Absence reason'],
    ['backup_emp_id', 'Replaced by', empByNumber],
    ['backup_for_emp_id', 'Replacing', empByNumber],
    ['penalty', 'Penalty'],
    ['bonus', 'Bonus'],
    ['consomation', 'Consumption'],
  ],
};

const PLANNING_FIELDS: FieldSpec[] = [
  ['empId', 'Employee', empById],
  ['planDate', 'Day', date],
  ['shiftId', 'Shift', shift],
  ['taskId', 'Task', task],
  ['backupEmpIds', 'Backups', list(empById)],
  ['customStartTime', 'Start time'],
  ['customEndTime', 'End time'],
  ['tasks', 'Sub-tasks', subTasks],
];

const PLANNING: Tracker = {
  model: 'Planning',
  target: async (d, lk) =>
    d && `${await lk.employeeById(d.empId)} · ${lk.date(d.planDate)}`,
  fields: PLANNING_FIELDS,
};

const COMPANY_FIELDS: FieldSpec[] = [
  ['name', 'Company name'],
  ['slug', 'Sign-in link name'],
  ['active', 'Active', yesNo],
  ['features', 'Features', plain],
  ['settings.language', 'Default language'],
  ['settings.currency', 'Currency'],
  ['settings.utcOffset', 'Time zone (UTC offset)'],
  ['settings.hoursPerDay', 'Hours per day'],
  ['settings.workingDaysPerMonth', 'Working days per month'],
  ['settings.weeklyAdvanceRatio', 'Weekly advance share'],
  ['branding.title', 'Sign-in page title'],
  ['branding.subtitle', 'Sign-in page subtitle'],
  ['branding.color', 'Sign-in page colour'],
  ['branding.logo', 'Logo', (v) => (v ? 'Logo set' : '')],
  ['devices', 'Clocking machines', (v) =>
    Array.isArray(v)
      ? v.map((d: any) => [d.name, d.serial].filter(Boolean).join(' ')).join(', ')
      : ''],
];

const empMoney = (model: string): Tracker => ({
  model,
  target: (d, lk) => (d ? lk.employeeByNumber(d.emp_id) : Promise.resolve(undefined)),
  fields: [
    ['emp_id', 'Employee', empByNumber],
    ['amount', 'Amount'],
    ['date', 'Date', date],
    ['reason', 'Reason'],
  ],
});

const TRACKERS: Record<string, Tracker> = {
  worktime: WORKTIME,
  planning: PLANNING,
  employee: {
    model: 'Employee',
    target: async (d) =>
      d && `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() + (d.empNumber ? ` (#${d.empNumber})` : ''),
    fields: [
      ['firstName', 'First name'],
      ['lastName', 'Last name'],
      ['empNumber', 'Employee number'],
      ['phoneNumber', 'Phone number'],
      ['address', 'Address'],
      ['baseSalary', 'Base salary'],
      ['personalImage', 'Photo', (v) => (v ? 'Photo set' : '')],
    ],
  },
  shift: {
    model: 'Shift',
    target: async (d) => d && `Shift ${d.startTime}–${d.endTime}`,
    fields: [
      ['startTime', 'Start time'],
      ['endTime', 'End time'],
      ['isArchived', 'Archived', yesNo],
    ],
  },
  task: {
    model: 'Task',
    target: async (d) => d && `${d.taskName} (#${d.taskId})`,
    fields: [
      ['taskId', 'Task number'],
      ['taskName', 'Task name'],
    ],
  },
  punch: {
    model: 'RawAttendanceLog',
    target: (d, lk) => (d ? lk.employeeByNumber(d.deviceUserId) : Promise.resolve(undefined)),
    fields: [
      ['deviceUserId', 'Employee', empByNumber],
      ['timestamp', 'Punch time', dateTime],
    ],
  },
  advance: empMoney('Advance'),
  bonus: empMoney('Bonus'),
  user: {
    model: 'User',
    target: async (d) => d && `${d.name} (${d.email})`,
    fields: [
      ['name', 'Name'],
      ['email', 'Email'],
      ['role', 'Role'],
      ['active', 'Active', yesNo],
    ],
  },
  company: { model: 'Company', target: async (d) => d?.name, fields: COMPANY_FIELDS },
  companySettings: {
    model: 'Company',
    target: async (d) => d?.name,
    fields: COMPANY_FIELDS,
    id: (req) => req.user?.companyId ?? undefined,
  },
};

function offsetMinutes(offset: unknown) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset ?? ''));
  if (!m) return 60;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The planning day the bulk save replaces, computed like PlanningService.bulkSave. */
function dayRange(planDate: unknown) {
  const start = new Date(String(planDate));
  if (Number.isNaN(start.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  const end = new Date(String(planDate));
  end.setHours(23, 59, 59, 999);
  return { $gte: start, $lte: end };
}

export type Snapshot = { doc?: any; day?: any[] } | undefined;

@Injectable()
export class AuditChanges {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private model(name: string) {
    return this.connection.models[name] as Model<any> | undefined;
  }

  private lookups(req: any) {
    return new Lookups(
      this.connection.models,
      offsetMinutes(req.company?.settings?.utcOffset),
    );
  }

  private trackerFor(action: string) {
    return TRACKERS[action.split('.')[0]];
  }

  /** Reads what is about to change. Runs before the action. */
  async snapshot(action: string, req: any): Promise<Snapshot> {
    if (action === 'planning.saveDay') {
      const range = dayRange(req.body?.planDate);
      const m = this.model('Planning');
      return range && m
        ? { day: await m.find({ planDate: range }).lean().exec() }
        : undefined;
    }
    const tracker = this.trackerFor(action);
    if (!tracker || action.endsWith('.create')) return undefined;
    const id = tracker.id ? tracker.id(req) : req.params?.id;
    const m = this.model(tracker.model);
    if (!id || !m || !Types.ObjectId.isValid(id)) return undefined;
    return { doc: await m.findById(id).lean().exec() };
  }

  /** Compares before and after. Runs once the action has succeeded. */
  async describe(
    action: string,
    req: any,
    result: any,
    before: Snapshot,
  ): Promise<ChangeSummary | undefined> {
    const lk = this.lookups(req);
    if (action === 'planning.saveDay') return this.describeDay(req, before, lk);

    const tracker = this.trackerFor(action);
    if (!tracker) return undefined;
    const m = this.model(tracker.model);
    const isDelete = action.endsWith('.delete');
    const isCreate = action.endsWith('.create');

    let after: any = null;
    if (!isDelete && m) {
      const id = isCreate
        ? idOf(result?.data ?? result)
        : tracker.id
          ? tracker.id(req)
          : req.params?.id;
      if (id && Types.ObjectId.isValid(id)) {
        after = await m.findById(id).lean().exec();
      }
    }
    const old = before?.doc ?? null;
    if (!old && !after) return undefined;
    const target = await tracker.target(after ?? old, lk);

    if (tracker === WORKTIME && after) {
      const clock = this.clockAction(req, old, after);
      if (clock) return { target, ...clock };
    }
    const changes = await this.diff(tracker.fields, old, after, lk);
    // Pages re-save work time often; an update that changed nothing is noise.
    if (tracker === WORKTIME && old && after && !changes.length) {
      return { target, changes, skip: true };
    }
    return { target, changes };
  }

  /**
   * A work-time save that is just someone clocking in or out (the clock
   * buttons, the clocking machine) is logged as "Clocked in at 08:00" rather
   * than as an edit. The page says which it was in the X-Audit-As header
   * ("clock" or "edit"); without it, a time going from empty to a value with
   * only the computed totals changing counts as clocking.
   */
  private clockAction(req: any, old: any, after: any) {
    const said = String(req.headers?.['x-audit-as'] ?? '').toLowerCase();
    if (said === 'edit') return null;

    const inChanged = old?.clock_in !== after.clock_in && !isBlank(after.clock_in);
    const outChanged = old?.clock_out !== after.clock_out && !isBlank(after.clock_out);
    if (!inChanged && !outChanged) return null;

    if (said !== 'clock') {
      const replacedTime =
        (inChanged && !isBlank(old?.clock_in)) ||
        (outChanged && !isBlank(old?.clock_out));
      const keys = new Set([...Object.keys(old ?? {}), ...Object.keys(after)]);
      const otherChange = [...keys].some((k) => {
        if (CLOCK_FIELDS.has(k) || IGNORED_FIELDS.has(k)) return false;
        const b = old?.[k];
        const a = after[k];
        return !(isBlank(b) && isBlank(a)) && JSON.stringify(b) !== JSON.stringify(a);
      });
      if (replacedTime || otherChange) return null;
    }

    const changes: Change[] = [];
    if (inChanged) changes.push({ label: 'Clock-in time', after: after.clock_in });
    if (outChanged) changes.push({ label: 'Clock-out time', after: after.clock_out });
    return {
      action:
        inChanged && outChanged
          ? 'worktime.clockInOut'
          : inChanged
            ? 'worktime.clockIn'
            : 'worktime.clockOut',
      changes,
    };
  }

  /**
   * Error path: the action failed, but the snapshot still says which record
   * it was about.
   */
  async targetOf(action: string, req: any, before: Snapshot) {
    if (action === 'planning.saveDay') return this.lookups(req).date(req.body?.planDate);
    const tracker = this.trackerFor(action);
    return before?.doc && tracker
      ? tracker.target(before.doc, this.lookups(req))
      : undefined;
  }

  private async diff(
    fields: FieldSpec[],
    before: any,
    after: any,
    lk: Lookups,
  ): Promise<Change[]> {
    const changes: Change[] = [];
    for (const [path, label, fmt = plain] of fields) {
      const b = before ? get(before, path) : undefined;
      const a = after ? get(after, path) : undefined;
      // New record: list what was filled in. Deleted record: what it held.
      if (!before && isBlank(a)) continue;
      if (!after && isBlank(b)) continue;
      if (before && after && JSON.stringify(b) === JSON.stringify(a)) continue;

      const fb = before ? await fmt(b, lk) : undefined;
      const fa = after ? await fmt(a, lk) : undefined;
      if (before && after && fb === fa) {
        // Different underneath but looks the same (e.g. a new photo)
        changes.push({ label, after: 'Changed' });
      } else {
        changes.push({ label, before: fb || (before ? '—' : undefined), after: fa || (after ? '—' : undefined) });
      }
    }
    return changes;
  }

  /** Saving a planning day replaces all its entries: show who was added, removed or moved. */
  private async describeDay(req: any, before: Snapshot, lk: Lookups) {
    const range = dayRange(req.body?.planDate);
    const m = this.model('Planning');
    if (!range || !m) return undefined;
    const afterDocs = await m.find({ planDate: range }).lean().exec();

    const describeEntry = async (e: any) => {
      const parts = [
        await lk.employeeById(e.empId),
        await lk.shift(e.shiftId),
        await lk.task(e.taskId),
      ];
      const backups = await list(empById)(e.backupEmpIds, lk);
      if (backups) parts.push(`backups: ${backups}`);
      if (e.customStartTime || e.customEndTime) {
        parts.push(`${e.customStartTime ?? '?'}–${e.customEndTime ?? '?'}`);
      }
      const subs = subTasks(e.tasks, lk) as string;
      if (subs) parts.push(`sub-tasks: ${subs}`);
      return parts.filter(Boolean).join(' · ');
    };
    const byKey = async (docs: any[]) => {
      const map = new Map<string, string>();
      for (const e of docs) {
        let key = `${idOf(e.empId)}|${idOf(e.shiftId)}`;
        while (map.has(key)) key += '+';
        map.set(key, await describeEntry(e));
      }
      return map;
    };
    const oldMap = await byKey(before?.day ?? []);
    const newMap = await byKey(afterDocs);

    const changes: Change[] = [];
    for (const [key, desc] of newMap) {
      const old = oldMap.get(key);
      if (old === undefined) changes.push({ label: 'Added', after: desc });
      else if (old !== desc) changes.push({ label: 'Changed', before: old, after: desc });
    }
    for (const [key, desc] of oldMap) {
      if (!newMap.has(key)) changes.push({ label: 'Removed', before: desc });
    }
    if (changes.length > MAX_CHANGES) {
      const more = changes.length - MAX_CHANGES;
      changes.splice(MAX_CHANGES);
      changes.push({ label: 'And more', after: `${more}` });
    }
    if (!changes.length) changes.push({ label: 'Saved without changes' });

    return { target: lk.date(req.body?.planDate), changes };
  }
}
