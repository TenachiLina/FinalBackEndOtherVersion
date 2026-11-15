import type { Rules } from './validate';

// What each kind of record accepts in a request body (see validate.ts).
// A field that is not listed here is dropped before anything is saved.

export const EMPLOYEE_FIELDS: Rules = {
  empNumber: { kind: 'integer', required: true, min: 1, max: 999_999_999 },
  firstName: { kind: 'string', required: true, max: 80 },
  lastName: { kind: 'string', required: true, max: 80 },
  baseSalary: { kind: 'number', min: 0, max: 1_000_000_000 },
  // A data URL: the request size limit (1 MB) bounds it
  personalImage: { kind: 'string', allowEmpty: true },
  address: { kind: 'string', max: 200, allowEmpty: true },
  phoneNumber: { kind: 'string', max: 40, allowEmpty: true },
  jobTitle: { kind: 'string', max: 80, allowEmpty: true },
  // célibataire, marié(e), divorcé(e), veuf/veuve
  familyStatus: {
    kind: 'string',
    oneOf: ['C', 'M', 'D', 'V'],
    allowEmpty: true,
  },
  birthDate: { kind: 'day', allowEmpty: true },
  hireDate: { kind: 'day', allowEmpty: true },
  socialSecurityNumber: { kind: 'string', max: 40, allowEmpty: true },
  insured: { kind: 'boolean' },
  declaredSalary: {
    kind: 'number',
    min: 0,
    max: 1_000_000_000,
    nullable: true,
  },
};

export const SHIFT_FIELDS: Rules = {
  startTime: { kind: 'time', required: true },
  endTime: { kind: 'time', required: true },
};

export const TASK_FIELDS: Rules = {
  taskId: { kind: 'integer', required: true, min: 0, max: 999_999_999 },
  taskName: { kind: 'string', required: true, max: 80 },
};

export const WORKTIME_FIELDS: Rules = {
  emp_id: { kind: 'integer', required: true, min: 1, max: 999_999_999 },
  shift_id: { kind: 'string', max: 40 },
  work_date: { kind: 'date' },
  // "" and null mean "not clocked": 00:00 is a real midnight
  clock_in: { kind: 'time', allowEmpty: true, nullable: true },
  clock_out: { kind: 'time', allowEmpty: true, nullable: true },
  late_minutes: { kind: 'number', min: 0, max: 100_000 },
  overtime_minutes: { kind: 'number', min: 0, max: 100_000 },
  work_hours: { kind: 'string', max: 12 },
  consomation: { kind: 'number', min: 0, max: 1_000_000_000 },
  penalty: { kind: 'number', min: 0, max: 1_000_000_000 },
  bonus: { kind: 'number', min: 0, max: 1_000_000_000 },
  absent: { kind: 'boolean' },
  absent_comment: { kind: 'string', max: 300, allowEmpty: true },
  backup_for_emp_id: { kind: 'integer', min: 1, nullable: true },
  backup_emp_id: { kind: 'integer', min: 1, nullable: true },
};

export const PLANNING_FIELDS: Rules = {
  shiftId: { kind: 'string', required: true, max: 40 },
  empId: { kind: 'string', required: true, max: 40 },
  backupEmpIds: { kind: 'strings', max: 50 },
  backupEmpId: { kind: 'string', max: 40, nullable: true },
  taskId: { kind: 'integer', required: true, min: 0, max: 999_999_999 },
  planDate: { kind: 'date', required: true },
  tasks: { kind: 'objects', max: 100 },
  customStartTime: { kind: 'time', allowEmpty: true, nullable: true },
  customEndTime: { kind: 'time', allowEmpty: true, nullable: true },
};
