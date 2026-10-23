import { AuditChanges } from './audit-changes';

const SHIFT = '64b7f0c2a1b2c3d4e5f60001';
const SHIFT2 = '64b7f0c2a1b2c3d4e5f60002';
const SARA = '64b7f0c2a1b2c3d4e5f6a001';
const KARIM = '64b7f0c2a1b2c3d4e5f6a002';
const WT = '64b7f0c2a1b2c3d4e5f6b001';

const query = (value: () => any) => {
  const q: any = {
    select: () => q,
    lean: () => q,
    exec: async () => value(),
  };
  return q;
};

/** A minimal stand-in for a Mongoose model over an in-memory list. */
function fakeModel(rows: () => any[]) {
  const matches = (row: any, filter: any) =>
    Object.entries(filter ?? {}).every(([k, v]) =>
      k === 'planDate' ? true : String(row[k]) === String(v),
    );
  return {
    findById: (id: string) => query(() => rows().find((r) => String(r._id) === id) ?? null),
    findOne: (f: any) => query(() => rows().find((r) => matches(r, f)) ?? null),
    find: (f: any) => query(() => rows().filter((r) => matches(r, f))),
  };
}

describe('AuditChanges', () => {
  let worktime: any[];
  let planning: any[];
  let changes: AuditChanges;
  const req = (extra: any) => ({ company: { settings: { utcOffset: '+01:00' } }, ...extra });

  beforeEach(() => {
    worktime = [
      { _id: WT, emp_id: 12, work_date: new Date('2026-10-20T00:00:00Z'), clock_in: '08:00', clock_out: '17:00', absent: false },
    ];
    planning = [
      { _id: 'p1', empId: SARA, shiftId: SHIFT, taskId: 1, planDate: new Date('2026-10-20') },
      { _id: 'p2', empId: KARIM, shiftId: SHIFT, taskId: 1, planDate: new Date('2026-10-20') },
    ];
    const connection: any = {
      models: {
        Worktime: fakeModel(() => worktime),
        Planning: fakeModel(() => planning),
        Employee: fakeModel(() => [
          { _id: SARA, empNumber: 12, firstName: 'Sara', lastName: 'Benali' },
          { _id: KARIM, empNumber: 13, firstName: 'Karim', lastName: 'Haddad' },
        ]),
        Shift: fakeModel(() => [
          { _id: SHIFT, startTime: '08:00', endTime: '16:00' },
          { _id: SHIFT2, startTime: '16:00', endTime: '00:00' },
        ]),
        Task: fakeModel(() => [
          { taskId: 1, taskName: 'Cashier' },
          { taskId: 2, taskName: 'Kitchen' },
        ]),
      },
    };
    changes = new AuditChanges(connection);
  });

  it('shows which work-time fields changed, with the employee and day', async () => {
    const r = req({ params: { id: WT } });
    const before = await changes.snapshot('worktime.update', r);
    worktime[0] = { ...worktime[0], clock_out: '18:30', absent: true, absent_comment: 'Sick' };

    const summary = await changes.describe('worktime.update', r, {}, before);
    expect(summary?.target).toBe('Sara Benali (#12) · 2026-10-20');
    expect(summary?.changes).toEqual([
      { label: 'Clock-out time', before: '17:00', after: '18:30' },
      { label: 'Absent', before: 'No', after: 'Yes' },
      { label: 'Absence reason', before: '—', after: 'Sick' },
    ]);
  });

  describe('clocking in and out', () => {
    beforeEach(() => {
      worktime[0] = { ...worktime[0], clock_out: '00:00', overtime_minutes: '0' };
    });

    it('logs a first clock-out as "clocked out", not as an edit', async () => {
      const r = req({ params: { id: WT }, headers: {} });
      const before = await changes.snapshot('worktime.update', r);
      worktime[0] = { ...worktime[0], clock_out: '13:02', overtime_minutes: '662' };

      const summary = await changes.describe('worktime.update', r, {}, before);
      expect(summary).toMatchObject({
        action: 'worktime.clockOut',
        target: 'Sara Benali (#12) · 2026-10-20',
        changes: [{ label: 'Clock-out time', after: '13:02' }],
      });
    });

    it('logs a changed time as an edit', async () => {
      worktime[0] = { ...worktime[0], clock_out: '13:02' };
      const r = req({ params: { id: WT }, headers: {} });
      const before = await changes.snapshot('worktime.update', r);
      worktime[0] = { ...worktime[0], clock_out: '15:02', work_hours: '02:00' };

      const summary = await changes.describe('worktime.update', r, {}, before);
      expect(summary?.action).toBeUndefined();
      expect(summary?.changes).toContainEqual({ label: 'Clock-out time', before: '13:02', after: '15:02' });
    });

    it('follows what the page says: an edit button that fills an empty time is an edit', async () => {
      const r = req({ params: { id: WT }, headers: { 'x-audit-as': 'edit' } });
      const before = await changes.snapshot('worktime.update', r);
      worktime[0] = { ...worktime[0], clock_out: '13:02' };

      const summary = await changes.describe('worktime.update', r, {}, before);
      expect(summary?.action).toBeUndefined();
      expect(summary?.changes).toContainEqual({ label: 'Clock-out time', before: '—', after: '13:02' });
    });

    it('follows what the page says: a second clock-out the same day is still a clock-out', async () => {
      worktime[0] = { ...worktime[0], clock_out: '13:02' };
      const r = req({ params: { id: WT }, headers: { 'x-audit-as': 'clock' } });
      const before = await changes.snapshot('worktime.update', r);
      worktime[0] = { ...worktime[0], clock_out: '19:10' };

      const summary = await changes.describe('worktime.update', r, {}, before);
      expect(summary?.action).toBe('worktime.clockOut');
    });

    it('skips saves that changed nothing', async () => {
      const r = req({ params: { id: WT }, headers: { 'x-audit-as': 'clock' } });
      const before = await changes.snapshot('worktime.update', r);
      const summary = await changes.describe('worktime.update', r, {}, before);
      expect(summary?.skip).toBe(true);
    });
  });

  it('lists who was added, moved or removed when a planning day is saved', async () => {
    const r = req({ body: { planDate: '2026-10-20' } });
    const before = await changes.snapshot('planning.saveDay', r);
    planning = [
      { _id: 'p3', empId: SARA, shiftId: SHIFT, taskId: 2, planDate: new Date('2026-10-20') },
      { _id: 'p4', empId: KARIM, shiftId: SHIFT2, taskId: 1, planDate: new Date('2026-10-20') },
    ];

    const summary = await changes.describe('planning.saveDay', r, [], before);
    expect(summary?.target).toBe('2026-10-20');
    expect(summary?.changes).toEqual([
      {
        label: 'Changed',
        before: 'Sara Benali · Shift 08:00–16:00 · Cashier',
        after: 'Sara Benali · Shift 08:00–16:00 · Kitchen',
      },
      { label: 'Added', after: 'Karim Haddad · Shift 16:00–00:00 · Cashier' },
      { label: 'Removed', before: 'Karim Haddad · Shift 08:00–16:00 · Cashier' },
    ]);
  });

  it('lists what a deleted record held', async () => {
    const r = req({ params: { id: WT } });
    const before = await changes.snapshot('worktime.delete', r);
    worktime = [];
    const summary = await changes.describe('worktime.delete', r, null, before);
    expect(summary?.changes).toEqual(
      expect.arrayContaining([
        { label: 'Clock-in time', before: '08:00', after: undefined },
        { label: 'Clock-out time', before: '17:00', after: undefined },
      ]),
    );
  });
});
