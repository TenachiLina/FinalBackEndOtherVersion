import request from 'supertest';
import { ZktecoService } from '../src/zkteco/zkteco.service';
import { createTestApp, type TestApp } from './helpers/app';
import { seeder } from './helpers/seed';

// The ZKTeco machine pushing punches over the ADMS protocol (/iclock/*).
// It can't log in: it is recognised by the serial it sends as ?SN=, which
// must be registered on one company. It talks plain HTTP and sends
// tab-separated text, so these requests are sent the same way (no HTTPS
// header, text/plain bodies).

let t: TestApp;
let seed: ReturnType<typeof seeder>;

beforeAll(async () => {
  t = await createTestApp();
  seed = seeder(t);
});
afterAll(() => t.close());
afterEach(() => jest.restoreAllMocks());

let serials = 0;
async function setup(overrides: Parameters<typeof seed.company>[0] = {}) {
  const serial = `ZK${Date.now()}${serials++}`;
  const company = await seed.company({ devices: [{ serial }], ...overrides });
  return { company, serial };
}

/** A request as the machine sends it: plain HTTP, no browser headers. */
const machine = () => request(t.app.getHttpServer());

const upload = (serial: string, body: string, table = 'ATTLOG') =>
  machine()
    .post(`/iclock/cdata?SN=${serial}&table=${table}&Stamp=9999`)
    .set('Content-Type', 'text/plain')
    .send(body);

/** One ATTLOG line: PIN, local time, status, verify mode, work code. */
const row = (pin: string, time: string, status = 0, verify = 15) =>
  [pin, time, status, verify, 0].join('\t');

const events = (companyId: string) =>
  seed.find(companyId, 'ZktecoAttendanceEvent', {});

describe('who may talk to /iclock', () => {
  it('answers a registered machine over plain HTTP with its options', async () => {
    const { serial } = await setup();
    const res = await machine().get(`/iclock/cdata?SN=${serial}&options=all`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain');
    expect(res.text.split('\r\n')).toEqual(
      expect.arrayContaining([
        `GET OPTION FROM: ${serial}`,
        'Realtime=1',
        'TransFlag=TransData AttLog OpLog EnrollUser',
      ]),
    );
  });

  it.each([
    ['/iclock/cdata.aspx'],
    ['/iclock/getrequest'],
    ['/iclock/getrequest.aspx'],
    ['/iclock/ping'],
    ['/iclock/ping.aspx'],
  ])('GET %s answers a registered machine', async (path) => {
    const { serial } = await setup();
    const res = await machine().get(`${path}?SN=${serial}`);
    expect(res.status).toBe(200);
  });

  it('accepts the serial with spaces around it', async () => {
    const { serial } = await setup();
    const res = await machine().get(`/iclock/ping?SN=%20${serial}%20`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['no serial', ''],
    ['an empty serial', '?SN='],
    ['a blank serial', '?SN=%20%20'],
    ['an unknown serial', '?SN=NOT-REGISTERED'],
  ])('refuses %s with 403 "ERROR"', async (_, query) => {
    await setup();
    for (const path of ['cdata', 'getrequest', 'ping']) {
      const res = await machine().get(`/iclock/${path}${query}`);
      expect(res.status).toBe(403);
      expect(res.text).toBe('ERROR');
    }
    const post = await machine()
      .post(`/iclock/cdata${query}${query ? '&' : '?'}table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(row('1', '2026-10-20 08:00:00'));
    expect(post.status).toBe(403);
  });

  it('refuses the machine of a suspended company', async () => {
    const { serial, company } = await setup({ active: false });
    expect((await machine().get(`/iclock/ping?SN=${serial}`)).status).toBe(403);
    expect((await upload(serial, row('1', '2026-10-20 08:00:00'))).status).toBe(
      403,
    );
    expect(await events(company.id)).toEqual([]);
  });

  it('refuses the machine of a company without the clock-in feature', async () => {
    const { serial, company } = await setup({ features: ['planning'] });
    expect((await machine().get(`/iclock/cdata?SN=${serial}`)).status).toBe(
      403,
    );
    expect((await upload(serial, row('1', '2026-10-20 08:00:00'))).status).toBe(
      403,
    );
    expect(await events(company.id)).toEqual([]);
  });

  it('is never logged in the activity log', async () => {
    const { serial, company } = await setup();
    await upload(serial, row('1', '2026-10-20 08:00:00'));
    await new Promise((r) => setTimeout(r, 100));
    expect(
      await seed.find(company.id, 'AuditLog', { companyId: company._id }),
    ).toEqual([]);
  });
});

describe('punches sent by the machine (ATTLOG)', () => {
  it('saves each line in the machine’s company, times read in Algeria (UTC+1)', async () => {
    const { serial, company } = await setup();
    const res = await upload(
      serial,
      [
        row('0007', '2026-10-20 08:01:30', 0, 15),
        row('12', '2026-10-20 23:59:59', 1, 1),
        '',
      ].join('\r\n'),
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    const saved = (await events(company.id)).sort((a: any, b: any) =>
      a.eventTime < b.eventTime ? -1 : 1,
    );
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      deviceSerial: serial,
      employeePin: '0007',
      deviceTimestamp: '2026-10-20 08:01:30',
      status: 0,
      verifyMode: 15,
      workCode: '0',
      processingStatus: 'pending',
    });
    expect(saved[0].eventTime.toISOString()).toBe('2026-10-20T07:01:30.000Z');
    // 23:59:59 in Algeria is still the 20th; in UTC it is 22:59:59
    expect(saved[1].eventTime.toISOString()).toBe('2026-10-20T22:59:59.000Z');
    expect(String(saved[0].companyId)).toBe(company.id);
  });

  it('uses the company’s own UTC offset', async () => {
    const { serial, company } = await setup({
      settings: { utcOffset: '-03:30' },
    });
    await upload(serial, row('5', '2026-10-20 22:00:00'));
    const [saved] = await events(company.id);
    expect(saved.eventTime.toISOString()).toBe('2026-10-21T01:30:00.000Z');
  });

  it('accepts a line without a work code and an octet-stream body', async () => {
    const { serial, company } = await setup();
    const res = await machine()
      .post(`/iclock/cdata.aspx?SN=${serial}&table=ATTLOG`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('3\t2026-10-20 09:00:00\t0\t1\n'));
    expect(res.status).toBe(200);
    const [saved] = await events(company.id);
    expect(saved.employeePin).toBe('3');
    expect(saved.workCode).toBeUndefined();
  });

  it('saves a line sent twice only once (the machine retries)', async () => {
    const { serial, company } = await setup();
    const body = [
      row('1', '2026-10-20 08:00:00'),
      row('2', '2026-10-20 08:05:00'),
    ].join('\n');
    expect((await upload(serial, body)).text).toBe('OK');
    expect((await upload(serial, body)).text).toBe('OK');
    expect(
      (await upload(serial, `${body}\n${row('3', '2026-10-20 08:10:00')}`))
        .text,
    ).toBe('OK');
    expect(await events(company.id)).toHaveLength(3);
  });

  it('keeps two machines’ identical lines apart', async () => {
    const a = await setup();
    const b = await setup();
    const line = row('1', '2026-10-20 08:00:00');
    await upload(a.serial, line);
    await upload(b.serial, line);
    expect(await events(a.company.id)).toHaveLength(1);
    expect(await events(b.company.id)).toHaveLength(1);
  });

  it('saves nothing for an empty upload and answers OK', async () => {
    const { serial, company } = await setup();
    expect((await upload(serial, '\r\n\r\n')).text).toBe('OK');
    expect(await events(company.id)).toEqual([]);
  });

  it.each([
    ['too few columns', '1\t2026-10-20 08:00:00\t0'],
    ['no PIN', '\t2026-10-20 08:00:00\t0\t1'],
    ['a date in another format', '1\t20/10/2026 08:00:00\t0\t1'],
    ['a day that doesn’t exist', '1\t2026-02-30 08:00:00\t0\t1'],
    ['an hour that doesn’t exist', '1\t2026-10-20 24:00:00\t0\t1'],
    ['a status that isn’t a number', '1\t2026-10-20 08:00:00\tin\t1'],
    [
      'a verify mode that isn’t a whole number',
      '1\t2026-10-20 08:00:00\t0\t1.5',
    ],
  ])(
    'refuses a line with %s: saves the good lines and answers ERROR so the machine retries',
    async (_, bad) => {
      const { serial, company } = await setup();
      const res = await upload(
        serial,
        [row('9', '2026-10-20 08:00:00'), bad].join('\n'),
      );
      expect(res.status).toBe(500);
      expect(res.text).toBe('ERROR');
      const saved = await events(company.id);
      expect(saved.map((e: any) => e.employeePin)).toEqual(['9']);
    },
  );

  it('refuses every line when the company’s UTC offset is unreadable', async () => {
    const { serial, company } = await setup({
      settings: { utcOffset: 'UTC+1' },
    });
    const res = await upload(serial, row('1', '2026-10-20 08:00:00'));
    expect(res.status).toBe(500);
    expect(await events(company.id)).toEqual([]);
  });

  it('answers 415 when the body isn’t text', async () => {
    const { serial, company } = await setup();
    const res = await machine()
      .post(`/iclock/cdata?SN=${serial}&table=ATTLOG`)
      .set('Content-Type', 'application/json')
      .send({ pin: 1 });
    expect(res.status).toBe(415);
    expect(res.text).toBe('ERROR');
    expect(await events(company.id)).toEqual([]);
  });

  it.each([['OPERLOG'], ['USERINFO'], [undefined]])(
    'acknowledges table %s without saving it as attendance',
    async (table) => {
      const { serial, company } = await setup();
      const res = await machine()
        .post(`/iclock/cdata?SN=${serial}${table ? `&table=${table}` : ''}`)
        .set('Content-Type', 'text/plain')
        .send('OPLOG 4\t0\t2026-10-20 08:00:00\t0\t0\t0\t0');
      expect(res.status).toBe(200);
      expect(res.text).toBe('OK');
      expect(await events(company.id)).toEqual([]);
    },
  );

  it('counts a line saved by a parallel retry as a duplicate', async () => {
    const { serial, company } = await setup();
    const model = t.model('ZktecoAttendanceEvent');
    jest
      .spyOn(model, 'updateOne')
      .mockRejectedValueOnce(
        Object.assign(new Error('E11000'), { code: 11000 }),
      );
    const save = jest.spyOn(t.app.get(ZktecoService), 'saveAttlog');
    const res = await upload(
      serial,
      [row('1', '2026-10-20 08:00:00'), row('2', '2026-10-20 08:01:00')].join(
        '\n',
      ),
    );
    expect(res.text).toBe('OK');
    await expect(save.mock.results[0].value).resolves.toEqual({
      inserted: 1,
      duplicates: 1,
      rejected: 0,
    });
    expect(await events(company.id)).toHaveLength(1);
  });

  it('answers ERROR when the database fails, so the machine sends again', async () => {
    const { serial } = await setup();
    jest
      .spyOn(t.model('ZktecoAttendanceEvent'), 'updateOne')
      .mockRejectedValueOnce(new Error('connection lost'));
    const res = await upload(serial, row('1', '2026-10-20 08:00:00'));
    expect(res.status).toBe(500);
    expect(res.text).toBe('ERROR');
  });

  it('answers ERROR when something other than an Error is thrown', async () => {
    const { serial } = await setup();
    jest
      .spyOn(t.app.get(ZktecoService), 'saveAttlog')
      .mockRejectedValueOnce('boom');
    expect((await upload(serial, row('1', '2026-10-20 08:00:00'))).status).toBe(
      500,
    );
  });
});
