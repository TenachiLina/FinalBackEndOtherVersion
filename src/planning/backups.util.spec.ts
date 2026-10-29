import { Types } from 'mongoose';
import { getBackupEmployees, getBackupIds } from './backups.util';

const MAIN = 'e-main';
const emp = (id: string, name = id) => ({ _id: id, firstName: name });

describe('getBackupIds', () => {
  it('reads the list of backups', () => {
    expect(getBackupIds({ empId: MAIN, backupEmpIds: ['e1', 'e2'] })).toEqual([
      'e1',
      'e2',
    ]);
  });

  it('falls back to the old single backup field', () => {
    expect(
      getBackupIds({ empId: MAIN, backupEmpIds: [], backupEmpId: 'e1' }),
    ).toEqual(['e1']);
    expect(getBackupIds({ empId: MAIN })).toEqual([]);
  });

  it('drops repeats, blanks and the main employee', () => {
    expect(
      getBackupIds({
        empId: MAIN,
        backupEmpIds: ['e1', 'e1', MAIN, null, '', 'e2'],
      }),
    ).toEqual(['e1', 'e2']);
  });

  it('works on populated documents and ObjectIds', () => {
    const id = new Types.ObjectId();
    expect(
      getBackupIds({
        empId: emp(MAIN),
        backupEmpIds: [emp('e1'), id, emp(MAIN)],
      }),
    ).toEqual(['e1', String(id)]);
  });
});

describe('getBackupEmployees', () => {
  it('returns the populated backups, without repeats or the main employee', () => {
    const e1 = emp('e1', 'Ali');
    expect(
      getBackupEmployees({
        empId: MAIN,
        backupEmpIds: [e1, emp('e1'), emp(MAIN), emp('e2', 'Sam')],
      }),
    ).toEqual([e1, emp('e2', 'Sam')]);
  });

  it('skips ids that were not populated (deleted employees)', () => {
    expect(
      getBackupEmployees({
        empId: MAIN,
        backupEmpIds: ['e1', null, emp('e2')],
      }),
    ).toEqual([emp('e2')]);
  });

  it('falls back to the old single backup field', () => {
    expect(
      getBackupEmployees({ empId: emp(MAIN), backupEmpId: emp('e1') }),
    ).toEqual([emp('e1')]);
    expect(getBackupEmployees({ empId: MAIN })).toEqual([]);
  });
});
