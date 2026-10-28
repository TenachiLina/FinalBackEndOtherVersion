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
    findById: (id: string) =>
      query(() => rows().find((r) => String(r._id) === id) ?? null),
    findOne: (f: any) => query(() => rows().find((r) => matches(r, f)) ?? null),
    find: (f: any) => query(() => rows().filter((r) => matches(r, f))),
  };
}

describe('AuditChanges', () => {
  let worktime: any[];
  let planning: any[];
  let changes: AuditChanges;
  const req = (extra: any) => ({
    company: { settings: { utcOffset: '+01:00' } },
    ...extra,
  });

  beforeEach(() => {
    worktime = [
      {
        _id: WT,
        emp_id: 12,
        work_date: new Date('2026-10-20T00:00:00Z'),
        clock_in: '08:00',
        clock_out: '17:00',
        absent: false,
      },
    ];
    planning = [
      {
        _id: 'p1',
        empId: SARA,
        shiftId: SHIFT,
        taskId: 1,
        planDate: new Date('2026-10-20'),
      },
      {
        _id: 'p2',
        empId: KARIM,
        shiftId: SHIFT,
        taskId: 1,
        planDate: new Date('2026-10-20'),
      },
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
    worktime[0] = {
      ...worktime[0],
      clock_out: '18:30',
      absent: true,
      absent_comment: 'Sick',
    };

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
      worktime[0] = {
        ...worktime[0],
        clock_out: '00:00',
        overtime_minutes: '0',
      };
    });

    it('logs a first clock-out as "clocked out", not as an edit', async () => {
      const r = req({ params: { id: WT }, headers: {} });
      const before = await changes.snapshot('worktime.update', r);
      worktime[0] = {
        ...worktime[0],
        clock_out: '13:02',
        overtime_minutes: '662',
      };

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
      expect(summary?.changes).toContainEqual({
        label: 'Clock-out time',
        before: '13:02',
        after: '15:02',
      });
    });

    it('follows what the page says: an edit button that fills an empty time is an edit', async () => {
      const r = req({ params: { id: WT }, headers: { 'x-audit-as': 'edit' } });
      const before = await changes.snapshot('worktime.update', r);
      worktime[0] = { ...worktime[0], clock_out: '13:02' };

      const summary = await changes.describe('worktime.update', r, {}, before);
      expect(summary?.action).toBeUndefined();
      expect(summary?.changes).toContainEqual({
        label: 'Clock-out time',
        before: '—',
        after: '13:02',
      });
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
      {
        _id: 'p3',
        empId: SARA,
        shiftId: SHIFT,
        taskId: 2,
        planDate: new Date('2026-10-20'),
      },
      {
        _id: 'p4',
        empId: KARIM,
        shiftId: SHIFT2,
        taskId: 1,
        planDate: new Date('2026-10-20'),
      },
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
      {
        label: 'Removed',
        before: 'Karim Haddad · Shift 08:00–16:00 · Cashier',
      },
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

describe('AuditChanges: other records', () => {
  const COMPANY = '64b7f0c2a1b2c3d4e5f6c001';
  const USER = '64b7f0c2a1b2c3d4e5f6d001';
  const PUNCH = '64b7f0c2a1b2c3d4e5f6e001';
  const ADV = '64b7f0c2a1b2c3d4e5f6f001';
  const TASK = '64b7f0c2a1b2c3d4e5f6a0f1';
  let rows: Record<string, any[]>;
  let changes: AuditChanges;
  const req = (extra: any = {}) => ({
    company: { settings: { utcOffset: '+01:00' } },
    ...extra,
  });

  beforeEach(() => {
    rows = {
      Employee: [
        {
          _id: SARA,
          empNumber: 12,
          firstName: 'Sara',
          lastName: 'Benali',
          baseSalary: 30000,
          personalImage: 'a.png',
        },
      ],
      Shift: [
        { _id: SHIFT, startTime: '08:00', endTime: '16:00', isArchived: false },
      ],
      Task: [{ _id: TASK, taskId: 1, taskName: 'Cashier' }],
      User: [
        {
          _id: USER,
          name: 'Mia',
          email: 'mia@test.dz',
          role: 'manager',
          active: true,
        },
      ],
      Company: [
        {
          _id: COMPANY,
          name: 'Pizza',
          features: ['planning', 'clockin'],
          settings: { currency: 'DA' },
          branding: {},
          devices: [],
        },
      ],
      RawAttendanceLog: [
        {
          _id: PUNCH,
          deviceUserId: '12',
          timestamp: new Date('2026-10-20T23:30:00Z'),
        },
      ],
      Advance: [
        {
          _id: ADV,
          emp_id: 99,
          amount: 2000,
          date: new Date('2026-10-20T00:00:00Z'),
          reason: '',
        },
      ],
      Planning: [],
      Worktime: [],
    };
    const models = Object.fromEntries(
      Object.keys(rows).map((name) => [name, fakeModel(() => rows[name])]),
    );
    changes = new AuditChanges({ models } as any);
  });

  async function update(
    action: string,
    model: string,
    id: string,
    patch: object,
    r = req({ params: { id } }),
  ) {
    const before = await changes.snapshot(action, r);
    rows[model] = rows[model].map((row) =>
      row._id === id ? { ...row, ...patch } : row,
    );
    return changes.describe(action, r, {}, before);
  }

  it('lists what a new employee was given, from the id that came back', async () => {
    rows.Employee.push({
      _id: KARIM,
      empNumber: 13,
      firstName: 'Karim',
      lastName: 'Haddad',
      baseSalary: 0,
      personalImage: 'k.png',
    });
    const r = req({ body: {} });
    const before = await changes.snapshot('employee.create', r);
    expect(before).toBeUndefined();
    const summary = await changes.describe(
      'employee.create',
      r,
      { data: { _id: KARIM } },
      before,
    );
    expect(summary).toEqual({
      target: 'Karim Haddad (#13)',
      changes: [
        { label: 'First name', after: 'Karim' },
        { label: 'Last name', after: 'Haddad' },
        { label: 'Employee number', after: '13' },
        { label: 'Photo', after: 'Photo set' },
      ],
    });
  });

  it('says "Changed" when a value differs but looks the same (a new photo)', async () => {
    const summary = await update('employee.update', 'Employee', SARA, {
      personalImage: 'b.png',
      baseSalary: 32000,
    });
    expect(summary?.changes).toEqual([
      { label: 'Base salary', before: '30000', after: '32000' },
      { label: 'Photo', after: 'Changed' },
    ]);
  });

  it('describes shifts, tasks and users', async () => {
    expect(
      await update('shift.archive', 'Shift', SHIFT, { isArchived: true }),
    ).toEqual({
      target: 'Shift 08:00–16:00',
      changes: [{ label: 'Archived', before: 'No', after: 'Yes' }],
    });
    expect(
      (await update('task.update', 'Task', TASK, { taskName: 'Till' }))?.target,
    ).toBe('Till (#1)');
    expect(
      await update('user.update', 'User', USER, {
        role: 'admin',
        active: false,
      }),
    ).toEqual({
      target: 'Mia (mia@test.dz)',
      changes: [
        { label: 'Role', before: 'manager', after: 'admin' },
        { label: 'Active', before: 'Yes', after: 'No' },
      ],
    });
  });

  it("shows a company's settings, branding, machines and features", async () => {
    const summary = await update('company.update', 'Company', COMPANY, {
      features: ['planning'],
      settings: { currency: 'EUR' },
      branding: { logo: 'data:image/png;base64,AA', color: '#ff0000' },
      devices: [{ serial: 'ABC123', name: 'Front door' }, { serial: 'XYZ' }],
    });
    expect(summary?.changes).toEqual([
      { label: 'Features', before: 'planning, clockin', after: 'planning' },
      { label: 'Currency', before: 'DA', after: 'EUR' },
      { label: 'Sign-in page colour', before: '—', after: '#ff0000' },
      { label: 'Logo', before: '—', after: 'Logo set' },
      {
        label: 'Clocking machines',
        before: '—',
        after: 'Front door ABC123, XYZ',
      },
    ]);
  });

  it("takes a company admin's own company from their login", async () => {
    const r = req({ user: { companyId: COMPANY } });
    const summary = await update(
      'companySettings.update',
      'Company',
      COMPANY,
      { name: 'Pizza Plus' },
      r,
    );
    expect(summary).toEqual({
      target: 'Pizza Plus',
      changes: [
        { label: 'Company name', before: 'Pizza', after: 'Pizza Plus' },
      ],
    });
  });

  it("shows punch times in the company's time zone", async () => {
    const summary = await update('punch.update', 'RawAttendanceLog', PUNCH, {
      timestamp: new Date('2026-10-21T06:05:00Z'),
    });
    expect(summary).toEqual({
      target: 'Sara Benali (#12)',
      changes: [
        {
          label: 'Punch time',
          before: '2026-10-21 00:30',
          after: '2026-10-21 07:05',
        },
      ],
    });
  });

  it('reads other offsets, and falls back to UTC+1 without one', async () => {
    const west = req({
      params: { id: PUNCH },
      company: { settings: { utcOffset: '-0330' } },
    });
    const summary = await update(
      'punch.update',
      'RawAttendanceLog',
      PUNCH,
      { timestamp: new Date('2026-10-21T06:05:00Z') },
      west,
    );
    expect(summary?.changes[0]).toMatchObject({
      before: '2026-10-20 20:00',
      after: '2026-10-21 02:35',
    });

    const none = req({ params: { id: PUNCH }, company: undefined });
    const before = await changes.snapshot('punch.update', none);
    rows.RawAttendanceLog = [
      {
        ...rows.RawAttendanceLog[0],
        timestamp: new Date('2026-10-21T22:59:00Z'),
      },
    ];
    expect(
      (await changes.describe('punch.update', none, {}, before))?.changes[0],
    ).toMatchObject({
      after: '2026-10-21 23:59',
    });
  });

  it('names an employee it cannot find by number, and lists a deleted advance', async () => {
    const r = req({ params: { id: ADV } });
    const before = await changes.snapshot('advance.delete', r);
    rows.Advance = [];
    expect(await changes.describe('advance.delete', r, null, before)).toEqual({
      target: 'Employee #99',
      changes: [
        { label: 'Employee', before: 'Employee #99', after: undefined },
        { label: 'Amount', before: '2000', after: undefined },
        { label: 'Date', before: '2026-10-20', after: undefined },
      ],
    });
  });

  it('has nothing to say about unknown actions, bad ids or vanished records', async () => {
    expect(await changes.snapshot('other', req())).toBeUndefined();
    expect(
      await changes.snapshot(
        'employee.update',
        req({ params: { id: 'not-an-id' } }),
      ),
    ).toBeUndefined();
    expect(
      await changes.snapshot(
        'planning.saveDay',
        req({ body: { planDate: 'soon' } }),
      ),
    ).toBeUndefined();
    expect(
      await changes.describe('other', req(), {}, undefined),
    ).toBeUndefined();
    expect(
      await changes.describe(
        'planning.saveDay',
        req({ body: {} }),
        [],
        undefined,
      ),
    ).toBeUndefined();
    expect(
      await changes.describe(
        'employee.update',
        req({ params: { id: KARIM } }),
        {},
        undefined,
      ),
    ).toBeUndefined();
  });

  it('names the record of a failed action from the snapshot', async () => {
    const r = req({ params: { id: SARA } });
    const before = await changes.snapshot('employee.delete', r);
    expect(await changes.targetOf('employee.delete', r, before)).toBe(
      'Sara Benali (#12)',
    );
    expect(
      await changes.targetOf('employee.delete', r, undefined),
    ).toBeUndefined();
    expect(
      await changes.targetOf(
        'planning.saveDay',
        req({ body: { planDate: '2026-10-20' } }),
        undefined,
      ),
    ).toBe('2026-10-20');
  });

  // BUG-003: a clock-out at exactly midnight is logged as "Clock-out time: Changed"
  it.failing(
    'logs a clock-out at exactly 00:00 (end of a night shift) as a clock-out',
    async () => {
      rows.Worktime = [
        {
          _id: WT,
          emp_id: 12,
          work_date: new Date('2026-10-20T00:00:00Z'),
          clock_in: '16:00',
          clock_out: '',
        },
      ];
      const summary = await update(
        'worktime.update',
        'Worktime',
        WT,
        { clock_out: '00:00' },
        req({ params: { id: WT }, headers: { 'x-audit-as': 'clock' } }),
      );
      expect(summary).toMatchObject({
        action: 'worktime.clockOut',
        changes: [{ label: 'Clock-out time', after: '00:00' }],
      });
    },
  );

  describe('a planning day', () => {
    const day = new Date('2026-10-20');
    const entry = (empId: string, extra: object = {}) => ({
      empId,
      shiftId: SHIFT,
      taskId: 1,
      planDate: day,
      ...extra,
    });
    const saveDay = async () => {
      const r = req({ body: { planDate: '2026-10-20' } });
      return { r, before: await changes.snapshot('planning.saveDay', r) };
    };

    it('describes backups, custom times and sub-tasks', async () => {
      const { r, before } = await saveDay();
      rows.Planning = [
        entry(SARA, {
          backupEmpIds: [KARIM, 'gone'],
          customStartTime: '09:00',
          tasks: [
            { label: 'Oven', startTime: '09:00', endTime: '10:00' },
            { label: 'Till' },
          ],
        }),
      ];
      const summary = await changes.describe('planning.saveDay', r, [], before);
      expect(summary?.changes).toEqual([
        {
          label: 'Added',
          after:
            'Sara Benali · Shift 08:00–16:00 · Cashier · backups: Employee f6a002, gone · 09:00–? · sub-tasks: Oven 09:00–10:00, Till',
        },
      ]);
    });

    it('says so when nothing changed', async () => {
      const { r, before } = await saveDay();
      expect(
        (await changes.describe('planning.saveDay', r, [], before))?.changes,
      ).toEqual([{ label: 'Saved without changes' }]);
    });

    it('lists at most 40 changes', async () => {
      const { r, before } = await saveDay();
      rows.Planning = Array.from({ length: 45 }, () => entry(SARA));
      const list = (await changes.describe('planning.saveDay', r, [], before))!
        .changes;
      expect(list).toHaveLength(41);
      expect(list[40]).toEqual({ label: 'And more', after: '5' });
    });
  });
});
