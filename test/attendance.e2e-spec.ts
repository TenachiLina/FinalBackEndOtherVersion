import { AttendanceDeviceService } from '../src/attendance-device/attendance-device.service';
import { AttendanceService } from '../src/attendance/attendance.service';
import { runForCompany } from '../src/tenancy/tenant-context';
import { createTestApp, type TestApp } from './helpers/app';
import { fakeDevice } from './helpers/fake-zklib';
import { loginAs, seeder, unknownId } from './helpers/seed';

// Punches: pulled from the face-recognition machine (POST /attendance/sync,
// the machine is test/helpers/fake-zklib.ts), added or corrected by hand,
// and listed by day for the Clock-in History page. Also /device/*, which
// talks to the machine directly.

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());
afterEach(() => {
  fakeDevice.reset();
  jest.restoreAllMocks();
});

async function setup() {
  const company = await seed.company();
  const admin = await loginAs(t, await seed.user('admin', company.id));
  return { company, admin };
}

const punches = (companyId: string) =>
  seed.find(companyId, 'RawAttendanceLog', {});

/** A punch as node-zklib returns it. */
const devicePunch = (userSn: number, deviceUserId: string, iso: string) => ({
  userSn,
  deviceUserId,
  recordTime: new Date(iso),
  ip: '192.0.2.10',
});

describe('POST /attendance/sync', () => {
  it('saves the machine’s new punches once', async () => {
    const { company, admin } = await setup();
    fakeDevice.attendances = [
      devicePunch(1, '7', '2026-10-20T07:00:00Z'),
      devicePunch(2, '8', '2026-10-20T07:05:00Z'),
    ];
    const res = await admin.post('/attendance/sync');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'success', message: 'Sync completed' });

    fakeDevice.attendances.push(devicePunch(3, '7', '2026-10-20T16:00:00Z'));
    await admin.post('/attendance/sync');

    const saved = await punches(company.id);
    expect(saved).toHaveLength(3);
    expect(saved.find((p: any) => p.deviceLogId === '3')).toMatchObject({
      deviceUserId: '7',
      processed: false,
    });
    expect(fakeDevice.created[0]).toEqual(['192.0.2.10', 4370, 10000, 4000]);
  });

  it('skips a punch whose time can’t be read', async () => {
    const { company, admin } = await setup();
    fakeDevice.attendances = [
      { userSn: 1, deviceUserId: '7', recordTime: 'not a date' },
      devicePunch(2, '7', '2026-10-20T07:00:00Z'),
    ];
    expect((await admin.post('/attendance/sync')).body.status).toBe('success');
    expect((await punches(company.id)).map((p: any) => p.deviceLogId)).toEqual([
      '2',
    ]);
  });

  it('answers status "error" with the reason when the machine can’t be reached', async () => {
    const { company, admin } = await setup();
    fakeDevice.reachable = false;
    const res = await admin.post('/attendance/sync');
    expect(res.body).toEqual({
      status: 'error',
      message: 'connect ETIMEDOUT 192.0.2.10:4370',
    });
    expect(await punches(company.id)).toEqual([]);
  });

  it('answers status "error" when something other than an Error is thrown', async () => {
    const { admin } = await setup();
    jest
      .spyOn(t.app.get(AttendanceService), 'syncLogs')
      .mockRejectedValueOnce('boom');
    expect((await admin.post('/attendance/sync')).body).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  // BUG-502: punches are known by the machine's record number (userSn), which
  // starts again at 1 when the machine's log is cleared: every new punch with a
  // number already seen is dropped without a word
  it.failing(
    'still saves new punches after the machine’s log was cleared',
    async () => {
      const { company, admin } = await setup();
      fakeDevice.attendances = [
        devicePunch(1, '7', '2026-10-20T07:00:00Z'),
        devicePunch(2, '7', '2026-10-20T16:00:00Z'),
      ];
      await admin.post('/attendance/sync');

      // The machine's memory is cleared; numbering starts again
      fakeDevice.attendances = [
        devicePunch(1, '8', '2026-11-02T07:00:00Z'),
        devicePunch(2, '8', '2026-11-02T16:00:00Z'),
      ];
      await admin.post('/attendance/sync');

      expect(await punches(company.id)).toHaveLength(4);
    },
  );

  // BUG-502 (same cause): a punch without a record number is saved as "undefined",
  // so every later one without a number is dropped
  it.failing(
    'saves punches the machine sent without a record number',
    async () => {
      const { company, admin } = await setup();
      fakeDevice.attendances = [
        { deviceUserId: '7', recordTime: new Date('2026-10-20T07:00:00Z') },
        { deviceUserId: '8', recordTime: new Date('2026-10-20T07:05:00Z') },
      ];
      await admin.post('/attendance/sync');
      expect(await punches(company.id)).toHaveLength(2);
    },
  );
});

describe('one clocking machine for every company (DEVICE_IP)', () => {
  // BUG-501: every company reads the same machine (DEVICE_IP): company B's sync
  // copies company A's employees' punches into company B
  it.failing(
    'a company’s sync never brings in punches from another company’s machine',
    async () => {
      const a = await setup();
      const b = await setup();
      fakeDevice.attendances = [devicePunch(1, '7', '2026-10-20T07:00:00Z')];
      await a.admin.post('/attendance/sync');
      await b.admin.post('/attendance/sync');

      expect(await punches(a.company.id)).toHaveLength(1);
      expect(await punches(b.company.id)).toEqual([]);
    },
  );

  // BUG-501 (same cause): any company reads the machine's user list and punches
  it.failing(
    'a company can’t read the user list and punches of another company’s machine',
    async () => {
      await setup(); // company A, owner of the machine at DEVICE_IP
      const b = await setup();
      fakeDevice.users = [{ uid: 1, userId: '7', name: 'Employee of A' }];
      fakeDevice.attendances = [devicePunch(1, '7', '2026-10-20T07:00:00Z')];

      const users = await b.admin.get('/device/users');
      const logs = await b.admin.get('/device/logs');
      expect(users.body.data ?? []).toEqual([]);
      expect(logs.body.data ?? []).toEqual([]);
    },
  );
});

describe('/device/*', () => {
  it('pings, reads the status, the users and the punches of the machine', async () => {
    const { admin } = await setup();
    fakeDevice.users = [{ uid: 1, userId: '7', name: 'Ali' }];
    fakeDevice.attendances = [devicePunch(1, '7', '2026-10-20T07:00:00Z')];

    expect((await admin.get('/device/ping')).body).toEqual({
      status: 'success',
      message: 'Device connected successfully',
    });
    expect((await admin.get('/device/status')).body).toEqual({
      connected: true,
      name: 'Face Recognition Machine',
      ip: '192.0.2.10',
    });
    expect((await admin.get('/device/users')).body).toEqual({
      status: 'success',
      count: 1,
      data: [{ uid: 1, userId: '7', name: 'Ali' }],
    });
    const logs = await admin.get('/device/logs');
    expect(logs.body).toMatchObject({
      status: 'success',
      count: 1,
      data: [{ userSn: 1, deviceUserId: '7' }],
    });
  });

  it('answers "not connected" / status "error" when the machine can’t be reached', async () => {
    const { admin } = await setup();
    fakeDevice.reachable = false;
    const error = {
      status: 'error',
      message: 'connect ETIMEDOUT 192.0.2.10:4370',
    };
    expect((await admin.get('/device/ping')).body).toEqual(error);
    expect((await admin.get('/device/users')).body).toEqual(error);
    expect((await admin.get('/device/logs')).body).toEqual(error);
    expect((await admin.get('/device/status')).body).toMatchObject({
      connected: false,
    });

    // and connected again once it answers
    fakeDevice.reachable = true;
    expect((await admin.get('/device/status')).body.connected).toBe(true);
  });

  it('answers status "error" when something other than an Error is thrown', async () => {
    const { admin } = await setup();
    const device = t.app.get(AttendanceDeviceService);
    jest.spyOn(device, 'connect').mockRejectedValue('boom');
    jest.spyOn(device, 'getDeviceUsers').mockRejectedValue('boom');
    jest.spyOn(device, 'getAttendanceLogs').mockRejectedValue('boom');
    const error = { status: 'error', message: 'boom' };
    expect((await admin.get('/device/ping')).body).toEqual(error);
    expect((await admin.get('/device/users')).body).toEqual(error);
    expect((await admin.get('/device/logs')).body).toEqual(error);
  });
});

describe('punches added and corrected by hand', () => {
  it('adds a punch, corrects its time and deletes it', async () => {
    const { company, admin } = await setup();
    const created = await admin.post('/attendance/device-logs').send({
      deviceUserId: ' 7\u0000\n',
      timestamp: '2026-10-20T08:00:00+01:00',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'success',
      message: 'Punch created successfully',
      data: {
        deviceUserId: '7',
        timestamp: '2026-10-20T07:00:00.000Z',
        processed: false,
      },
    });
    expect(created.body.data.deviceLogId).toMatch(/^manual-\d+-[a-z0-9]+$/);
    const id = created.body.data._id;

    const edited = await admin
      .patch(`/attendance/device-logs/${id}`)
      .send({ timestamp: '2026-10-20T08:15:00+01:00' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      status: 'success',
      data: { timestamp: '2026-10-20T07:15:00.000Z' },
    });

    const deleted = await admin.delete(`/attendance/device-logs/${id}`);
    expect(deleted.body).toEqual({
      status: 'success',
      message: 'Attendance log deleted successfully',
      id,
    });
    expect(await punches(company.id)).toEqual([]);
  });

  it('keeps "processed" when it is sent', async () => {
    const { admin } = await setup();
    const res = await admin.post('/attendance/device-logs').send({
      deviceUserId: '7',
      timestamp: '2026-10-20T08:00:00Z',
      processed: true,
    });
    expect(res.body.data.processed).toBe(true);
  });

  it.each([
    [{ timestamp: '2026-10-20T08:00:00Z' }, 'deviceUserId is required'],
    [
      { deviceUserId: '\u0000 ', timestamp: '2026-10-20T08:00:00Z' },
      'deviceUserId is required',
    ],
    [{ deviceUserId: '7' }, 'Invalid timestamp'],
    [{ deviceUserId: '7', timestamp: 'yesterday' }, 'Invalid timestamp'],
  ])('refuses %j: %s', async (body, message) => {
    const { company, admin } = await setup();
    const res = await admin.post('/attendance/device-logs').send(body);
    expect(res.body).toEqual({ status: 'error', message });
    expect(await punches(company.id)).toEqual([]);
  });

  it.each([
    [
      'patch',
      'not-an-id',
      { timestamp: '2026-10-20T08:00:00Z' },
      400,
      'Invalid attendance log ID',
    ],
    ['patch', 'ID', { timestamp: 'later' }, 400, 'Invalid timestamp'],
    ['patch', 'ID', {}, 400, 'Invalid timestamp'],
    [
      'patch',
      'UNKNOWN',
      { timestamp: '2026-10-20T08:00:00Z' },
      404,
      'Attendance log not found',
    ],
    ['delete', 'not-an-id', {}, 400, 'Invalid attendance log ID'],
    ['delete', 'UNKNOWN', {}, 404, 'Attendance log not found'],
  ])('%s with id %s %j → %i', async (method, which, body, status, message) => {
    const { admin } = await setup();
    const created = await admin
      .post('/attendance/device-logs')
      .send({ deviceUserId: '7', timestamp: '2026-10-20T08:00:00Z' });
    const id =
      which === 'ID'
        ? created.body.data._id
        : which === 'UNKNOWN'
          ? unknownId()
          : which;
    const res = await (admin as any)
      [method](`/attendance/device-logs/${id}`)
      .send(body);
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
  });

  it('can’t correct or delete another company’s punch', async () => {
    const a = await setup();
    const b = await setup();
    const created = await a.admin
      .post('/attendance/device-logs')
      .send({ deviceUserId: '7', timestamp: '2026-10-20T08:00:00Z' });
    const id = created.body.data._id;
    expect(
      (
        await b.admin
          .patch(`/attendance/device-logs/${id}`)
          .send({ timestamp: '2026-10-20T09:00:00Z' })
      ).status,
    ).toBe(404);
    expect((await b.admin.delete(`/attendance/device-logs/${id}`)).status).toBe(
      404,
    );
    const [kept] = await punches(a.company.id);
    expect(kept.timestamp.toISOString()).toBe('2026-10-20T08:00:00.000Z');
  });
});

describe('GET /attendance/device-logs', () => {
  async function withPunches() {
    const ctx = await setup();
    await seed.employee(ctx.company.id, {
      empNumber: 7,
      firstName: 'Ali',
      lastName: 'Ben',
    });
    for (const [who, when] of [
      ['7', '2026-10-19T12:00:00Z'],
      ['7', '2026-10-20T07:00:00Z'],
      ['\u00008 ', '2026-10-20T16:00:00Z'],
      ['7', '2026-10-21T07:00:00Z'],
    ]) {
      await ctx.admin
        .post('/attendance/device-logs')
        .send({ deviceUserId: who, timestamp: when });
    }
    // A punch with control characters saved by an older version
    await runForCompany(ctx.company.id, async () => {
      await t.model('RawAttendanceLog').create({
        deviceUserId: '7\r\n',
        timestamp: new Date('2026-10-20T10:00:00Z'),
        deviceLogId: 'old-1',
      });
    });
    return ctx;
  }

  it('lists every punch, oldest first, with the employee’s name when known', async () => {
    const { admin } = await withPunches();
    const res = await admin.get('/attendance/device-logs');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.count).toBe(5);
    expect(res.body.data.map((p: any) => p.timestamp)).toEqual([
      '2026-10-19T12:00:00.000Z',
      '2026-10-20T07:00:00.000Z',
      '2026-10-20T10:00:00.000Z',
      '2026-10-20T16:00:00.000Z',
      '2026-10-21T07:00:00.000Z',
    ]);
    expect(res.body.data[2]).toMatchObject({
      deviceUserId: '7',
      employeeNumber: '7',
      firstName: 'Ali',
      lastName: 'Ben',
      employeeFound: true,
    });
    expect(res.body.data[3]).toMatchObject({
      deviceUserId: '8',
      employeeFound: false,
    });
    expect(res.body.data[3].firstName).toBeUndefined();
  });

  it('filters by day, from, to, or both', async () => {
    const { admin } = await withPunches();
    const count = async (q: string) =>
      (await admin.get(`/attendance/device-logs?${q}`)).body.count;
    expect(await count('from=2026-10-20&to=2026-10-20')).toBe(3);
    expect(await count('from=2026-10-20')).toBe(4);
    expect(await count('to=2026-10-20')).toBe(4);
    expect(await count('from=2026-10-22')).toBe(0);
  });

  it('answers status "error" for a date it can’t read', async () => {
    const { admin } = await withPunches();
    const res = await admin.get('/attendance/device-logs?from=someday');
    expect(res.body.status).toBe('error');
  });

  it('answers status "error" when something other than an Error is thrown', async () => {
    const { admin } = await setup();
    jest
      .spyOn(t.app.get(AttendanceService), 'getLogsByDateRange')
      .mockRejectedValueOnce('boom');
    expect((await admin.get('/attendance/device-logs')).body).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  // BUG-503: days are cut at UTC midnight, but the company is in UTC+1, so a
  // punch at 00:30 in Algeria is listed on the day before
  it.failing('lists a punch at 00:30 in Algeria under that day', async () => {
    const { admin } = await setup();
    await admin.post('/attendance/device-logs').send({
      deviceUserId: '7',
      timestamp: '2026-10-20T00:30:00+01:00', // 19 Oct 23:30 UTC
    });
    const res = await admin.get(
      '/attendance/device-logs?from=2026-10-20&to=2026-10-20',
    );
    expect(res.body.count).toBe(1);
  });

  it('is never shown to another company', async () => {
    await withPunches();
    const other = await setup();
    expect((await other.admin.get('/attendance/device-logs')).body.count).toBe(
      0,
    );
  });
});

describe('AttendanceService.getDeviceLogs (not used by any route)', () => {
  it('lists one UTC day, or everything', async () => {
    const { company, admin } = await setup();
    for (const when of ['2026-10-20T07:00:00Z', '2026-10-21T07:00:00Z']) {
      await admin
        .post('/attendance/device-logs')
        .send({ deviceUserId: '7', timestamp: when });
    }
    const service = t.app.get(AttendanceService);
    const day = await runForCompany(
      company.id,
      async () => await service.getDeviceLogs('2026-10-20'),
    );
    expect(day.map((p: any) => p.timestamp.toISOString())).toEqual([
      '2026-10-20T07:00:00.000Z',
    ]);
    const all = await runForCompany(
      company.id,
      async () => await service.getDeviceLogs(),
    );
    expect(all).toHaveLength(2);
  });
});
