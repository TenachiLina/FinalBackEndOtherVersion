import { runForCompany } from '../src/tenancy/tenant-context';
import { WorktimeService } from '../src/worktime/worktime.service';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs, seeder, type SeededUser } from './helpers/seed';
import { setNow } from './helpers/time';

// The clock-in kiosk: a shared tablet logged in with a kiosk account. It
// lists the employees with whether each is clocked in, and clocks one in or
// out at the server's time. Each press saves a punch (like the machine's)
// and fills that day's work time record: first clock-in, last clock-out,
// late minutes, overtime and worked hours against the planned shift.
// The company is in Algeria (UTC+1): "08:05" below is 07:05 UTC.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function setup(
  companyOverrides: Parameters<typeof seed.company>[0] = {},
) {
  const company = await seed.company(companyOverrides);
  const kioskUser = await seed.user('employee', company.id);
  const ali = await seed.employee(company.id, {
    firstName: 'Ali',
    lastName: 'Ben',
  });
  const empNumber: number = ali.empNumber;

  /** Sets the clock (time in Algeria) and logs the kiosk in again. */
  const at = async (local: string, user: SeededUser = kioskUser) => {
    setNow(`${local}+01:00`);
    return loginAs(t, user);
  };
  const clock = async (local: string, action: 'in' | 'out') =>
    (await at(local)).post('/kiosk/clock').send({ empNumber, action });

  const plan = async (date: string, startTime: string, endTime: string) => {
    const shift = await seed.shift(company.id, { startTime, endTime });
    await seed.planning(company.id, {
      empId: String(ali._id),
      shiftId: String(shift._id),
      planDate: date,
    });
    return String(shift._id);
  };

  const worktime = async () => {
    const rows = await seed.find(company.id, 'Worktime', { emp_id: empNumber });
    return rows.map((r: any) => ({
      ...r,
      work_date: r.work_date.toISOString().slice(0, 10),
    }));
  };

  return { company, kioskUser, ali, empNumber, at, clock, plan, worktime };
}

describe('GET /kiosk/employees', () => {
  it('lists the employees by name, with who is clocked in and since when, and no pay', async () => {
    const { company, at, empNumber } = await setup();
    await seed.employee(company.id, { firstName: 'Zina', lastName: 'Aït' });
    await seed.employee(company.id, {
      firstName: 'Amel',
      lastName: 'Kaci',
      personalImage: 'data:image/png;base64,AAAA',
    });
    const kiosk = await at('2026-10-20T08:05:00');
    await kiosk.post('/kiosk/clock').send({ empNumber, action: 'in' });

    const res = await kiosk.get('/kiosk/employees');
    expect(res.status).toBe(200);
    expect(res.body.map((e: any) => e.firstName)).toEqual([
      'Ali',
      'Amel',
      'Zina',
    ]);
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      empNumber,
      firstName: 'Ali',
      lastName: 'Ben',
      photo: null,
      clockedIn: true,
      since: '2026-10-20T07:05:00.000Z',
    });
    expect(res.body[1]).toMatchObject({
      photo: 'data:image/png;base64,AAAA',
      clockedIn: false,
      since: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/salary/i);
  });

  it('is open to the kiosk account, managers and admins', async () => {
    const { company, at } = await setup();
    for (const role of ['employee', 'manager', 'admin'] as const) {
      const api = await at(
        '2026-10-20T08:00:00',
        await seed.user(role, company.id),
      );
      expect((await api.get('/kiosk/employees')).status).toBe(200);
    }
  });
});

describe('POST /kiosk/clock', () => {
  it('clocks in, refuses a second clock-in, clocks out and fills the work time record', async () => {
    const { empNumber, clock, plan, worktime, company } = await setup();
    const shiftId = await plan('2026-10-20', '08:00', '16:00');

    const inRes = await clock('2026-10-20T08:05:00', 'in');
    expect(inRes.status).toBe(201);
    expect(inRes.body).toEqual({
      action: 'in',
      time: '2026-10-20T07:05:00.000Z',
      employee: { empNumber, name: 'Ali Ben' },
    });
    expect(await worktime()).toEqual([
      expect.objectContaining({
        work_date: '2026-10-20',
        clock_in: '08:05',
        shift_id: shiftId,
        late_minutes: '5',
        absent: false,
      }),
    ]);

    const again = await clock('2026-10-20T08:06:00', 'in');
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('Ali Ben is already clocked in');

    const out = await clock('2026-10-20T16:30:00', 'out');
    expect(out.status).toBe(201);
    expect(await worktime()).toEqual([
      expect.objectContaining({
        work_date: '2026-10-20',
        clock_in: '08:05',
        clock_out: '16:30',
        work_hours: '08:25',
        overtime_minutes: '30',
        late_minutes: '5',
      }),
    ]);

    // Both presses are saved as punches, like the machine's
    const saved = await seed.find(company.id, 'RawAttendanceLog', {});
    expect(saved.map((p: any) => p.timestamp.toISOString())).toEqual([
      '2026-10-20T07:05:00.000Z',
      '2026-10-20T15:30:00.000Z',
    ]);
    expect(saved.every((p: any) => p.deviceUserId === String(empNumber))).toBe(
      true,
    );
  });

  it('refuses a clock-out before any clock-in', async () => {
    const { clock, worktime } = await setup();
    const res = await clock('2026-10-20T16:00:00', 'out');
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Ali Ben isn't clocked in yet");
    expect(await worktime()).toEqual([]);
  });

  it.each([
    [{}, 400, 'Choose Clock in or Clock out'],
    [{ empNumber: 1, action: 'pause' }, 400, 'Choose Clock in or Clock out'],
    [{ empNumber: 99999, action: 'in' }, 404, 'Employee not found'],
    [{ empNumber: 'abc', action: 'in' }, 404, 'Employee not found'],
  ])('refuses %j with %i', async (body, status, message) => {
    const { at } = await setup();
    const res = await (await at('2026-10-20T08:00:00'))
      .post('/kiosk/clock')
      .send(body);
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
  });

  it('accepts the employee number as text', async () => {
    const { at, empNumber } = await setup();
    const res = await (await at('2026-10-20T08:00:00'))
      .post('/kiosk/clock')
      .send({ empNumber: String(empNumber), action: 'in' });
    expect(res.status).toBe(201);
  });

  it('logs the press in the activity log as a kiosk clock-in', async () => {
    const { clock, company } = await setup();
    await clock('2026-10-20T08:00:00', 'in');
    const until = Date.now() + 3000;
    let entry: any;
    while (!entry && Date.now() < until) {
      [entry] = await seed.find(company.id, 'AuditLog', {
        action: 'kiosk.clockIn',
      });
      if (!entry) await new Promise((r) => setTimeout(r, 25));
    }
    expect(entry).toMatchObject({ success: true, userRole: 'employee' });
  });

  it('works without a planned shift: no late minutes and no overtime', async () => {
    const { clock, worktime } = await setup();
    await clock('2026-10-20T09:00:00', 'in');
    await clock('2026-10-20T13:15:00', 'out');
    const [row] = await worktime();
    expect(row).toMatchObject({
      clock_in: '09:00',
      clock_out: '13:15',
      work_hours: '04:15',
    });
    expect(row.shift_id).toBeFalsy();
    expect(row.late_minutes ?? '0').toBe('0');
    expect(row.overtime_minutes ?? '0').toBe('0');
  });

  it('picks the planned shift closest to the clock-in, then keeps it for the clock-out', async () => {
    const { clock, plan, worktime } = await setup();
    await plan('2026-10-20', '08:00', '12:00');
    const evening = await plan('2026-10-20', '17:00', '23:00');
    await clock('2026-10-20T16:50:00', 'in');
    await clock('2026-10-20T23:10:00', 'out');
    expect(await worktime()).toEqual([
      expect.objectContaining({
        shift_id: evening,
        late_minutes: '0',
        overtime_minutes: '10',
        work_hours: '06:20',
      }),
    ]);
  });

  it('only looks at this employee’s planning', async () => {
    const { company, clock, worktime } = await setup();
    const other = await seed.employee(company.id);
    const shift = await seed.shift(company.id, {
      startTime: '08:00',
      endTime: '16:00',
    });
    await seed.planning(company.id, {
      empId: String(other._id),
      shiftId: String(shift._id),
      planDate: '2026-10-20',
    });
    await clock('2026-10-20T09:00:00', 'in');
    expect((await worktime())[0].shift_id).toBeFalsy();
  });

  it('files a night shift’s clock-out under the day it started', async () => {
    const { clock, plan, worktime } = await setup();
    await plan('2026-10-20', '22:00', '06:00');
    await clock('2026-10-20T21:55:00', 'in');
    await clock('2026-10-21T06:10:00', 'out');
    expect(await worktime()).toEqual([
      expect.objectContaining({
        work_date: '2026-10-20',
        clock_in: '21:55',
        clock_out: '06:10',
        work_hours: '08:15',
        late_minutes: '0',
        overtime_minutes: '10',
      }),
    ]);
  });

  it('counts overtime after a shift ending at midnight', async () => {
    const { clock, plan, worktime } = await setup();
    await plan('2026-10-20', '16:00', '00:00');
    await clock('2026-10-20T16:00:00', 'in');
    await clock('2026-10-21T00:30:00', 'out');
    expect(await worktime()).toEqual([
      expect.objectContaining({
        work_date: '2026-10-20',
        work_hours: '08:30',
        overtime_minutes: '30',
      }),
    ]);
  });

  it('counts no overtime when leaving before a midnight shift end', async () => {
    const { clock, plan, worktime } = await setup();
    await plan('2026-10-20', '16:00', '00:00');
    await clock('2026-10-20T16:00:00', 'in');
    await clock('2026-10-20T23:00:00', 'out');
    expect((await worktime())[0].overtime_minutes).toBe('0');
  });

  // BUG-505: overtime past midnight is only counted for shifts ending at exactly 00:00
  it.failing(
    'counts overtime past midnight after an evening shift ending at 22:00',
    async () => {
      const { clock, plan, worktime } = await setup();
      await plan('2026-10-20', '14:00', '22:00');
      await clock('2026-10-20T14:00:00', 'in');
      await clock('2026-10-21T01:00:00', 'out');
      expect((await worktime())[0]).toMatchObject({
        work_date: '2026-10-20',
        work_hours: '11:00',
        overtime_minutes: '180',
      });
    },
  );

  it('keeps the first clock-in and the last clock-out of the day', async () => {
    const { clock, worktime } = await setup();
    await clock('2026-10-20T08:00:00', 'in');
    await clock('2026-10-20T12:00:00', 'out');
    await clock('2026-10-20T13:00:00', 'in');
    expect((await worktime())[0]).toMatchObject({
      clock_in: '08:00',
      clock_out: '12:00',
      work_hours: '04:00',
    });
    await clock('2026-10-20T17:00:00', 'out');
    const rows = await worktime();
    expect(rows).toHaveLength(1);
    // The lunch break is counted as worked: first in to last out
    expect(rows[0]).toMatchObject({
      clock_in: '08:00',
      clock_out: '17:00',
      work_hours: '09:00',
    });
  });

  it('keeps a clock-in already entered by a manager', async () => {
    const { company, empNumber, clock, worktime } = await setup();
    await seed.worktime(company.id, {
      emp_id: empNumber,
      work_date: new Date('2026-10-20'),
      clock_in: '07:50',
    });
    await clock('2026-10-20T08:10:00', 'in');
    const rows = await worktime();
    expect(rows).toHaveLength(1);
    expect(rows[0].clock_in).toBe('07:50');
  });

  it('builds the record from the clock-in punch when the clock-in’s record is missing', async () => {
    const { company, empNumber, clock, worktime } = await setup();
    await runForCompany(company.id, async () => {
      await t.model('RawAttendanceLog').create({
        deviceUserId: String(empNumber),
        timestamp: new Date('2026-10-20T07:00:00Z'),
        deviceLogId: 'machine-1',
      });
    });
    await clock('2026-10-20T15:00:00', 'out');
    expect(await worktime()).toEqual([
      expect.objectContaining({
        work_date: '2026-10-20',
        clock_in: '08:00',
        clock_out: '15:00',
        work_hours: '07:00',
      }),
    ]);
  });

  it('lets someone who forgot to clock out clock in the next day', async () => {
    const { clock } = await setup();
    await clock('2026-10-20T08:00:00', 'in');
    expect((await clock('2026-10-21T08:30:00', 'in')).status).toBe(201);
  });

  // BUG-504: after a normal day (in 08:00, out 17:00), the 08:00 punch leaves
  // the 16-hour window before the 17:00 one, so the kiosk sees one punch: "clocked in"
  it.failing(
    'lets someone who worked 08:00–17:00 yesterday clock in at 08:00 today',
    async () => {
      const { clock } = await setup();
      await clock('2026-10-20T08:00:00', 'in');
      await clock('2026-10-20T17:00:00', 'out');
      const res = await clock('2026-10-21T08:00:00', 'in');
      expect(res.status).toBe(201);
    },
  );

  // BUG-504 (same cause): the kiosk list shows them as clocked in all night
  it.failing(
    'shows someone who clocked out at 17:00 as not clocked in after midnight',
    async () => {
      const { clock, at } = await setup();
      await clock('2026-10-20T08:00:00', 'in');
      await clock('2026-10-20T17:00:00', 'out');
      const kiosk = await at('2026-10-21T00:30:00');
      const [ali] = (await kiosk.get('/kiosk/employees')).body;
      expect(ali.clockedIn).toBe(false);
    },
  );

  it.each([
    ['+02:00', '09:05'],
    ['-03:00', '04:05'],
    ['nonsense', '08:05'], // unreadable: Algeria
  ])(
    'writes times in the company’s UTC offset %s',
    async (utcOffset, local) => {
      const { clock, worktime } = await setup({ settings: { utcOffset } });
      // 08:05 in Algeria = 07:05 UTC
      await clock('2026-10-20T08:05:00', 'in');
      expect((await worktime())[0].clock_in).toBe(local);
    },
  );

  it('keeps the punch when the work time record can’t be saved', async () => {
    const { company, clock, worktime } = await setup();
    const service = t.app.get(WorktimeService);
    jest
      .spyOn(service, 'findAll')
      .mockRejectedValueOnce(new Error('database down'))
      .mockRejectedValueOnce('not an Error');

    expect((await clock('2026-10-20T08:00:00', 'in')).status).toBe(201);
    expect((await clock('2026-10-20T16:00:00', 'out')).status).toBe(201);
    expect(await seed.find(company.id, 'RawAttendanceLog')).toHaveLength(2);
    expect(await worktime()).toEqual([]);
  });

  it('is refused when the company doesn’t have the clock-in feature', async () => {
    const { at, empNumber } = await setup({ features: ['planning'] });
    const kiosk = await at('2026-10-20T08:00:00');
    expect(
      (await kiosk.post('/kiosk/clock').send({ empNumber, action: 'in' }))
        .status,
    ).toBe(403);
    expect((await kiosk.get('/kiosk/employees')).status).toBe(403);
  });
});
