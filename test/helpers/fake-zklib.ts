// Stands in for `node-zklib` in every test (see moduleNameMapper in jest.config.js).
// Tests set what the "machine" holds, or make it unreachable:
//
//   import { fakeDevice } from '../test/helpers/fake-zklib';
//   fakeDevice.attendances = [{ deviceUserId: '7', recordTime: new Date(...) }];
//   fakeDevice.reachable = false;

export const fakeDevice = {
  reachable: true,
  users: [] as Record<string, unknown>[],
  attendances: [] as Record<string, unknown>[],
  /** Every ZKLib created: [ip, port, timeout, inport] */
  created: [] as unknown[][],
  reset() {
    fakeDevice.reachable = true;
    fakeDevice.users = [];
    fakeDevice.attendances = [];
    fakeDevice.created = [];
  },
};

export default class FakeZKLib {
  constructor(...args: unknown[]) {
    fakeDevice.created.push(args);
  }

  createSocket() {
    if (!fakeDevice.reachable) {
      return Promise.reject(new Error('connect ETIMEDOUT 192.0.2.10:4370'));
    }
    return Promise.resolve(true);
  }

  disconnect() {
    return Promise.resolve();
  }

  getUsers() {
    return Promise.resolve({ data: fakeDevice.users });
  }

  getAttendances() {
    return Promise.resolve({ data: fakeDevice.attendances });
  }
}
